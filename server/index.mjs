// lanedeck — one process, bound to the configured host (127.0.0.1 by default).
//
//   npm run build && npm start      production (recommended for daily use)
//   npm run dev                     development, with hot reload
//
// Why a small custom server and not Next route handlers: the data side keeps state for the
// whole life of the process (fs.watch on the inbox, the snapshot cache, the incremental
// transcript scan, the per-agent progress high-water marks, the default-branch check every minute, the SSE
// clients). Route handlers can be loaded more than once (dev reloads, separate bundles), which
// would duplicate the watchers and timers and split the caches. Here they live once, in
// server/inbox.mjs, and the API shapes stay exactly as before:
//   GET /api/config        the public part of the config (project, ui, profile): no paths, no hosts
//   /api/settings, /api/devices[/test], /api/projects/detect   the settings page (server/settings.mjs): local-only, CSRF-protected writes
//   Project routes: /api/p/<project>/{snapshot,branch,events,prs/...}; the old /api/{snapshot,branch,events,prs/...} are aliases of the FIRST project.
//   GET /api/p/:p/snapshot the project's inbox files + its live agents (cached, rebuilt on every change)
//   GET /api/p/:p/branch[?pull=1]  our last pull of origin/<defaultBranch> vs the branch on GitHub
//   GET /api/p/:p/events   SSE, the one live channel of a project page: snapshot, inbox, agents, ci.runners, branch, notify.*, ping
//   GET /api/agents        the agents of EVERY project under ~/.claude/projects (agents.windowHours, default 48 h, capped), each tagged with its project or "other"; `hidden`: ids hidden from the list
//   POST /api/agents/hidden  { action: hide|unhide|unhideAll, ids } -> the hidden list in <config folder>/hidden-agents.json (local-only, CSRF; Claude Code files untouched)
//   GET /api/machine       per-project counters for the machine overview + the shared GitHub budget
//   GET /api/skills        the plugin skills (plugin/skills/*/SKILL.md: name, description, body), read on every call
//   GET /api/ci/*          the CI runners panel (server/ci/http.mjs): read-only, same process and port
//   WS  /api/ci/ws         the panel's one live channel (server/ci/live.mjs); every other upgrade is Next's own
//   GET /api/load          machine load: CPU/RAM/disk, grouped processes, WSL docker, ETA (server/load/load.mjs): read-only
//   GET /api/prs/*, WS /api/prs/ws   the PR control board (server/prs/board.mjs): read-only
//   GET /api/p/:p/notify   the Inbox's GitHub tab (server/notify/notify.mjs): read-only on GitHub; POST .../notify/read keeps the local read state;
//                          POST .../notify/archive and .../notify/restore keep the local archive (nothing is written to GitHub);
//                          the rows also ride the SSE channel (notify.data / notify.state), so the pages do not poll this
//   GET /api/p/:p/mine     "Your work": your issues, your PRs (from the board), what is asked of you (server/mine/mine.mjs): read-only
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import next from "next";
import { listSkills } from "./skills.mjs";
import { createGuard, refuseHttp, refuseSocket } from "./guard.mjs";
import config, { configPath, getConfig, publicConfig, projectById, remoteAuthProblem } from "./config.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Where the runners / PR board keep their cache (<DATA_ROOT>/data/...). The npm launcher sets LANEDECK_DATA_DIR because an installed package folder may be read-only.
const DATA_ROOT = process.env.LANEDECK_DATA_DIR || ROOT;
const HOST = config.server.host;
const PORT = config.server.port;
const ALLOWED_HOSTS = config.server.allowedHosts;
const dev = process.argv.includes("--dev");
{
  // Reachable from outside with no access token: refuse to start (server/guard.mjs, config.mjs remoteAuthProblem).
  const problem = remoteAuthProblem(config.server);
  if (problem) {
    console.error(`lanedeck will not start: ${problem}\nConfig file: ${configPath()}`);
    process.exit(1);
  }
}
// The one Host / Origin / access-token guard, run before every handler (server/guard.mjs). The token is read live, so a rotation
// in Settings applies at once.
const guard = createGuard({
  port: PORT, allowedHosts: ALLOWED_HOSTS,
  auth: () => ({ token: getConfig().server.accessToken, allowUnauthenticatedRemote: getConfig().server.allowUnauthenticatedRemote }),
});
if (!dev) process.env.NODE_ENV = "production";

const inbox = await import("./inbox.mjs");
const FIRST = getConfig().projects[0].id;
inbox.startFirst();
const { createCi } = await import("./ci/http.mjs");
const ci = createCi({ root: DATA_ROOT });
// The runners summary rides the same SSE channel as the inbox (event `ci.runners`): published when the CI reader learns
// something (debounced to <= 1 per 2 s) and every 30 s (time moves the numbers); skipped when unchanged.
{
  let t = null;
  const pushCi = () => {
    t = null;
    try { inbox.publish("ci.runners", ci.summary()); } catch (e) { console.error("ci.runners", e.message); }
  };
  const schedule = () => { if (!t) t = setTimeout(pushCi, 2000); };
  ci.onChange(schedule);
  setInterval(schedule, 30000).unref?.();
  setTimeout(pushCi, 3000).unref?.();
}
const { createPrs } = await import("./prs/board.mjs");
const prs = createPrs({ root: DATA_ROOT, firstId: FIRST, projectOf: projectById });
const { createMine } = await import("./mine/mine.mjs");
const { createArchiveApi } = await import("./archive.mjs");
const mine = createMine({ boardOf: prs.boardOf, projectOf: projectById });
// The Inbox's GitHub tab: one poller for every linked repo, awake only while a page is connected (it sleeps at 0 pages and a
// connecting page wakes it). Its rows are pushed to the pages as the sticky `notify.data` / `notify.state` events
// (server/notify/push.mjs), so tabs never poll. New unread rows also go out as a `notify` event (not sticky: an old toast is
// never replayed).
const { createNotify } = await import("./notify/notify.mjs");
const { createNotifyPush } = await import("./notify/push.mjs");
let notifyPush = null;
const notify = createNotify({
  root: DATA_ROOT,
  wanted: () => inbox.clientCount() > 0,
  onFresh: (fresh) => inbox.sendEvent("notify", { at: Date.now(), fresh }),
  onChange: () => notifyPush?.push(),
});
notifyPush = createNotifyPush({ answer: notify.answer, publishEach: inbox.publishEach });
inbox.onClient((pid) => {
  notifyPush.push(pid);
  setTimeout(() => notify.wake(), 0); // after the page is counted (server/inbox.mjs addSseClient)
});
const { usage: githubUsage } = await import("./budget.mjs");
const { createLoad } = await import("./load/load.mjs");
const { features: platformFeatures } = await import("./platform.mjs");
const { createRemote } = await import("./load/remote.mjs");
const remote = createRemote();
const load = createLoad({ machines: remote.list });
const { createSettings } = await import("./settings.mjs");
const settings = createSettings({ port: PORT, broadcast: inbox.sendEvent, refresh: (id) => inbox.getInbox(id)?.refresh(), reloaded: () => { inbox.pruneInstances(); notifyPush.push(); } });
const app = next({ dev, dir: ROOT, hostname: HOST, port: PORT });
const handle = app.getRequestHandler();
await app.prepare();

const archiveApi = createArchiveApi({ inbox: (id) => inbox.getInbox(id) });
const json = (res, body) => {
  res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

/** /api/p/<id>/<rest> -> { pid, url } with the path rewritten to /api/<rest>; anything else -> the first project. A bad id is null. */
function scoped(url) {
  const m = /^\/api\/p\/([\w-]{1,40})(\/.*)$/.exec(url.pathname);
  if (!m) return { pid: FIRST, url };
  const u = new URL(url.href);
  u.pathname = "/api" + m[2];
  return { pid: m[1], url: u };
}
const notFound = (res, what) => { res.writeHead(404, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ error: what })); };

const server = createServer(async (req, res) => {
  try {
    const url0 = new URL(req.url ?? "/", "http://localhost");
    if (guard.exchange(req, res, url0)) return;
    const api = url0.pathname.startsWith("/api/");
    const refused = guard.check(req, api);
    if (refused) return refuseHttp(res, refused, { html: !api && !url0.pathname.startsWith("/_next/") });
    const { pid, url } = scoped(url0);
    if (pid !== FIRST || url !== url0) {
      if (!projectById(pid)) return notFound(res, "unknown project");
    }
    if (url.pathname.startsWith("/api/ci/") && (await ci(req, res, url))) return;
    if (url.pathname.startsWith("/api/prs/") && (await prs.handle(req, res, url, pid))) return;
    if (url.pathname.startsWith("/api/archive") && (await archiveApi.handle(req, res, url, pid))) return;
    if (url.pathname === "/api/mine" && (await mine.handle(req, res, url, pid))) return;
    if (url.pathname.startsWith("/api/notify") && (await notify.handle(req, res, url, pid))) return;
    if (req.method === "GET" && url.pathname === "/api/agents") return json(res, await inbox.allAgents());
    if (req.method === "GET" && url.pathname === "/api/skills") return json(res, { skills: await listSkills() });
    if (req.method === "GET" && url.pathname === "/api/machine") return json(res, { projects: inbox.summaries(), github: githubUsage(), now: Date.now() });
    if (url.pathname === "/api/load" && ((await remote.handle(req, res, url)) || (await load.handle(req, res, url)))) return;
    if ((url.pathname === "/api/settings" || url.pathname === "/api/settings/token" || url.pathname === "/api/devices" || url.pathname.startsWith("/api/devices/") || url.pathname === "/api/projects/detect" || url.pathname === "/api/agents/hidden") && (await settings.handle(req, res, url))) return;
    // setup writes into a project: only through the explicit /api/p/<id>/setup form, never the first-project alias
    if ((url.pathname === "/api/setup" || url.pathname === "/api/setup/instructions" || url.pathname === "/api/setup/done") && url !== url0 && (await settings.handle(req, res, url, pid))) return;
    if (req.method === "GET" && url.pathname === "/api/config") return json(res, publicConfig());
    if (req.method === "GET" && url.pathname === "/api/snapshot") return json(res, await inbox.getInbox(pid).quickSnapshot());
    if (req.method === "GET" && url.pathname === "/api/branch") return json(res, await inbox.getInbox(pid).branchAnswer(url.searchParams.has("pull")));
    if (req.method === "GET" && url.pathname === "/api/events") return void (await inbox.getInbox(pid).addSseClient(req, res));
    await handle(req, res);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
    res.end("error");
  }
});

// Only /api/ci/ws and /api/prs/ws are ours; any other upgrade (Next's dev HMR) is left to the handlers Next registers itself.
// Every upgrade, ours or Next's, passes the guard first; a refused one is answered and closed here.
server.prependListener("upgrade", (req, socket) => {
  const refused = guard.check(req);
  if (refused) refuseSocket(socket, refused);
});
server.on("upgrade", (req, socket, head) => {
  if (socket.destroyed) return;
  let url;
  try { url = new URL(req.url ?? "/", "http://localhost"); } catch { return; }
  const sc = scoped(url);
  if (sc.url.pathname === "/api/prs/ws") {
    try { prs.upgrade(req, socket, head, sc.pid); } catch (error) { console.error(error); socket.destroy(); }
    return;
  }
  if (url.pathname !== "/api/ci/ws") return;
  try { ci.upgrade(req, socket, head, url); } catch (error) { console.error(error); socket.destroy(); }
});

server.listen(PORT, HOST, () => {
  console.log(
    `${config.ui.title} (${dev ? "dev" : "production"}): http://localhost:${PORT}  (${getConfig().projects.length} project(s); first: ${FIRST}, watching ${inbox.getInbox(FIRST).INBOX} and the agents under ${inbox.getInbox(FIRST).PROJECT})`,
  );
  const f = platformFeatures();
  if (f.platform !== "win32") console.log(`Platform: ${f.platformName}. ${f.note} The CI panel for this machine needs the native docker CLI; see README "Platform support".`);
});
