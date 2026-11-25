// "Your work" (/p/<project>/mine): your open issues, your open PRs and what is asked of you, on the project's repo.
// READ-ONLY. ONE GraphQL call (four aliased searches, scoped to the repo) per read, through the shared GitHub budget
// (server/budget.mjs). GraphQL has no ETags, so the answer is cached and only re-read while someone is looking: a request
// older than the board's cadence (75 s) starts a read in the background and is answered from the cache at once.
// Your PRs are not fetched here: they come from the PR board (server/prs/board.mjs), which already holds them.
//   GET /api/mine             { at, me, repo, issues, prs, asked, counts, error } (the first call waits for the first read)
//   GET /api/mine?refresh=1   the same, after a fresh read (at most one forced read every 20 s)
import config from "../config.mjs";
import { spend } from "../budget.mjs";
import { killTree, safeSpawn } from "../platform.mjs";
import { attention, isBot, needsCount, pendingMention, prGroup, replyState } from "./logic.mjs";

const FRESH_MS = 75e3;
const FORCE_MS = 20e3;

const COMMENT = "author{__typename login} createdAt";
const ISSUE = `number title url createdAt updatedAt author{login}
  labels(first:8){nodes{name color}}
  comments(last:20){nodes{${COMMENT}}}
  closedByPullRequestsReferences(first:5,includeClosedPrs:true){nodes{number url state}}
  timelineItems(last:30,itemTypes:[CROSS_REFERENCED_EVENT,ASSIGNED_EVENT]){nodes{__typename
    ... on CrossReferencedEvent{createdAt source{__typename ... on PullRequest{number url state repository{nameWithOwner}}}}
    ... on AssignedEvent{createdAt assignee{... on User{login}}}}}`;
const THREAD = `number title url createdAt updatedAt author{login} body comments(last:20){nodes{${COMMENT} body}}`;
export const QUERY = `query($a:String!,$o:String!,$r:String!,$m:String!){ viewer{login} rateLimit{cost remaining}
 assigned: search(query:$a,type:ISSUE,first:40){ issueCount nodes{ ... on Issue{ ${ISSUE} } } }
 opened: search(query:$o,type:ISSUE,first:40){ issueCount nodes{ ... on Issue{ ${ISSUE} } } }
 review: search(query:$r,type:ISSUE,first:30){ issueCount nodes{ ... on PullRequest{ number title url isDraft createdAt updatedAt author{login} } } }
 mentions: search(query:$m,type:ISSUE,first:30){ issueCount nodes{ __typename
   ... on Issue{ ${THREAD} }
   ... on PullRequest{ ${THREAD} reviews(last:10){nodes{${COMMENT} submittedAt body}} } } } }`;

/** The four search strings for a repo. */
export const searches = (repo) => ({
  a: `repo:${repo} is:issue is:open assignee:@me sort:updated-desc`,
  o: `repo:${repo} is:issue is:open author:@me sort:updated-desc`,
  r: `repo:${repo} is:pr is:open review-requested:@me sort:updated-desc`,
  m: `repo:${repo} is:open mentions:@me sort:updated-desc`,
});

const slimComments = (nodes) => (nodes || []).map((c) => ({ by: c.author?.login || null, bot: isBot(c.author), at: c.createdAt || c.submittedAt || null, body: c.body }));

/** One issue row from the GraphQL node: labels, last comment, linked PRs, the new-reply marker. */
export function issueRow(x, me, why) {
  const comments = slimComments(x.comments?.nodes);
  const timeline = x.timelineItems?.nodes || [];
  const assignedAt = timeline.filter((e) => e.__typename === "AssignedEvent" && e.assignee?.login && e.assignee.login.toLowerCase() === String(me).toLowerCase()).map((e) => e.createdAt);
  const opened = x.author?.login && me && x.author.login.toLowerCase() === me.toLowerCase() ? [x.createdAt] : [];
  const st = replyState(comments, me, [...opened, ...assignedAt]);
  const linked = new Map();
  for (const p of x.closedByPullRequestsReferences?.nodes || []) if (p?.number) linked.set(p.number, { number: p.number, url: p.url, state: p.state, closes: true });
  for (const e of timeline) {
    const s = e.__typename === "CrossReferencedEvent" ? e.source : null;
    if (s?.__typename === "PullRequest" && s.number && !linked.has(s.number)) linked.set(s.number, { number: s.number, url: s.url, state: s.state, closes: false, repo: s.repository?.nameWithOwner || null });
  }
  return {
    number: x.number, title: x.title, url: x.url, updated: x.updatedAt, why,
    labels: (x.labels?.nodes || []).map((l) => ({ name: l.name, color: l.color })),
    last: st.last, newReply: st.newReply, replyBy: st.replyBy, replyAt: st.replyAt,
    // Closing PRs first, then open ones, newest first.
    linked: [...linked.values()].sort((a, b) => Number(b.closes) - Number(a.closes) || Number(b.state === "OPEN") - Number(a.state === "OPEN") || b.number - a.number).slice(0, 6),
  };
}

/** The page's answer from one GraphQL answer and the PR board. Pure: the tests feed it fixtures. */
export function buildMine(d, board, repo) {
  const me = d.viewer?.login || board?.me || null;
  const issues = new Map();
  for (const [alias, why] of [["assigned", "assigned"], ["opened", "opened"]])
    for (const x of d[alias]?.nodes || []) {
      if (!x?.number) continue;
      const prev = issues.get(x.number);
      issues.set(x.number, prev ? { ...prev, why: "both" } : issueRow(x, me, why));
    }
  const issueList = [...issues.values()].sort((a, b) => Number(b.newReply) - Number(a.newReply) || Date.parse(b.updated) - Date.parse(a.updated));

  // The board answers before its first read of the open PRs (a merged-list read can come first): that is still loading.
  const prs = board && !board.loading && board.readAt && Array.isArray(board.prs)
    ? board.prs.filter((p) => p.mine).map((p) => {
      const g = prGroup(p);
      return { number: p.number, title: p.title, url: p.url, draft: p.draft, updated: p.updated, stage: p.stage, parent: p.parent ?? null, ...g, last: p.talk?.last ?? null, replyBy: p.talk?.replyBy ?? null, replyAt: p.talk?.replyAt ?? null, ci: { pass: p.ci.pass, fail: p.ci.fail, run: p.ci.run + p.ci.queue } };
    }).sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated))
    : null;

  const asked = [];
  const reviewSet = new Set();
  for (const x of d.review?.nodes || []) {
    if (!x?.number || x.isDraft) continue;
    reviewSet.add(x.number);
    asked.push({ kind: "review", type: "pr", number: x.number, title: x.title, url: x.url, by: x.author?.login || null, at: x.updatedAt });
  }
  const mineSet = new Set([...issues.keys(), ...(prs || []).map((p) => p.number)]);
  for (const x of d.mentions?.nodes || []) {
    if (!x?.number || reviewSet.has(x.number) || mineSet.has(x.number)) continue;
    const comments = [...slimComments(x.comments?.nodes), ...slimComments(x.reviews?.nodes).filter((c) => c.body?.trim())];
    const m = pendingMention({ by: x.author?.login, at: x.createdAt, body: x.body, comments }, me);
    if (m) asked.push({ kind: "mention", type: x.__typename === "PullRequest" ? "pr" : "issue", number: x.number, title: x.title, url: x.url, by: m.by, at: m.at });
  }
  asked.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const prList = prs || [];
  const counts = {
    issues: issueList.length, issuesNew: issueList.filter((i) => i.newReply).length,
    prs: prList.length, needs: prList.filter((p) => p.group === "needs").length, waiting: prList.filter((p) => p.group === "waiting").length, ready: prList.filter((p) => p.group === "ready").length,
    asked: asked.length,
    needsYou: needsCount({ issues: issueList, prs: prList, asked }),
  };
  return { me, repo, issues: issueList, prs, asked, counts, attention: attention({ issues: issueList, prs: prList, asked }), rl: d.rateLimit || null };
}

/** Why a read failed, as a code the page turns into a friendly hint. */
export function errorCode(text) {
  const s = String(text || "");
  if (/budget/i.test(s)) return "budget";
  if (/ENOENT|not recognized|not found|cannot find/i.test(s) && !/Could not resolve to/i.test(s)) return "nogh";
  if (/auth login|not logged|authenticat|401|bad credentials/i.test(s)) return "auth";
  if (/Could not resolve to a Repository|NOT_FOUND/i.test(s)) return "repo";
  if (/resolve host|ENOTFOUND|network|timeout/i.test(s)) return "network";
  return "failed";
}

function run(cmd, args, timeout = 45000) {
  return new Promise((resolve) => {
    let done = false, c;
    const finish = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
    const timer = setTimeout(() => { killTree(c); finish({ code: -2, out: "", err: `timeout after ${timeout} ms` }); }, timeout);
    try { c = safeSpawn(cmd, args, { windowsHide: true, env: { ...process.env, GH_PROMPT_DISABLED: "1" } }, (e) => finish({ code: -1, out: "", err: String(e) })); } catch (e) { return finish({ code: -1, out: "", err: String(e) }); }
    const out = [], err = [];
    c.stdout.on("data", (x) => out.push(x));
    c.stderr.on("data", (x) => err.push(x));
    c.on("close", (code) => finish({ code, out: Buffer.concat(out).toString("utf8"), err: Buffer.concat(err).toString("utf8") }));
  });
}

/** The /api/mine route for every project. `boardOf(pid)` gives the project's PR board (or null), `projectOf(pid)` its config. */
export function createMine({ boardOf, projectOf }) {
  const state = new Map(); // pid -> { data, at, error, busy: Promise | null, forcedAt }

  async function read(pid) {
    const P = projectOf(pid);
    const s = state.get(pid);
    if (!P?.repo) { s.error = { code: "norepo", text: "no repo configured for this project" }; s.at = Date.now(); return; }
    if (!spend(1, `mine:${pid}`)) { s.error = { code: "budget", text: "GitHub request budget for this hour is used up" }; return; }
    const v = searches(P.repo);
    const args = ["api", "graphql", "-f", `query=${QUERY}`];
    for (const [k, x] of Object.entries(v)) args.push("-f", `${k}=${x}`);
    const r = await run(config.tools.gh, args);
    let d = null;
    if (r.code === 0) { try { d = JSON.parse(r.out).data; } catch { /* below */ } }
    if (!d) {
      const text = (r.err || r.out || "").trim().split(/\r?\n/).filter(Boolean).pop() || "GitHub did not answer";
      s.error = { code: errorCode(r.err || r.out), text: text.slice(0, 300) };
      return;
    }
    s.data = d; s.at = Date.now(); s.error = null;
  }

  function refresh(pid) {
    const s = state.get(pid);
    if (!s.busy) s.busy = read(pid).catch((e) => { s.error = { code: "failed", text: String(e?.message || e) }; }).finally(() => { s.busy = null; });
    return s.busy;
  }

  function answer(pid) {
    const s = state.get(pid);
    const board = boardOf(pid);
    const P = projectOf(pid);
    const base = s.data ? buildMine(s.data, board, P?.repo || null) : { me: board?.me || null, repo: P?.repo || null, issues: [], prs: null, asked: [], counts: null, attention: [] };
    return { ...base, at: s.at, error: s.error, boardLoading: !board || !!board.loading || !board.readAt, boardError: board?.error || null };
  }

  return {
    async handle(req, res, url, pid) {
      if (url.pathname !== "/api/mine") return false;
      const reply = (code, body) => {
        res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
        res.end(JSON.stringify(body));
      };
      if (req.method !== "GET") return reply(405, { error: "read-only" }), true;
      if (!projectOf(pid)) return reply(404, { error: "unknown project" }), true;
      if (!state.has(pid)) state.set(pid, { data: null, at: 0, error: null, busy: null, forcedAt: 0 });
      const s = state.get(pid);
      const force = url.searchParams.has("refresh") && Date.now() - s.forcedAt > FORCE_MS;
      if (force) s.forcedAt = Date.now();
      if (force || (!s.data && !s.error)) await refresh(pid);
      else if (Date.now() - s.at > FRESH_MS) refresh(pid);
      return reply(200, answer(pid)), true;
    },
  };
}
