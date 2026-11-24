// The data side of the /ci page: slim rows, the runner list, the server-computed aggregates and the paginated lists
// (Whole org / My machine / Queue). READ-ONLY. Every job comes from the shared JobStore (store.mjs), so the views
// can never disagree; this machine's runners take busy/idle from the runner's own log (real.mjs).
// Idle/offline runners of OTHER machines are NOT visible: that needs org-admin access (GET /orgs/<org>/actions/runners).
// Wire rule: a row carries only what the UI renders (no steps, no run id, no full sha, repo without the org prefix,
// avatars without the avatar host). Steps and logs come from the per-job endpoints when a row is opened.
import fs from 'node:fs';
import path from 'node:path';

const DAY = 24 * 3600 * 1000;
const H = 3600e3;
const GHOST_MS = 6 * H;
const QUEUED = new Set(['queued', 'waiting', 'pending', 'requested']);
const HOSTED_RUNNER = /^(GitHub Actions|Hosted Agent)/i;
const AVATAR = 'https://avatars.githubusercontent.com/';
const PAGE_DEFAULT = 50;
const PAGE_MAX = 200;

const ms = (s) => (s ? Date.parse(s) || 0 : 0);
export const shortRepo = (r) => String(r || '').split('/').pop() || '';
const cutText = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const person = (p) => (p && p.login ? (p.avatar ? { login: p.login, avatar: String(p.avatar).replace(AVATAR, '') } : { login: p.login }) : undefined);

/** The one wire shape of a job row. Missing / false fields are left out. */
export function slim(j) {
  const tr = j.trigger || j.actor;
  const r = { id: j.id, repo: shortRepo(j.repo), workflow: j.workflow, job: j.job, status: j.status };
  if (j.branch) r.branch = j.branch;
  if (j.sha) r.sha = String(j.sha).slice(0, 7);
  if (j.pr) { r.pr = j.pr; if (j.prTitle) r.prTitle = cutText(String(j.prTitle), 80); }
  if (j.trigger) r.trigger = person(j.trigger);
  if (j.actor && (!j.trigger || j.actor.login !== j.trigger.login)) r.actor = person(j.actor);
  if (j.prAuthor && (!tr || j.prAuthor.login !== tr.login)) r.prAuthor = person(j.prAuthor);
  if (j.runner) r.runner = j.runner;
  if (j.labels && j.labels.length) r.labels = j.labels;
  if (j.conclusion) r.conclusion = j.conclusion;
  if (j.createdAt) r.createdAt = j.createdAt;
  if (j.startedAt) r.startedAt = j.startedAt;
  if (j.completedAt) r.completedAt = j.completedAt;
  if (j.url) r.url = j.url;
  if (j.event) r.event = j.event;
  if (j.mine) r.mine = true;
  if (j.gone) r.gone = true;
  if (j.local) r.local = { result: j.local.result, at: j.local.at };
  r.seq = j.seq || 0;
  return r;
}

/** The local runners as the cards need them (no image / docker status; the job reduced to what the card renders). */
export function wireState(st) {
  return { ...wireMachine(st), repoCount: st.repoCount, machines: (st.machines || []).map(wireMachine) };
}

/** One machine's status line + runner cards. `container` on the wire is the runner's key (the tail id). */
function wireMachine(st) {
  return {
    id: st.id, label: st.label, installed: st.installed, running: st.running, checkedAt: st.checkedAt, error: st.error, stale: st.stale || null, known: st.known || [],
    runners: st.runners.map((r) => ({
      container: r.key || r.container, docker: r.status, runnerName: r.runnerName, labels: r.labels, startedAt: r.startedAt, cpu: r.cpu, mem: r.mem, busy: r.busy, busyState: r.busyState, since: r.since, source: r.source,
      job: r.job ? { id: r.job.id, name: r.job.name, workflow: r.job.workflow, repo: shortRepo(r.job.repo), pr: r.job.pr, prTitle: r.job.prTitle ? cutText(String(r.job.prTitle), 80) : undefined,
        trigger: person(r.job.trigger), actor: person(r.job.actor), prAuthor: person(r.job.prAuthor), startedAt: r.job.startedAt } : null,
      lastDone: r.lastDone, log: r.log,
    })),
  };
}

const LOCAL = { Succeeded: 'success', Failed: 'failure', Canceled: 'cancelled', Cancelled: 'cancelled', Abandoned: 'cancelled' };
const stKey = (j) => (j.status === 'completed' ? (j.conclusion || 'neutral') : j.local ? (LOCAL[j.local.result] || 'neutral') : j.status);
/** The status groups of the filter: running / queued / ok / fail / other. */
export function stGroup(j) { const k = stKey(j); return k === 'in_progress' ? 'running' : k === 'queued' || k === 'pending' || k === 'waiting' ? 'queued' : k === 'success' ? 'ok' : k === 'failure' || k === 'timed_out' || k === 'startup_failure' ? 'fail' : 'other'; }
const people = (j) => [j.trigger, j.actor, j.prAuthor].filter(Boolean).map((p) => p.login);
const labelKey = (j) => (j.status === 'waiting' ? 'waiting' : j.labels && j.labels.length ? j.labels.join(', ') : '-');
const needsSelfHosted = (ls) => ls.length > 0 && !(ls.some((l) => /^(ubuntu|windows|macos)-/.test(l)) && !ls.includes('self-hosted'));
const uniq = (a) => [...new Set(a)].sort();

/** Log of any job: fetched from GitHub on first request, only once the job is completed. */
export async function orgLog(real, id) {
  const j = real.store.get(id);
  if (!j) return { code: 404, text: 'unknown job' };
  if (j.status !== 'completed') return { code: 409, text: 'the job is still running on another machine: its log is available from GitHub only after it completes' };
  const f = path.join(real.dir, 'logs', `${Number(id)}.log`);
  if (!fs.existsSync(f)) await real.fetchJobLog(j);
  return fs.existsSync(f) ? { code: 200, text: fs.readFileSync(f, 'utf8') } : { code: 404, text: 'log not available (expired or not readable)' };
}

/** Steps of one job (the only place they travel). */
export function jobSteps(real, id) {
  const j = real.store.get(id);
  return j ? { id: j.id, status: j.status, steps: j.steps || [] } : null;
}

// ------------------------------------------------------------ runners + aggregates
/** Self-hosted runners seen in the last 24 h (from the jobs they ran, with the labels of those jobs), this machine's runners
 *  from the local state, and the names this machine is known to have had (when docker in WSL is silent). */
export function runnerList(real) {
  const cut = Date.now() - DAY;
  const by = new Map();
  for (const j of real.store.all()) {
    if (!j.runner || HOSTED_RUNNER.test(j.runner)) continue;
    const t = ms(j.completedAt || j.startedAt || j.createdAt);
    if (j.status === 'completed' && t < cut) continue;
    const r = by.get(j.runner) || { name: j.runner, labels: new Set(['self-hosted']), lastSeen: 0, mine: false, jobs: 0, busyJob: null, lastJob: null };
    for (const l of j.labels || []) r.labels.add(String(l).toLowerCase());
    r.jobs++;
    if (t > r.lastSeen) r.lastSeen = t;
    if (j.status === 'in_progress' && !j.local && (!r.busyJob || ms(j.startedAt) > ms(r.busyJob.startedAt))) r.busyJob = j;
    if (!r.lastJob || ms(j.startedAt || j.createdAt) > ms(r.lastJob.startedAt || r.lastJob.createdAt)) r.lastJob = j;
    by.set(j.runner, r);
  }
  const local = new Map(real.allRunners().map((lr) => [lr.runnerName, lr]));
  const names = real.myNames();
  for (const [name, lr] of local) {
    const r = by.get(name) || { name, labels: new Set(['self-hosted']), lastSeen: 0, mine: false, jobs: 0, busyJob: null, lastJob: null };
    for (const l of String(lr.labels || '').split(',')) if (l.trim()) r.labels.add(l.trim().toLowerCase());
    r.mine = true; // lastSeen stays the jobs' own: a Date.now() here would change the list on every push (this machine's runners are never "maybe offline" anyway)
    by.set(name, r);
  }
  for (const name of names) if (!by.has(name)) by.set(name, { name, labels: new Set(), lastSeen: 0, mine: true, jobs: 0, busyJob: null, lastJob: null });
  const out = [];
  for (const r of by.values()) {
    const lr = local.get(r.name);
    const mine = r.mine || names.has(r.name);
    const e = { name: r.name, labels: [...r.labels].sort(), lastSeen: r.lastSeen ? new Date(r.lastSeen).toISOString() : null, jobs: r.jobs };
    if (mine) e.mine = true;
    if (lr) {
      if (lr.busy) e.busy = true;
      if (lr.busyState && lr.busyState !== 'idle') e.busyState = lr.busyState;
      const rec = lr.job && lr.job.id ? real.store.get(lr.job.id) : null;
      if (rec) e.job = slim(rec); else if (lr.job && lr.job.name) e.jobName = lr.job.name;
    } else if (r.busyJob) { e.busy = true; e.job = slim(r.busyJob); }
    if (mine && r.lastJob) e.last = { workflow: r.lastJob.workflow, job: r.lastJob.job, pr: r.lastJob.pr || undefined };
    out.push(e);
  }
  return out.sort((a, b) => (Number(!!b.busy) - Number(!!a.busy)) || b.jobs - a.jobs || (a.name < b.name ? -1 : 1));
}

/** Everything the KPI tiles, the hourly chart and the Queue header need, computed once on the server. */
export function aggregates(real, runners = runnerList(real)) {
  const now = Date.now();
  const names = real.myNames();
  let busy = 0, idle = 0, off = 0, oursBusy = 0;
  for (const r of runners) {
    const isMine = !!r.mine || names.has(r.name);
    if (r.busy) { busy++; if (isMine) oursBusy++; }
    else if (!isMine && (!r.lastSeen || now - Date.parse(r.lastSeen) > H)) off++;
    else idle++;
  }
  const queued = real.store.all().filter((j) => QUEUED.has(j.status) && !j.local).sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
  const waiting = queued.filter((j) => now - ms(j.createdAt) <= GHOST_MS);
  const oldest = waiting.find((j) => j.status !== 'waiting');
  const per = {}; const sets = new Map();
  for (const j of waiting) {
    per[labelKey(j)] = (per[labelKey(j)] || 0) + 1;
    if (j.status === 'waiting') continue;
    const ls = (j.labels || []).map((l) => l.toLowerCase());
    if (needsSelfHosted(ls)) sets.set(ls.join(', '), ls);
  }
  const org = real.store.org();
  const binsEnd = Math.floor(now / H) * H;
  const bins = Array.from({ length: 24 }, () => 0);
  for (const j of org) {
    const k = 23 - Math.floor((binsEnd + H - ms(j.startedAt || j.createdAt)) / H);
    if (k >= 0 && k < 24) bins[k] += 1;
  }
  return { busy, idle, off, total: runners.length, oursBusy, oursTotal: names.size, queued: waiting.length, ghosts: queued.length - waiting.length,
    oldest: oldest ? oldest.createdAt : null, jobs24: org.length, bins, binsEnd, per, sets: [...sets.values()] };
}

/** The queue depth now: jobs waiting for a runner, orphans left out (one sample of the queue-depth chart). */
export function queueDepthNow(real) {
  const now = Date.now();
  return real.store.all().filter((j) => QUEUED.has(j.status) && !j.local && now - ms(j.createdAt) <= GHOST_MS).length;
}

// ------------------------------------------------------------ paginated lists
const limitOf = (q) => Math.min(PAGE_MAX, Math.max(1, Number(q.get('limit')) || PAGE_DEFAULT));
const keyOf = (j) => ms(j.startedAt || j.createdAt);
/** One page of an already filtered list, by cursor `<sortKey>_<id>` (stable while rows are inserted). */
function pageOf(rows, q, key, dir) {
  const cmp = dir === 'asc' ? (a, b) => key(a) - key(b) || a.id - b.id : (a, b) => key(b) - key(a) || b.id - a.id;
  rows.sort(cmp);
  let start = 0;
  const m = /^(\d{1,16})_(\d{1,16})$/.exec(q.get('cursor') || '');
  if (m) {
    const k = Number(m[1]); const id = Number(m[2]);
    start = rows.findIndex((j) => (dir === 'asc' ? key(j) > k || (key(j) === k && j.id > id) : key(j) < k || (key(j) === k && j.id < id)));
    if (start < 0) start = rows.length;
  }
  const lim = limitOf(q);
  const page = rows.slice(start, start + lim);
  const last = page[page.length - 1];
  return { jobs: page.map(slim), next: last && start + lim < rows.length ? `${key(last)}_${last.id}` : null, total: rows.length };
}

/** `/api/ci/org`: the last 24 h, filtered by repo / runner / person / status on the server. */
export function orgPage(real, q) {
  const all = real.store.org();
  const repo = q.get('repo') || ''; const runner = q.get('runner') || ''; const who = q.get('person') || ''; const status = q.get('status') || '';
  const rows = all.filter((j) => (!repo || shortRepo(j.repo) === repo) && (!runner || j.runner === runner) && (!who || people(j).includes(who)) && (!status || stGroup(j) === status));
  const r = pageOf(rows, q, keyOf, 'desc');
  if (!q.get('cursor')) r.options = { repos: uniq(all.map((j) => shortRepo(j.repo)).filter(Boolean)), runners: uniq(all.map((j) => j.runner).filter((x) => x && !HOSTED_RUNNER.test(x))), people: uniq(all.flatMap(people)) };
  return r;
}

/** `/api/ci/real`: this machine's jobs, newest first. */
export function minePage(real, q) {
  const names = real.myNames();
  return pageOf(real.store.all().filter((j) => j.mine || (j.runner && names.has(j.runner))), q, keyOf, 'desc');
}

/** `/api/ci/queue/jobs`: every job queued / waiting now, oldest first; `ghosts=1` lists the orphans instead. */
export function queueJobsPage(real, q) {
  const now = Date.now();
  const queued = real.store.all().filter((j) => QUEUED.has(j.status) && !j.local);
  const waiting = queued.filter((j) => now - ms(j.createdAt) <= GHOST_MS);
  const base = q.get('ghosts') === '1' ? queued.filter((j) => now - ms(j.createdAt) > GHOST_MS) : waiting;
  const repo = q.get('repo') || ''; const who = q.get('person') || ''; const label = q.get('label') || '';
  const rows = base.filter((j) => (!repo || shortRepo(j.repo) === repo) && (!who || people(j).includes(who)) && (!label || labelKey(j) === label));
  const r = pageOf(rows, q, (j) => ms(j.createdAt), 'asc');
  if (!q.get('cursor')) r.options = { repos: uniq(base.map((j) => shortRepo(j.repo)).filter(Boolean)), people: uniq(base.flatMap(people)), labels: uniq(base.map(labelKey)) };
  return r;
}
