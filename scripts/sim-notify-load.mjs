// Simulates one hour of the Inbox's GitHub poller against a fake `gh` and reports what it costs, for 0, 1 and 3 open tabs.
//   node scripts/sim-notify-load.mjs [path/to/notify.mjs]      (default: server/notify/notify.mjs)
// The fake GitHub: 4 threads get new activity during the hour (minutes 7, 19, 33, 48); the list answers 304 to
// If-Modified-Since when nothing changed and sends X-Poll-Interval: 60; thread reads honour ETags. Two scenarios:
//   comments  each of the 4 is a new comment (latest_comment_url = the comment);
//   mixed     what a real inbox gets: your own PR is merged (reason mention, latest = the PR itself), the issue it fixes is
//             closed (reason assign), someone approves your PR (latest = the review), an issue of yours is reopened
//             (only the timeline says so).
// Reported per tab count:
//   gh      every `gh api` the poller ran (the list + the enrichment reads)
//   github  the calls GitHub counts against the rate limit (a 304 is not counted)
//   budget  what stays booked on lanedeck's shared hourly budget (server/budget.mjs) after the 304 refunds
//   local   requests the tabs make to /api/notify (the page side; no GitHub call either way)
//   data    SSE notify.data events the tabs receive (the rows changed), summed over the tabs
//   state   SSE notify.state events the tabs receive (a poll ran, rows unchanged: a few hundred bytes), summed over the tabs
// The page side is modelled, not run: before = each tab reads its 2 scopes every 2 minutes and again on every `notify` event;
// after = each tab reads its 2 scopes once, then only receives pushes. `--json` prints the numbers as JSON.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mock } from "node:test";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const json = args.includes("--json");
const modPath = path.resolve(args.find((a) => !a.startsWith("--")) || path.join(ROOT, "server/notify/notify.mjs"));

const T0 = Date.parse("2026-01-05T09:00:00Z");
const HOUR = 3600e3;
const EVENTS_MIN = [7, 19, 33, 48];
const flush = async () => { for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r)); };
const http = (status, body, headers = {}) =>
  `HTTP/2.0 ${status} X\r\n${Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join("\r\n")}${Object.keys(headers).length ? "\r\n" : ""}\r\n${body === undefined ? "" : JSON.stringify(body)}`;

/** One simulated hour with `tabs` open pages. */
export async function simulate(tabs, { mod = modPath, scenario = "comments" } = {}) {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: T0 });
  try {
    const { createNotify } = await import(pathToFileURL(mod).href);
    const { createBudget } = await import(pathToFileURL(path.join(ROOT, "server/budget.mjs")).href);
    const budget = createBudget(() => 100000, () => Date.now());
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ld-sim-"));
    const API = "https://api.github.com/repos/example/repo";
    let gh = 0, github = 0, freshEvents = 0;
    const sent = { "notify.data": 0, "notify.state": 0 };
    const sticky = new Map(); // one project page channel, deduplicated like server/inbox.mjs publish()
    const publishEach = (type, fn) => { const d = fn("sd-sample"); if (d === undefined) return; const t = JSON.stringify(d); if (sticky.get(type) === t) return; sticky.set(type, t); sent[type] += tabs; };
    let push = () => {};
    const threads = new Map(); // id -> { at, comment, kind }
    let lastModified = new Date(T0 - 864e5).toUTCString();
    const iso = (t) => new Date(t).toISOString();
    // mixed: what each thread is, and what GitHub answers for it once its event happened.
    const MIXED = [
      { reason: "mention", type: "PullRequest", lc: "self", subject: (at) => ({ state: "closed", merged: true, merged_at: at, merged_by: { login: "alice" }, closed_at: at, user: { login: "alice" }, created_at: iso(T0 - 864e5) }) },
      { reason: "assign", type: "Issue", lc: "self", subject: (at) => ({ state: "closed", closed_at: at, closed_by: { login: "alice" }, user: { login: "bob" }, created_at: iso(T0 - 864e5), assignees: [{ login: "alice" }] }) },
      { reason: "author", type: "PullRequest", lc: "review", review: (at) => ({ user: { login: "bob" }, state: "APPROVED", submitted_at: at, body: "" }) },
      { reason: "author", type: "Issue", lc: "self", subject: () => ({ state: "open", user: { login: "alice" }, created_at: iso(T0 - 864e5) }), timeline: (at) => [{ event: "closed", actor: { login: "bob" }, created_at: iso(T0 - 7200e3) }, { event: "reopened", actor: { login: "bob" }, created_at: at }] },
    ];
    const note = (id, t) => {
      const m = t.kind != null ? MIXED[t.kind] : null;
      const kind = m?.type === "PullRequest" ? "pulls" : "issues";
      const su = `${API}/${kind}/${id}`;
      const lc = !m ? `${API}/issues/comments/${t.comment}` : m.lc === "self" ? su : `${API}/pulls/${id}/reviews/${t.comment}`;
      return {
        id: String(id), unread: true, reason: m?.reason || "comment", updated_at: t.at,
        subject: { title: `Thread ${id}`, type: m?.type || "Issue", url: su, latest_comment_url: lc },
        repository: { full_name: "example/repo", html_url: "https://github.com/example/repo" },
      };
    };
    threads.set(1, { at: new Date(T0 - 3600e3).toISOString(), comment: 100 });
    threads.set(2, { at: new Date(T0 - 7200e3).toISOString(), comment: 200 });
    const cfg = {
      projects: [{ id: "sd-sample", repo: "example/repo" }],
      tools: { gh: "gh" },
      notifications: { github: { enabled: true, sections: ["mentions", "replies", "review", "reviews", "assigned", "state"], pollSeconds: 60 }, browser: false },
    };
    /** The answer for one thread read: [body, version] (the version changes the ETag). */
    const answerOf = (p) => {
      if (p === "user") return [{ login: "alice" }, 0];
      const id = Number((/\/(?:issues|pulls)\/(\d+)/.exec(p) || [])[1]);
      const t = threads.get(id);
      const m = t?.kind != null ? MIXED[t.kind] : null;
      if (!m) return [{ user: { login: "ana" }, body: "A comment", html_url: "https://github.com/example/repo/issues/1", state: "open" }, 0];
      if (/\/reviews\/\d+$/.test(p)) return [m.review(t.at), t.at];
      if (/\/timeline/.test(p)) return [m.timeline ? m.timeline(t.at) : [], t.at];
      if (/\/reviews\?/.test(p)) return [m.review ? [m.review(t.at)] : [], t.at];
      return [m.subject ? m.subject(t.at) : { state: "open", user: { login: "bob" } }, t.at];
    };
    const run = async (_gh, a) => {
      gh++;
      const p = a.find((x) => /^(notifications|repos\/|user)/.test(x));
      const ims = (a.find((x) => x.startsWith("If-Modified-Since: ")) || "").slice(19);
      const inm = (a.find((x) => x.startsWith("If-None-Match: ")) || "").slice(15);
      if (p.startsWith("notifications")) {
        if (ims && ims === lastModified) return { code: 1, out: http(304, undefined, { "X-Poll-Interval": "60" }), err: "gh: HTTP 304" };
        github++;
        return { code: 0, out: http(200, [...threads].map(([id, t]) => note(id, t)), { "Last-Modified": lastModified, "X-Poll-Interval": "60" }), err: "" };
      }
      const [body, v] = answerOf(p);
      const etag = `"${p}@${v}"`;
      if (inm === etag) return { code: 1, out: http(304, undefined, { ETag: etag }), err: "gh: HTTP 304" };
      github++;
      return { code: 0, out: http(200, body, { ETag: etag }), err: "" };
    };
    const n = createNotify({
      root, run, config: () => cfg, autostart: true,
      spend: (k, who) => budget.spend(k, who), refund: (k, who) => budget.refund(k, who),
      wanted: () => tabs > 0,
      onChange: () => push(),
      onFresh: () => { freshEvents++; },
    });
    if ("wake" in n) {
      const { createNotifyPush } = await import(pathToFileURL(path.join(ROOT, "server/notify/push.mjs")).href);
      push = createNotifyPush({ answer: n.answer, publishEach }).push;
    }
    if (tabs > 0) n.wake?.(); // the tabs connect at the start of the hour
    let next = 0;
    for (let s = 0; s < 3600; s++) {
      const min = s / 60;
      if (next < EVENTS_MIN.length && min >= EVENTS_MIN[next]) {
        const id = next + 3;
        threads.set(id, { at: new Date(Date.now()).toISOString(), comment: 1000 + next, kind: scenario === "mixed" ? next : null });
        lastModified = new Date(Date.now()).toUTCString();
        next++;
      }
      mock.timers.tick(1000);
      await flush();
    }
    n.stop();
    fs.rmSync(root, { recursive: true, force: true });
    const before = !("wake" in n);
    // The page side (modelled): 2 scopes per tab (the project and "all": the sidebar badges and the Inbox).
    const local = before ? tabs * 2 * (1 + 30 + freshEvents) : tabs * 2;
    const rows = n.answer("all").items.map((r) => r.event ? `${r.id}:${r.event}${r.self ? "(you)" : ""}` : `${r.id}:${r.section}`);
    return { tabs, scenario, gh, github, budget: budget.usage().used, local, data: sent["notify.data"], state: sent["notify.state"], rows };
  } finally {
    mock.timers.reset();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const all = [];
  for (const scenario of ["comments", "mixed"]) {
    const rows = [];
    for (const t of [0, 1, 3]) rows.push(await simulate(t, { scenario }));
    all.push(...rows);
    if (json) continue;
    console.log(`${path.relative(ROOT, modPath)}: one simulated hour, scenario ${scenario}`);
    console.log("tabs  gh  github  budget  local  data  state");
    for (const r of rows) console.log(`${String(r.tabs).padStart(4)}  ${String(r.gh).padStart(2)}  ${String(r.github).padStart(6)}  ${String(r.budget).padStart(6)}  ${String(r.local).padStart(5)}  ${String(r.data).padStart(4)}  ${String(r.state).padStart(5)}`);
    console.log(`rows: ${rows[1].rows.join("  ")}`);
  }
  if (json) console.log(JSON.stringify(all));
}
