// The PR control board (/prs): what is open on the project repo, what waits for whom, what failed, what merged.
// READ-ONLY. One reader polls GitHub (GraphQL, ~3 points a minute), one more measures conflict files locally with
// `git merge-tree` (refs live under refs/viewer/* in the hub clone, nothing else is touched), and ONE WebSocket
// (/api/prs/ws) pushes the board and every change to the browser.
//   WS  /api/prs/ws        hello {board, events}, then board / event messages (server -> browser only; {"t":"ping"} is answered)
//   GET /api/prs/board     the board as of now (first paint, or when the socket is down)
//   GET /api/prs/conflict?n=N  the conflicting hunks of PR N against its base (code files only), from git merge-tree
//   GET /api/prs/refresh   asks for a GitHub read now (at most one every 20 s)
// Holds (PRs the owner froze) are read from data/prs/holds.json, seeded from the project's `holds` config.
import fs from 'node:fs';
import path from 'node:path';
import { killTree, safeSpawn } from '../platform.mjs';
import { EventEmitter } from 'node:events';
import { WebSocketServer } from 'ws';

import config from '../config.mjs';
import { spend, usedUpText } from '../budget.mjs';
import { ts } from '../i18n/server.mjs';
import { isBot, replyState } from '../mine/logic.mjs';

/** The PrBoard class bound to one project's config (repo, clone, reviewers, markers, holds). */
export function makeBoard(P) {
  const REPO = P.repo || '';
  const [REPO_OWNER, REPO_NAME] = REPO.split('/');
  const HUB = P.repoPath;
  const GH = config.tools.gh;
  const GIT = config.tools.git;
  const BRANCH = P.defaultBranch;
  const OPEN_MS = 75e3;
  const MERGED_MS = 180e3;
  const OPEN_IDLE_MS = 300e3; // no page is looking: a read every 5 minutes is enough to keep events and the next first view fresh
  const MERGED_IDLE_MS = 900e3;
  const MAX_EVENTS = 300;
  const GATE = P.gateCheck;
  // Tasks-board files: a conflict that touches only these is the reviewer's to resolve inside their batch.
  const BOARD_FILES = new Set(P.boardFiles);
  const DEFAULT_HOLDS = { ...P.holds };

  function run(cmd, args, { timeout = 60000, cwd } = {}) {
    return new Promise((resolve) => {
      let done = false, timer = null, c;
      const finish = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
      try { c = safeSpawn(cmd, args, { cwd, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (e) => finish({ code: -1, out: '', err: String(e) })); } catch (e) { return finish({ code: -1, out: '', err: String(e) }); }
      const out = [], err = [];
      c.stdout.on('data', (d) => out.push(d));
      c.stderr.on('data', (d) => err.push(d));
      c.on('error', (e) => finish({ code: -1, out: '', err: String(e) }));
      c.on('close', (code) => finish({ code, out: Buffer.concat(out).toString('utf8'), err: Buffer.concat(err).toString('utf8') }));
      timer = setTimeout(() => { killTree(c); finish({ code: -2, out: '', err: `timeout after ${timeout} ms` }); }, timeout);
    });
  }

  // The default branch tip and the viewer ride along with every page (a few bytes), so a read is one call per page, not one more for the tip.
  const OPEN_Q = `query($q:String!,$after:String){ rateLimit{cost remaining resetAt}
   repository(owner:"${REPO_OWNER}",name:"${REPO_NAME}"){ ref(qualifiedName:"refs/heads/${BRANCH}"){ target{ oid ... on Commit{ committedDate messageHeadline } } } } viewer{login}
   search(query:$q,type:ISSUE,first:25,after:$after){ issueCount pageInfo{hasNextPage endCursor}
    nodes{ ... on PullRequest{ number title url isDraft author{login} headRefName baseRefName headRefOid mergeable mergeStateStatus
     reviewDecision createdAt updatedAt additions deletions changedFiles
     comments(last:6){nodes{author{__typename login} createdAt body}} reviews(last:6){nodes{author{__typename login} submittedAt body}}
     commits(last:1){nodes{commit{committedDate statusCheckRollup{state contexts(first:100){totalCount nodes{ __typename
      ... on CheckRun{name status conclusion detailsUrl startedAt completedAt}
      ... on StatusContext{context state targetUrl createdAt}}}}}}} }}}}`;
  const MERGED_Q = `query($q:String!){ search(query:$q,type:ISSUE,first:100){ nodes{ ... on PullRequest{ number title url author{login} mergedAt mergedBy{login} mergeCommit{oid} } } } }`;

  async function graphql(query, vars) {
    const who = `prs:${P.id}`;
    const args = ['api', 'graphql', '-f', `query=${query}`];
    for (const [k, v] of Object.entries(vars || {})) if (v != null) args.push('-F', `${k}=${v}`);
    for (let i = 0; i < 3; i++) {
      // Every attempt is a real call, so every attempt is counted (a retry loop on a failing network is not free).
      if (!spend(1, who)) throw new Error(usedUpText());
      const r = await run(GH, args, { timeout: 45000 });
      if (r.code === 0) { try { const j = JSON.parse(r.out); if (j.data) return j.data; } catch { /* retry */ } }
      await new Promise((res) => setTimeout(res, 3000 * (i + 1)));
    }
    throw new Error('GitHub GraphQL did not answer');
  }

  /** One check, slim: n name, s state (pass | fail | run | queue | skip | neutral), u url, a started, z finished. */
  function slimCheck(x) {
    if (x.__typename === 'StatusContext') {
      const s = x.state === 'SUCCESS' ? 'pass' : x.state === 'PENDING' || x.state === 'EXPECTED' ? 'run' : 'fail';
      return { n: x.context, s, u: x.targetUrl || '', a: x.createdAt || null, z: null };
    }
    let s;
    if (x.status !== 'COMPLETED') s = x.status === 'IN_PROGRESS' ? 'run' : 'queue';
    else s = { SUCCESS: 'pass', SKIPPED: 'skip', NEUTRAL: 'neutral', CANCELLED: 'cancel', STALE: 'skip' }[x.conclusion] || 'fail';
    return { n: x.name, s, u: x.detailsUrl || '', a: x.startedAt || null, z: x.completedAt || null };
  }

  // The reviewer's newest comment/review on a PR, if it is newer than the head commit and asks us for something
  // (mentions your login or reads like an action list). Overrides held/owner labels .
  const REVIEWERS = new Set(P.reviewers.map((r) => r.login));
  const ME = P.me || '';
  const REVIEWER = P.reviewers[0]?.name || P.reviewers[0]?.login || 'The reviewer';
  const esc = (t) => t.replace(/\W/g, (c) => '\\' + c);
  const MENTION_RE = ME ? new RegExp('@' + esc(ME), 'i') : /$^/;
  const MK = P.reviewMarkers;
  const alt = (xs) => xs.map((r) => '(?:' + r + ')').join('|');
  const ASK_RE = new RegExp(alt([...(ME ? ['@' + esc(ME)] : []), ...MK.ask, ...MK.fail]), 'i');
  const PASS_RE = MK.pass.length ? new RegExp(alt(MK.pass), 'i') : /$^/;
  function reviewerAsk(x, pushed) {
    const items = [...(x.comments?.nodes || []).map((c) => ({ by: c.author?.login, at: c.createdAt, body: c.body })),
      ...(x.reviews?.nodes || []).map((c) => ({ by: c.author?.login, at: c.submittedAt, body: c.body }))]
      .filter((c) => REVIEWERS.has(c.by) && c.at).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    const last = items[0];
    if (!last || !last.body || !ASK_RE.test(last.body)) return null;
    if (pushed && Date.parse(last.at) <= Date.parse(pushed)) return null;
    if (PASS_RE.test(last.body)) return null; // a pass is not a request
    const mentionsMe = MENTION_RE.test(last.body);
    const mine = x.author?.login === ME;
    // A comment that @-mentions only someone else never lands on us; a PR of someone else needs the mention.
    if (!mentionsMe && (!mine || /@[\w-]+/.test(last.body))) return null;
    const d = last.at.slice(5, 10);
    if (mentionsMe && !mine && /review|approve/i.test(last.body)) return { at: last.at, text: `${REVIEWER} asks you to review/approve (${d})` };
    return { at: last.at, text: `${REVIEWER} asked ${d}: ${last.body.replace(/\s+/g, ' ').trim().slice(0, 80)}` };
  }

  /** Who spoke last on a PR and whether someone else commented after your last comment or push (the "Your work" page). */
  function talkOf(x, pushed, me) {
    const items = [...(x.comments?.nodes || []).map((c) => ({ by: c.author?.login, bot: isBot(c.author), at: c.createdAt })),
      ...(x.reviews?.nodes || []).filter((c) => c.body?.trim()).map((c) => ({ by: c.author?.login, bot: isBot(c.author), at: c.submittedAt }))];
    const mine = x.author?.login && me && x.author.login.toLowerCase() === me.toLowerCase() ? [x.createdAt, pushed] : [];
    const { last, newReply, replyBy, replyAt } = replyState(items, me, mine.filter(Boolean));
    return { last, newReply, replyBy, replyAt };
  }

  /** Where a PR stands and who it waits for. */
  function classify(pr, ctx) {
    const { holds, byHead, conflicts } = ctx;
    if (pr.ask) return { stage: 'changes', who: 'us', why: pr.ask.text };
    if (holds[pr.number]) return { stage: 'held', who: 'owner', why: holds[pr.number] };
    if (pr.draft) return { stage: 'draft', who: 'none', why: 'draft' };
    const parent = pr.base !== BRANCH ? byHead.get(pr.base) : null;
    if (pr.mergeable === 'CONFLICTING') {
      const c = conflicts.get(pr.number);
      if (!c || c.head !== pr.head) return { stage: 'measuring', who: 'viewer', why: 'measuring conflict files' };
      if (c.files.length && c.files.every((f) => BOARD_FILES.has(f))) return { stage: 'board-conflict', who: 'reviewer', why: 'board files only — resolved in the reviewer batch' };
      return { stage: 'code-conflict', who: 'us', why: `${c.files.filter((f) => !BOARD_FILES.has(f)).length} code file(s) conflict` };
    }
    const ci = pr.ci;
    if (ci.gate === 'fail' || (ci.gate == null && ci.fail > 0 && ci.run === 0 && ci.queue === 0)) return { stage: 'ci-failed', who: 'us', why: ci.failed.slice(0, 3).join(', ') || 'required check failed' };
    if (ci.run > 0 || ci.queue > 0 || ci.gate === 'run' || ci.gate === 'queue' || (ci.total === 0 && pr.mergeable !== 'UNKNOWN')) return { stage: 'ci-running', who: 'ci', why: `${ci.run} running · ${ci.queue} queued` };
    if (pr.mergeable === 'UNKNOWN') return { stage: 'computing', who: 'github', why: 'GitHub is computing mergeability' };
    if (parent) return { stage: 'stacked', who: 'parent', why: `on #${parent.number}`, parent: parent.number };
    if (pr.review === 'CHANGES_REQUESTED') return { stage: 'changes', who: 'us', why: 'changes requested' };
    if (pr.state === 'BLOCKED') return { stage: 'review', who: 'reviewer', why: pr.review === 'REVIEW_REQUIRED' ? 'needs approval' : 'blocked by a rule' };
    return { stage: 'ready', who: 'reviewer', why: pr.state === 'BEHIND' ? `green, behind ${BRANCH} (merge as-is)` : 'green and clean' };
  }

  /** The agreed push queue (data/batch-queue.json): which batch a PR belongs to and which local branch holds its fix. */
  function readQueue(file) {
    try {
      const q = JSON.parse(fs.readFileSync(file, 'utf8'));
      const byPr = new Map();
      for (const b of q.batches || []) for (const e of b.prs || []) byPr.set(e.pr, { batch: b.n, name: b.name, track: b.track, branch: e.branch || null });
      return { q, byPr };
    } catch { return { q: { batches: [], tracks: {} }, byPr: new Map() }; }
  }

  class PrBoard extends EventEmitter {
    constructor({ dataRoot }) {
      super();
      this.dir = path.join(dataRoot, 'prs');
      fs.mkdirSync(this.dir, { recursive: true });
      const holdsFile = path.join(this.dir, 'holds.json');
      if (!fs.existsSync(holdsFile)) fs.writeFileSync(holdsFile, JSON.stringify(DEFAULT_HOLDS, null, 2));
      this.holdsFile = holdsFile;
      this.eventsFile = path.join(this.dir, 'events.json');
      this.conflictsFile = path.join(this.dir, 'conflicts.json');
      this.events = [];
      try { this.events = JSON.parse(fs.readFileSync(this.eventsFile, 'utf8')).slice(-MAX_EVENTS); } catch { /* none yet */ }
      /** @type {Map<number, {head:string, base:string, files:string[], at:number}>} */
      this.conflicts = new Map();
      try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(this.conflictsFile, 'utf8')))) this.conflicts.set(Number(k), v); } catch { /* none yet */ }
      this.prs = null; // Map number -> pr
      this.merged = [];
      this.tip = null;
      this.me = null;
      this.rl = null;
      this.readAt = 0; this.mergedAt = 0; this.error = null; this.busy = false; this.lastAsk = 0;
      this.measuring = false;
      this.board = null;
      this.queueFile = path.join(dataRoot, 'batch-queue.json');
      /** @type {Map<number, {head:string, branch:string, sha:string, ahead:number, ff:boolean}>} local branch vs origin head, read-only git, ~60 s */
      this.local = new Map();
      this.localAt = 0; this.localBusy = false;
    }

    /** Where each queued open PR's local branch stands against the PR head on origin (no fetch, read-only git, cached 60 s). */
    async refreshLocal(force = false) {
      if (this.localBusy || !this.prs) return false;
      if (!force && Date.now() - this.localAt < 60e3) return false;
      this.localBusy = true;
      try {
        const { byPr } = readQueue(this.queueFile);
        const next = new Map();
        for (const p of this.prs.values()) {
          const e = byPr.get(p.number);
          if (!e || !e.branch) continue;
          const sha = (await run(GIT, ['-C', HUB, 'rev-parse', '--verify', '--quiet', `${e.branch}^{commit}`], { timeout: 15000 })).out.trim();
          if (!sha) continue;
          const o = (await run(GIT, ['-C', HUB, 'rev-parse', '--verify', '--quiet', `origin/${p.headRef}^{commit}`], { timeout: 15000 })).out.trim();
          if (!o) continue;
          const ff = (await run(GIT, ['-C', HUB, 'merge-base', '--is-ancestor', `origin/${p.headRef}`, e.branch], { timeout: 15000 })).code === 0;
          const ahead = Number((await run(GIT, ['-C', HUB, 'rev-list', '--count', `origin/${p.headRef}..${e.branch}`], { timeout: 15000 })).out.trim()) || 0;
          next.set(p.number, { head: o, branch: e.branch, sha, ahead, ff });
        }
        const changed = JSON.stringify([...next]) !== JSON.stringify([...this.local]);
        this.local = next; this.localAt = Date.now();
        return changed;
      } finally { this.localBusy = false; }
    }

    /** A page just arrived: if the last read is older than the fast pace (the board was idling), read now. */
    wake() { if (!this.busy && Date.now() - (this.readAt || 0) > OPEN_MS) this.readOpen(); }

    holds() { try { return JSON.parse(fs.readFileSync(this.holdsFile, 'utf8')); } catch { return DEFAULT_HOLDS; } }

    start() {
      if (!REPO) { this.error = 'no repo configured for this project'; return; }
      // Fast while someone looks at the board (a page is connected or asked within the last 3 minutes), slow otherwise.
      const idle = () => !(this.wanted ? this.wanted() : true);
      const tick = async () => { await this.readOpen(); setTimeout(tick, idle() ? OPEN_IDLE_MS : OPEN_MS).unref?.(); };
      const mtick = async () => { await this.readMerged(); setTimeout(mtick, idle() ? MERGED_IDLE_MS : MERGED_MS).unref?.(); };
      setTimeout(tick, 500);
      setTimeout(mtick, 3000);
      setInterval(() => { this.refreshLocal().then((ch) => { if (ch) this.rebuild(); }).catch(() => {}); }, 30e3).unref?.();
    }

    /** The conflicting hunks of one PR against its base, read from `git merge-tree` (code files only; board files are
     *  the reviewer's). Each hunk: up to 3 context lines, the base side (the default branch) and the PR side, numbered on the base file.
     *  Cached per PR head + base tip, so a click costs one merge-tree only after something moved. */
    async conflictHunks(n) {
      const c = this.conflicts.get(n);
      if (!c || !c.files.length) return { n, files: [], board: [], note: 'no measured conflict for this PR' };
      const key = `${c.head}:${c.baseSha}`;
      this.hunkCache ??= new Map();
      const hit = this.hunkCache.get(n);
      if (hit && hit.key === key) return hit.value;
      const r = await run(GIT, ['-C', HUB, '-c', 'merge.conflictStyle=merge', 'merge-tree', '--write-tree', '--no-messages', `refs/viewer/base/${c.base}`, `refs/viewer/pr/${n}`]);
      if (r.code !== 1) {
        const note = r.code === 0 ? 'merges clean now - wait for the next measure' : `git merge-tree failed: ${r.err.trim().split(/\r?\n/).pop()}`;
        return { n, files: [], board: [], note };
      }
      const tree = r.out.split(/\r?\n/)[0].trim();
      const CTX = 3, MAX_HUNKS = 40, MAX_LINE = 400;
      const cut = (x) => (x.length > MAX_LINE ? `${x.slice(0, MAX_LINE)} …` : x);
      const marker = (x) => /^(<{7}|={7}|>{7}|\|{7})( |$)/.test(x);
      const files = [];
      for (const f of c.files.filter((x) => !BOARD_FILES.has(x))) {
        const b = await run(GIT, ['-C', HUB, 'cat-file', '-p', `${tree}:${f}`]);
        if (b.code !== 0) { files.push({ path: f, hunks: [], total: 0, note: 'not readable (deleted on one side, or binary)' }); continue; }
        const lines = b.out.split(/\r?\n/);
        const hunks = [];
        let ln = 0, i = 0, total = 0;
        while (i < lines.length) {
          if (!lines[i].startsWith('<<<<<<< ')) { ln++; i++; continue; }
          total++;
          const before = lines.slice(Math.max(0, i - CTX), i).filter((x) => !marker(x)).map(cut);
          const start = ln + 1;
          const base = [], pr = [];
          let side = base;
          for (i++; i < lines.length && !lines[i].startsWith('>>>>>>> '); i++) {
            if (lines[i].startsWith('||||||| ')) side = null;
            else if (lines[i] === '=======') side = pr;
            else if (side) side.push(cut(lines[i]));
          }
          i++;
          ln += base.length;
          const after = [];
          for (let j = i; j < lines.length && after.length < CTX && !lines[j].startsWith('<<<<<<< '); j++) after.push(cut(lines[j]));
          if (hunks.length < MAX_HUNKS) hunks.push({ start, before, base, pr, after });
        }
        files.push({ path: f, hunks, total });
      }
      const value = { n, base: c.base, baseSha: c.baseSha, head: c.head, at: Date.now(), files, board: c.files.filter((x) => BOARD_FILES.has(x)) };
      this.hunkCache.set(n, { key, value });
      return value;
    }

    ask() {
      if (Date.now() - this.lastAsk < 20000) return false;
      this.lastAsk = Date.now();
      this.readOpen(); this.readMerged();
      return true;
    }

    pushEvent(ev) {
      const e = { t: Date.now(), ...ev };
      this.events.push(e);
      if (this.events.length > MAX_EVENTS) this.events = this.events.slice(-MAX_EVENTS);
      try { fs.writeFileSync(this.eventsFile, JSON.stringify(this.events)); } catch { /* best effort */ }
      this.emit('event', e);
    }

    async readMerged() {
      try {
        const since = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
        const d = await graphql(MERGED_Q, { q: `repo:${REPO} is:pr is:merged merged:>=${since} sort:updated-desc` });
        const merged = d.search.nodes.filter((x) => x && x.number).map((x) => ({ number: x.number, title: x.title, url: x.url, author: x.author?.login || '?', at: x.mergedAt, by: x.mergedBy?.login || '?', sha: x.mergeCommit?.oid?.slice(0, 9) || '' }))
          .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
        const known = new Set(this.merged.map((m) => m.number));
        if (this.merged.length) for (const m of merged) if (!known.has(m.number)) this.pushEvent({ k: 'merged', n: m.number, title: m.title, by: m.by, author: m.author });
        this.merged = merged;
        this.mergedAt = Date.now();
        this.rebuild();
      } catch (e) { this.error = String(e.message || e); this.rebuild(); }
    }

    async readOpen() {
      if (this.busy) return;
      this.busy = true;
      try {
        let tip = null;
        const rows = [];
        let after = null;
        for (let page = 0; page < 8; page++) {
          const d = await graphql(OPEN_Q, { q: `repo:${REPO} is:pr is:open`, after });
          if (!tip) {
            const t = d.repository.ref.target;
            tip = { sha: t.oid, at: t.committedDate, msg: t.messageHeadline };
            this.me = d.viewer.login;
          }
          this.rl = d.rateLimit;
          rows.push(...d.search.nodes.filter((x) => x && x.number));
          if (!d.search.pageInfo.hasNextPage) break;
          after = d.search.pageInfo.endCursor;
        }
        const next = new Map();
        for (const x of rows) {
          const commit = x.commits?.nodes?.[0]?.commit;
          const checks = (commit?.statusCheckRollup?.contexts?.nodes || []).map(slimCheck);
          // A re-run leaves two runs of the same job: keep the newest per name.
          const byName = new Map();
          for (const c of checks) { const o = byName.get(c.n); if (!o || (c.a || '') >= (o.a || '')) byName.set(c.n, c); }
          const list = [...byName.values()];
          const count = (s) => list.filter((c) => c.s === s).length;
          const gate = list.find((c) => c.n === GATE);
          const failed = list.filter((c) => c.s === 'fail' && c.n !== GATE);
          const firstStart = list.map((c) => c.a).filter(Boolean).sort()[0] || null;
          const lastEnd = list.map((c) => c.z).filter(Boolean).sort().pop() || null;
          next.set(x.number, {
            number: x.number, title: x.title, url: x.url, author: x.author?.login || '?', draft: x.isDraft,
            head: x.headRefOid, headRef: x.headRefName, base: x.baseRefName, mergeable: x.mergeable, state: x.mergeStateStatus,
            ask: reviewerAsk(x, commit?.committedDate), talk: talkOf(x, commit?.committedDate, this.me || ME), review: x.reviewDecision, created: x.createdAt, updated: x.updatedAt, pushed: commit?.committedDate || null,
            size: { add: x.additions, del: x.deletions, files: x.changedFiles },
            ci: {
              rollup: commit?.statusCheckRollup?.state || null, gate: gate ? gate.s : null, total: list.length,
              pass: count('pass'), fail: failed.length, run: count('run'), queue: count('queue'), skip: count('skip') + count('neutral') + count('cancel'),
              failed: failed.map((c) => c.n), failedUrls: failed.map((c) => c.u), started: firstStart, finished: lastEnd,
              checks: list.filter((c) => c.s !== 'skip').map((c) => ({ n: c.n, s: c.s, u: c.u, a: c.a, z: c.z })),
            },
          });
        }
        // After a merge on the default branch GitHub answers UNKNOWN until someone opens the PR. Keep the last known answer (marked stale)
        // and nudge GitHub once per PR per default-branch tip with a REST read of the PR, which starts its background recompute.
        this.nudged ??= new Map();
        for (const p of next.values()) {
          if (p.mergeable !== 'UNKNOWN') continue;
          const o = this.prs?.get(p.number);
          if (o && o.mergeable !== 'UNKNOWN') { p.mergeable = o.mergeable; p.state = o.state; p.stale = true; }
          else if (o && o.stale) { p.mergeable = o.mergeable; p.state = o.state; p.stale = true; }
          if (this.nudged.get(p.number) !== tip.sha) { this.nudged.set(p.number, tip.sha); if (spend(1, `prs:${P.id}`)) run(GH, ['api', `repos/${REPO}/pulls/${p.number}`, '--silent'], { timeout: 20000 }); }
        }
        this.diff(this.prs, next, this.tip, tip);
        this.prs = next; this.tip = tip; this.readAt = Date.now(); this.error = null;
        try { await this.refreshLocal(true); } catch { /* local info is optional */ }
        this.rebuild();
        this.measure();
      } catch (e) { this.error = String(e.message || e); this.rebuild(); }
      finally { this.busy = false; }
    }

    /** Events from one read to the next: the "what happened" feed. */
    diff(prev, next, prevTip, tip) {
      if (!prev) return;
      if (prevTip && tip.sha !== prevTip.sha) this.pushEvent({ k: 'tip', sha: tip.sha.slice(0, 9), msg: tip.msg });
      for (const [n, p] of next) {
        const o = prev.get(n);
        if (!o) { this.pushEvent({ k: 'opened', n, title: p.title, author: p.author }); continue; }
        if (o.head !== p.head) this.pushEvent({ k: 'pushed', n, title: p.title, sha: p.head.slice(0, 9) });
        if (o.mergeable !== p.mergeable && p.mergeable !== 'UNKNOWN' && !p.stale && !(o.mergeable === 'UNKNOWN' && p.mergeable === 'MERGEABLE')) this.pushEvent({ k: p.mergeable === 'CONFLICTING' ? 'conflict' : 'unconflict', n, title: p.title });
        const og = o.ci.gate, ng = p.ci.gate;
        if (og !== ng && (ng === 'pass' || ng === 'fail')) this.pushEvent({ k: ng === 'pass' ? 'green' : 'red', n, title: p.title, failed: p.ci.failed.slice(0, 4) });
        else if (p.ci.fail > o.ci.fail && o.head === p.head) {
          const fresh = p.ci.failed.filter((f) => !o.ci.failed.includes(f));
          if (fresh.length) this.pushEvent({ k: 'check-failed', n, title: p.title, failed: fresh.slice(0, 4) });
        }
        if (o.review !== p.review && p.review === 'APPROVED') this.pushEvent({ k: 'approved', n, title: p.title });
        if (o.review !== p.review && p.review === 'CHANGES_REQUESTED') this.pushEvent({ k: 'changes', n, title: p.title });
      }
      for (const [n, o] of prev) if (!next.has(n) && !this.merged.some((m) => m.number === n)) this.pushEvent({ k: 'closed', n, title: o.title });
    }

    /** Conflict files, measured locally for every CONFLICTING PR whose head (or base tip) moved since the last measure. */
    async measure() {
      if (this.measuring || !this.prs) return;
      // CONFLICTING ones for their files; UNKNOWN ones too, so the board knows the answer before GitHub recomputes it.
      const todo = [...this.prs.values()].filter((p) => (p.mergeable === 'CONFLICTING' || p.mergeable === 'UNKNOWN' || p.stale) && !p.draft && !this.holds()[p.number]);
      // Re-measure when the PR's head moved or the default-branch tip moved (a merge on the default branch can create or clear a conflict, stacked children too).
      const tipSha = this.tip?.sha || '';
      const stale = todo.filter((p) => { const c = this.conflicts.get(p.number); return !c || c.head !== p.head || c.tip !== tipSha; });
      if (!stale.length) return;
      this.measuring = true;
      try {
        const bases = [...new Set(stale.map((p) => p.base))];
        const specs = bases.map((b) => `+refs/heads/${b}:refs/viewer/base/${b}`);
        specs.push(...stale.map((p) => `+refs/pull/${p.number}/head:refs/viewer/pr/${p.number}`));
        const f = await run(GIT, ['-C', HUB, 'fetch', '--quiet', '--no-tags', 'origin', ...specs], { timeout: 180000 });
        if (f.code !== 0) { this.error = `git fetch: ${f.err.trim().split('\n').pop()}`; return; }
        for (const p of stale) {
          const baseSha = (await run(GIT, ['-C', HUB, 'rev-parse', `refs/viewer/base/${p.base}`])).out.trim();
          const r = await run(GIT, ['-C', HUB, 'merge-tree', '--write-tree', '--name-only', '--no-messages', `refs/viewer/base/${p.base}`, `refs/viewer/pr/${p.number}`]);
          // exit 1 = conflicts: line 1 is the tree, then one conflicted file per line.
          const files = r.code === 1 ? r.out.split('\n').slice(1).map((s) => s.trim()).filter(Boolean) : [];
          const before = this.conflicts.get(p.number);
          this.conflicts.set(p.number, { head: p.head, base: p.base, baseSha, tip: tipSha, files: [...new Set(files)], at: Date.now() });
          const code = files.filter((x) => !BOARD_FILES.has(x));
          if (code.length && (!before || before.files.filter((x) => !BOARD_FILES.has(x)).join() !== code.join())) this.pushEvent({ k: 'code-conflict', n: p.number, title: p.title, files: code.slice(0, 6) });
        }
        // Forget PRs that are no longer open or no longer conflicting.
        for (const n of [...this.conflicts.keys()]) { const p = this.prs.get(n); if (!p || (p.mergeable === 'MERGEABLE' && !p.stale)) this.conflicts.delete(n); }
        try { fs.writeFileSync(this.conflictsFile, JSON.stringify(Object.fromEntries(this.conflicts))); } catch { /* best effort */ }
        this.rebuild();
      } finally { this.measuring = false; }
    }

    rebuild() {
      const holds = this.holds();
      const list = this.prs ? [...this.prs.values()] : [];
      const byHead = new Map(list.map((p) => [p.headRef, p]));
      const ctx = { holds, byHead, conflicts: this.conflicts };
      const tipSha = this.tip?.sha || '';
      // The current batch of each track = the first batch (in order) that still has an open PR; social waits for the tracks it names.
      const { q, byPr } = readQueue(this.queueFile);
      const open = new Set(list.map((p) => p.number));
      const live = (b) => (b.prs || []).some((e) => open.has(e.pr));
      const firstLive = (track) => (q.batches || []).filter((b) => b.track === track && live(b)).sort((a, b) => a.n - b.n)[0]?.n ?? null;
      const currentOf = {};
      for (const track of Object.keys(q.tracks || {})) {
        if (track === 'owner') { currentOf[track] = null; continue; }
        const waits = q.tracks[track] || [];
        currentOf[track] = waits.some((t) => firstLive(t) != null) ? null : firstLive(track);
      }
      const prs = list.map((p0) => {
        // GitHub's answer is unknown or stale but we measured this head against today's default-branch tip: use our answer.
        let p = p0;
        const m = this.conflicts.get(p0.number);
        if ((p0.mergeable === 'UNKNOWN' || p0.stale) && m && m.head === p0.head && m.tip === tipSha) {
          p = { ...p0, mergeable: m.files.length ? 'CONFLICTING' : 'MERGEABLE', state: m.files.length ? 'DIRTY' : (p0.state === 'UNKNOWN' ? 'MEASURED' : p0.state), measured: true };
        }
        let c = classify(p, ctx);
        let batch = null;
        const qe = byPr.get(p.number);
        const lo = this.local.get(p.number);
        if (qe && lo) {
          if (lo.ahead > 0 && lo.ff && c.who === 'us') {
            const cur = currentOf[qe.track] === qe.batch;
            batch = { n: qe.batch, name: qe.name, track: qe.track, branch: lo.branch, ahead: lo.ahead, current: cur };
            c = cur
              ? { stage: 'push-now', who: 'us', why: ts('prs.reason.pushNow', { branch: lo.branch, ahead: lo.ahead }) }
              : qe.track === 'owner'
                ? { stage: 'local-ready', who: 'local', why: ts('prs.reason.waitOwner', { branch: lo.branch, ahead: lo.ahead }) }
                : { stage: 'local-ready', who: 'local', why: ts('prs.reason.waitTurn', { batch: qe.batch, branch: lo.branch, ahead: lo.ahead }) };
          }
        } else if (qe) batch = { n: qe.batch, name: qe.name, track: qe.track, branch: qe.branch, ahead: 0, current: currentOf[qe.track] === qe.batch };
        const cf = this.conflicts.get(p.number);
        const conflictFiles = p.mergeable === 'CONFLICTING' && cf && cf.head === p.head ? cf.files : [];
        const children = list.filter((x) => x.base === p.headRef).map((x) => x.number);
        const parent = p.base !== BRANCH ? byHead.get(p.base)?.number : undefined;
        return { parent, ...p, ...c, batch, conflictFiles, children, mine: p.author === this.me };
      }).sort((a, b) => a.number - b.number);
      const now = Date.now();
      const day = (t) => new Date(t).toISOString().slice(0, 10);
      const days = [];
      for (let i = 13; i >= 0; i--) days.push(day(now - i * 864e5));
      const perDay = days.map((d) => [d, this.merged.filter((m) => day(Date.parse(m.at)) === d).length]);
      this.board = {
        at: now, readAt: this.readAt, mergedReadAt: this.mergedAt, error: this.error, me: this.me, tip: this.tip, rl: this.rl,
        measuring: this.measuring, prs, merged: this.merged.slice(0, 60), perDay, holds,
      };
      this.emit('board', this.board);
    }
  }


  return PrBoard;
}

/**
 * The /api/prs/* routes and the /api/prs/ws socket, for every configured project. A project's board is created (and its
 * pollers started) the first time something asks for it; the first project is started at once. The first project keeps
 * data/prs/*, the others use data/p/<id>/prs/*. `pid` is the project id from /api/p/<id>/..., or the first project's for the old routes.
 */
export function createPrs({ root, firstId, projectOf }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 });
  const all = new Set(); // every socket, for the ping sweep
  const live = new Map(); // project id -> { board, clients: Map<ws, {alive}>, boardT, lastSent }
  const send = (ws, s) => { if (ws.readyState !== 1) return; if (ws.bufferedAmount > 4e6) return ws.terminate(); ws.send(s); };
  const get = (pid) => {
    let e = live.get(pid);
    if (e) return e;
    const P = projectOf(pid);
    if (!P) return null;
    const Board = makeBoard(P);
    const board = new Board({ dataRoot: pid === firstId ? path.join(root, 'data') : path.join(root, 'data', 'p', pid) });
    e = { board, clients: new Map(), boardT: null, lastSent: '', seenAt: 0 };
    board.wanted = () => e.clients.size > 0 || Date.now() - e.seenAt < 180e3;
    live.set(pid, e);
    board.on('board', () => {
      if (e.boardT || !e.clients.size) return;
      e.boardT = setTimeout(() => {
        e.boardT = null;
        const s = JSON.stringify({ t: 'board', board: board.board });
        if (s === e.lastSent) return;
        e.lastSent = s;
        for (const ws of e.clients.keys()) send(ws, s);
      }, 400);
    });
    board.on('event', (ev) => { const s = JSON.stringify({ t: 'event', event: ev }); for (const ws of e.clients.keys()) send(ws, s); });
    board.start();
    return e;
  };
  get(firstId);
  setInterval(() => {
    for (const ws of all) { const c = ws._c; if (!c) continue; if (!c.alive) { ws.terminate(); continue; } c.alive = false; try { ws.ping(); } catch { /* closing */ } }
  }, 25000).unref?.();

  const reply = (res, code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    res.end(JSON.stringify(body));
  };
  const refuse = (socket, code, text) => { try { socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); } catch { /* gone */ } socket.destroy(); };

  return {
    /** The boards that are running (for the machine overview, which only reads them). */
    boards: () => [...live].map(([id, e]) => ({ id, board: e.board.board })),
    ensure: (pid) => !!get(pid),
    /** One project's board as of now (started on first use), or null for an unknown project. */
    boardOf: (pid) => get(pid)?.board.board ?? null,
    async handle(req, res, url, pid = firstId) {
      if (!url.pathname.startsWith('/api/prs/')) return false;
      { const e = live.get(pid); if (e) { const was = e.seenAt; e.seenAt = Date.now(); if (Date.now() - was > 180e3) e.board.wake(); } }
      // Host, Origin and cross-site requests: refused for every request by server/guard.mjs before this runs.
      if (req.method !== 'GET') return reply(res, 405, { error: 'read-only' }), true;
      const e = get(pid);
      if (!e) return reply(res, 404, { error: 'unknown project' }), true;
      const board = e.board;
      if (url.pathname === '/api/prs/board') return reply(res, 200, board.board || { at: Date.now(), prs: [], merged: [], perDay: [], loading: true }), true;
      if (url.pathname === '/api/prs/conflict') {
        const n = Number(url.searchParams.get('n'));
        if (!Number.isInteger(n) || n <= 0 || n > 1e6) return reply(res, 400, { error: 'bad n' }), true;
        return reply(res, 200, await board.conflictHunks(n)), true;
      }
      if (url.pathname === '/api/prs/refresh') return reply(res, 200, { ok: board.ask() }), true;
      return reply(res, 404, { error: 'unknown' }), true;
    },
    upgrade(req, socket, head, pid = firstId) {
      if (all.size >= 20) return refuse(socket, 503, 'Service Unavailable');
      const e = get(pid);
      if (!e) return refuse(socket, 404, 'Not Found');
      wss.handleUpgrade(req, socket, head, (ws) => {
        const c = { alive: true };
        ws._c = c;
        e.clients.set(ws, c);
        e.board.wake();
        all.add(ws);
        ws.on('pong', () => { c.alive = true; });
        ws.on('message', (data, bin) => {
          c.alive = true;
          let ok = false;
          if (!bin) { try { ok = JSON.parse(String(data)).t === 'ping'; } catch { /* not JSON */ } }
          if (ok) send(ws, '{"t":"pong"}'); else ws.close(1008, 'read-only');
        });
        const gone = () => { e.clients.delete(ws); all.delete(ws); };
        ws.on('close', gone);
        ws.on('error', () => { gone(); try { ws.terminate(); } catch { /* gone */ } });
        send(ws, JSON.stringify({ t: 'hello', board: e.board.board, events: e.board.events.slice(-120) }));
      });
    },
  };
}
