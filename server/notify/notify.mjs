// The GitHub side of the Inbox: your GitHub notifications for the repos linked to lanedeck projects, grouped in sections.
// READ-ONLY on GitHub: every call is a GET through `gh api` (the user's own gh login; no token is read or stored here), counted
// against the shared hourly budget (server/budget.mjs). The list is polled with If-Modified-Since (a 304 costs nothing and is
// refunded) at the larger of the configured interval and GitHub's X-Poll-Interval; the extra reads that give a row its actor,
// excerpt and link are ETag-cached and capped per poll. Notifications of repos that no project links are dropped as soon as
// the list arrives: they are never enriched, stored, logged or sent to the page.
// Read / unread is lanedeck's own state (<data>/data/notify/read.json); nothing is marked read on GitHub.
// Low load: GitHub has no push channel for a user's notifications, so this is ONE server-side poller, and it polls only while
// someone is looking (`wanted()`: a page is connected, or /api/notify was asked within IDLE_GRACE_MS). With nobody looking it
// sleeps (no timer, no gh call); the next page that connects wakes it for one catch-up poll, never sooner than X-Poll-Interval
// after the last one. Every result goes to the open pages through `onChange` (server/index.mjs pushes it over the SSE
// channel), so tabs never poll; the unread counts come from this cached state.
//   GET  /api/notify[?scope=all]   { state, settings, items, counts } for the project (or every project with scope=all)
//   POST /api/notify/read          { ids: [...] } or { all: true }: mark rows of that scope read (local only);
//                                  { ids: [...], unread: true } marks those rows unread again
//   POST /api/notify/refresh       poll GitHub now (at most once every 30 s, and never sooner than X-Poll-Interval)
import fs from "node:fs";
import path from "node:path";
import { getConfig, projectById } from "../config.mjs";
import { refund as budgetRefund, spend as budgetSpend } from "../budget.mjs";
import { killTree, safeSpawn } from "../platform.mjs";
import { scrub } from "../ci/scrub.mjs";
import { countsOf, emptyRead, errorCode, keepLinked, markRead, markUnread, parseRead, prune, repoIndex, seed, toItem, view } from "./logic.mjs";

const WHO = "notify";
const API = "https://api.github.com/";
const ENRICH_PER_POLL = 12;
const FORCE_MS = 30e3;
const IDLE_GRACE_MS = 180e3; // a plain GET /api/notify (no live channel) keeps the poller awake this long
const MAX_BODY = 64 * 1024;
const MAX_ROWS = 200;

function defaultRun(gh, args, timeout = 30000) {
  return new Promise((resolve) => {
    let done = false, c;
    const finish = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
    const timer = setTimeout(() => { killTree(c); finish({ code: -2, out: "", err: `timeout after ${timeout} ms` }); }, timeout);
    try { c = safeSpawn(gh, args, { windowsHide: true, env: { ...process.env, GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1" } }, (e) => finish({ code: -1, out: "", err: String(e) })); } catch (e) { return finish({ code: -1, out: "", err: String(e) }); }
    const out = [], err = [];
    c.stdout.on("data", (x) => out.push(x));
    c.stderr.on("data", (x) => err.push(x));
    c.on("close", (code) => finish({ code, out: Buffer.concat(out).toString("utf8"), err: Buffer.concat(err).toString("utf8") }));
  });
}

/** An `gh api -i` answer -> { status, head(name), body }. No status line (gh missing, signed out) -> status 0. */
export function parseHttp(out) {
  const text = String(out || "");
  const i = text.search(/\r?\n\r?\n/);
  const head = i < 0 ? text : text.slice(0, i);
  const status = Number((/^HTTP\/[\d.]+\s+(\d+)/m.exec(head) || [])[1] || 0);
  const h = (k) => (new RegExp(`^${k}:\\s*(.+?)\\s*$`, "im").exec(head) || [])[1] || null;
  let body = null;
  if (status && i >= 0) { const raw = text.slice(i).trim(); if (raw) { try { body = JSON.parse(raw); } catch { body = null; } } }
  return { status, h, body };
}

/** Only api.github.com URLs are followed, as a path for `gh api`; anything else is null. */
const apiPath = (u) => (typeof u === "string" && u.startsWith(API) && !/[\s"'`]/.test(u) ? u.slice(API.length) : null);

/**
 * @param {object} o
 * @param {string} o.root         the data root (<root>/data/notify/read.json)
 * @param {Function} [o.run]      (gh, args) -> Promise<{ code, out, err }>; tests pass a fake gh
 * @param {Function} [o.now]
 * @param {Function} [o.config]   () -> the config (projects, notifications, tools)
 * @param {Function} [o.spend], [o.refund]   the shared budget
 * @param {Function} [o.onFresh]  (rows) -> void: rows that became unread since the last poll (never on the first poll)
 * @param {Function} [o.onChange] () -> void: the answer may have changed (after a poll, a mark read / unread): push it to the pages
 * @param {Function} [o.wanted]   () -> boolean: is a page looking? false = sleep until wake()
 * @param {boolean} [o.autostart] start polling (false in tests)
 */
export function createNotify({ root, run = defaultRun, now = Date.now, config = getConfig, spend = budgetSpend, refund = budgetRefund, onFresh = () => {}, onChange = () => {}, wanted = () => true, autostart = true } = {}) {
  const dir = path.join(root, "data", "notify");
  const file = path.join(dir, "read.json");
  let readState = emptyRead();
  try { readState = parseRead(fs.readFileSync(file, "utf8")); } catch { /* first run */ }
  const save = () => {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = file + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(readState));
      fs.renameSync(tmp, file);
    } catch (e) { console.error("notify: read state not saved:", scrub(e.message)); }
  };

  const cache = new Map(); // api path -> { etag, lastModified, body }
  const details = new Map(); // thread id -> { at, detail }
  let raw = null; // the last notifications list (only kept to re-filter when the linked repos change)
  let items = [];
  let known = null; // thread id -> updated_at of the last poll (null until the first poll)
  let me = null;
  let pauseUntil = 0;
  let pollSeconds = 60;
  let forcedAt = 0;
  let timer = null;
  let busy = null;
  let stopped = false;
  let sleeping = false;
  let lastPollAt = 0; // when the notifications list was last asked from GitHub
  let seenAt = 0; // the last GET /api/notify
  const looking = () => { try { return !!wanted() || now() - seenAt < IDLE_GRACE_MS; } catch { return true; } };
  const changed = () => { try { onChange(); } catch { /* listener */ } };
  const state = { code: "loading", text: null, at: null, checkedAt: null, nextAt: null, resetAt: null };
  const settings = () => config().notifications;
  const gh = () => config().tools.gh;

  /** One GET. `lm`: use If-Modified-Since (the notifications list) instead of If-None-Match. */
  async function get(p, { lm = false } = {}) {
    if (!spend(1, WHO)) return { status: 0, budget: true };
    const prev = cache.get(p);
    const args = ["api", "-i", "-H", "Accept: application/vnd.github+json", p];
    if (lm && prev?.lastModified) args.push("-H", `If-Modified-Since: ${prev.lastModified}`);
    else if (!lm && prev?.etag) args.push("-H", `If-None-Match: ${prev.etag}`);
    const r = await run(gh(), args);
    const { status, h, body } = parseHttp(r.out);
    if (status === 304 || status === 0) refund(1, WHO);
    const remaining = h("x-ratelimit-remaining");
    if (status === 429 || (status === 403 && (remaining === "0" || h("retry-after")))) {
      const reset = Number(h("x-ratelimit-reset")) * 1000;
      pauseUntil = Math.max(now() + (Number(h("retry-after")) || 60) * 1000, Number.isFinite(reset) ? reset : 0);
      return { status: 429, h, err: "rate limited" };
    }
    if (status === 304 && prev) return { status, h, body: prev.body, cached: true };
    if (status !== 200) return { status, h, err: (r.err || (body && body.message) || "").trim() };
    cache.set(p, { etag: h("etag"), lastModified: h("last-modified"), body });
    if (cache.size > 600) cache.delete(cache.keys().next().value);
    return { status, h, body };
  }

  async function login() {
    if (me) return me;
    const r = await get("user");
    if (r.body?.login) me = r.body.login;
    return me;
  }

  /** What the row needs beyond the list: who did it, a short excerpt, the html link, review / open-closed state. */
  async function enrich(n) {
    const s = n.subject || {};
    const d = { actor: null, avatar: null, body: "", url: null, review: null, state: null, commented: false, commentAt: null };
    const lc = apiPath(s.latest_comment_url);
    const su = apiPath(s.url);
    if (lc && lc !== su) {
      const c = await get(lc);
      if (c.body && typeof c.body === "object") {
        d.actor = c.body.user?.login || null;
        d.avatar = c.body.user?.avatar_url || null;
        d.body = c.body.body || "";
        d.url = c.body.html_url || null;
        d.commented = true;
        d.commentAt = c.body.submitted_at || c.body.updated_at || c.body.created_at || null;
        if (/\/pulls\/\d+\/reviews\/\d+$/.test(lc) && c.body.state) d.review = { state: c.body.state };
      }
    }
    const thread = su && /^repos\/[\w.-]+\/[\w.-]+\/(issues|pulls)\/\d+$/.test(su);
    if (thread && (!d.commented || n.reason === "state_change")) {
      const x = await get(su);
      if (x.body && typeof x.body === "object") {
        d.state = x.body.merged_at || x.body.merged ? "merged" : x.body.state || null;
        const closer = x.body.merged_by || x.body.closed_by || null;
        if (!d.actor) {
          const who = (d.state !== "open" && (n.reason === "state_change" || n.reason === "author") && closer?.login ? closer : null) || x.body.user || null;
          d.actor = who?.login || null;
          d.avatar = who?.avatar_url || null;
        }
        d.url ||= x.body.html_url || null;
        if (!d.commented && n.reason !== "state_change") d.body = x.body.body || "";
      }
    }
    if (thread && s.type === "PullRequest" && n.reason === "author" && !d.review) {
      const who = await login();
      const rv = await get(`${su}/reviews?per_page=100`);
      if (Array.isArray(rv.body) && who) {
        const latest = rv.body
          .filter((x) => x?.user?.login && x.user.login.toLowerCase() !== who.toLowerCase() && x.submitted_at && x.state && x.state !== "PENDING")
          .sort((a, b) => Date.parse(b.submitted_at) - Date.parse(a.submitted_at))[0];
        const fresh = latest && Date.parse(latest.submitted_at) >= Date.parse(n.updated_at) - 120e3 && (!d.commentAt || Date.parse(latest.submitted_at) >= Date.parse(d.commentAt) - 5e3);
        if (fresh) {
          d.review = { state: latest.state };
          d.actor = latest.user.login;
          d.avatar = latest.user.avatar_url || null;
          d.body = latest.body || d.body;
          d.url = latest.html_url || d.url;
          d.commented = true;
        }
      }
    }
    return d;
  }

  function rebuild() {
    const index = repoIndex(config().projects);
    const kept = keepLinked(raw, index);
    items = kept.map((n) => toItem(n, details.get(String(n.id))?.detail || null, index));
    return { index, kept };
  }

  async function poll() {
    const s = settings();
    state.checkedAt = now();
    if (!s.github.enabled) { Object.assign(state, { code: "disabled", text: null }); items = []; return 30e3; }
    const index = repoIndex(config().projects);
    if (!index.size) { Object.assign(state, { code: "norepos", text: null }); items = []; return 30e3; }
    if (now() < pauseUntil) { Object.assign(state, { code: "ratelimit", resetAt: pauseUntil }); return pauseUntil - now(); }
    // Day-granular `since`, so the URL (and its Last-Modified) stays the same all day.
    const since = new Date(now() - 14 * 864e5).toISOString().slice(0, 10) + "T00:00:00Z";
    lastPollAt = now();
    const r = await get(`notifications?all=true&participating=false&per_page=50&since=${since}`, { lm: true });
    const asked = Number(r.h?.("x-poll-interval")) || 60;
    pollSeconds = Math.max(s.github.pollSeconds, asked);
    if (r.budget) { Object.assign(state, { code: "budget", text: null }); return pollSeconds * 1000; }
    if (r.status === 429) { Object.assign(state, { code: "ratelimit", text: null, resetAt: pauseUntil }); return Math.max(pollSeconds * 1000, pauseUntil - now()); }
    if (r.status !== 200 && r.status !== 304) {
      Object.assign(state, { code: errorCode(r.status, r.err), text: scrub(String(r.err || "").split(/\r?\n/).filter(Boolean).pop() || "").slice(0, 200) || null });
      return Math.max(pollSeconds, 120) * 1000;
    }
    // A classic token without the scope can also get an empty 200: compare what the token has with what the endpoint accepts.
    const has = String(r.h?.("x-oauth-scopes") || "").split(",").map((x) => x.trim()).filter(Boolean);
    const want = String(r.h?.("x-accepted-oauth-scopes") || "").split(",").map((x) => x.trim()).filter(Boolean);
    if (r.status === 200 && has.length && want.length && !want.some((x) => has.includes(x))) {
      Object.assign(state, { code: "scope", text: null });
      return Math.max(pollSeconds, 120) * 1000;
    }
    if (Array.isArray(r.body)) raw = r.body;
    const { kept } = rebuild();
    // The extra reads: rows that are new or have newer activity, newest first, a few per poll (the rest next time).
    const todo = kept.filter((n) => details.get(String(n.id))?.at !== n.updated_at).sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
    for (const n of todo.slice(0, ENRICH_PER_POLL)) {
      if (stopped) return null;
      try { details.set(String(n.id), { at: n.updated_at, detail: await enrich(n) }); } catch { /* the row shows without its detail */ }
    }
    const live = new Set(kept.map((n) => String(n.id)));
    for (const id of details.keys()) if (!live.has(id)) details.delete(id);
    rebuild();
    let dirty = seed(readState, items);
    // Rows that became unread since the last poll (new threads, or new activity): the page raises a toast for them.
    const shown = view(items, readState, "all", s.github.sections);
    if (known) {
      const fresh = shown.filter((it) => it.unread && known.get(it.id) !== it.at);
      if (fresh.length) { try { onFresh(fresh.slice(0, 5)); } catch { /* listener */ } }
    }
    known = new Map(items.map((it) => [it.id, it.at]));
    const before = Object.keys(readState.read).length;
    prune(readState, live, now());
    if (Object.keys(readState.read).length !== before) dirty = true;
    if (dirty) save();
    Object.assign(state, { code: "ok", text: null, at: now(), resetAt: null });
    return pollSeconds * 1000;
  }

  /** Nobody is looking: no timer, no gh call, until wake(). */
  function sleep() { clearTimeout(timer); timer = null; sleeping = true; state.nextAt = null; }
  function schedule(ms) {
    if (stopped) return;
    clearTimeout(timer);
    if (!looking()) return sleep();
    sleeping = false;
    ms = Math.min(Math.max(ms, 1000), 3600e3);
    state.nextAt = now() + ms;
    // Checked again when it fires: the last page may have gone in the meantime.
    timer = setTimeout(() => (looking() ? tick() : sleep()), ms);
    timer.unref?.();
  }
  function tick() {
    if (busy) return busy;
    busy = poll()
      .catch((e) => { Object.assign(state, { code: "failed", text: scrub(String(e?.message || e)).slice(0, 200) }); return 120e3; })
      .then((ms) => { busy = null; if (ms != null) schedule(ms); changed(); });
    return busy;
  }
  /** A page arrived: a sleeping poller does one catch-up poll, never sooner than X-Poll-Interval after the last one. */
  function wake() {
    if (stopped || busy || !sleeping) return;
    sleeping = false;
    schedule(Math.max(0, lastPollAt + pollSeconds * 1000 - now()));
  }
  // The first poll waits for the first page (it starts asleep when nobody is looking).
  if (autostart) { timer = setTimeout(() => (looking() ? tick() : sleep()), 4000); timer.unref?.(); }

  /** The answer for one scope ("all" or a project id). */
  function answer(scope) {
    const s = settings();
    const rows = s.github.enabled ? view(items, readState, scope, s.github.sections) : [];
    const linked = [...repoIndex(config().projects).entries()].filter(([, ids]) => scope === "all" || ids.includes(scope)).map(([r]) => r);
    const code = state.code === "ok" || state.code === "loading" ? (linked.length || !s.github.enabled ? state.code : "norepos") : state.code;
    return {
      state: { ...state, code, pollSeconds },
      settings: { enabled: s.github.enabled, sections: s.github.sections, pollSeconds: s.github.pollSeconds, browser: s.browser },
      repos: linked,
      items: rows.slice(0, MAX_ROWS),
      counts: countsOf(rows),
    };
  }

  /** Mark rows of a scope unread again (local only). Returns how many changed. */
  function unreadScope(scope, ids) {
    const want = new Set(ids.map(String));
    const n = markUnread(readState, view(items, readState, scope, settings().github.sections).filter((r) => want.has(r.id)));
    if (n) { save(); changed(); }
    return n;
  }

  /** Mark rows of a scope read. `ids` = those rows; null = every row of the scope. Returns how many changed. */
  function markScope(scope, ids = null) {
    const rows = view(items, readState, scope, settings().github.sections);
    const want = ids ? new Set(ids.map(String)) : null;
    const n = markRead(readState, want ? rows.filter((r) => want.has(r.id)) : rows);
    if (n) { save(); changed(); }
    return n;
  }

  const reply = (res, code, body) => {
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.end(JSON.stringify(body));
  };
  const readBody = (req) => new Promise((resolve) => {
    let size = 0;
    const parts = [];
    req.on("data", (c) => { size += c.length; if (size > MAX_BODY) { req.destroy(); resolve(null); } else parts.push(c); });
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(parts).toString("utf8") || "{}")); } catch { resolve(null); } });
    req.on("error", () => resolve(null));
  });

  return {
    answer,
    tick,
    wake,
    /** True while the poller sleeps (nobody looking). */
    sleeping: () => sleeping,
    markRead: markScope,
    stop() { stopped = true; clearTimeout(timer); },
    /** /api/notify, /api/notify/read, /api/notify/refresh. `pid` is the project of the URL; ?scope=all asks for every project. */
    async handle(req, res, url, pid) {
      const p = url.pathname;
      if (p !== "/api/notify" && p !== "/api/notify/read" && p !== "/api/notify/refresh") return false;
      const scope = url.searchParams.get("scope") === "all" ? "all" : pid;
      if (scope !== "all" && !projectById(scope)) return reply(res, 404, { error: "unknown project" }), true;
      seenAt = now();
      wake();
      if (p === "/api/notify") {
        if (req.method !== "GET") return reply(res, 405, { error: "method not allowed" }), true;
        return reply(res, 200, answer(scope)), true;
      }
      if (req.method !== "POST") return reply(res, 405, { error: "method not allowed" }), true;
      // Local writes only (the read state). The guard already refused foreign origins and cross-site requests; a JSON body is
      // also required, which a plain HTML form cannot send.
      if (!/^application\/json\b/i.test(String(req.headers["content-type"] || ""))) return reply(res, 415, { error: "application/json required" }), true;
      const body = await readBody(req);
      if (!body || typeof body !== "object") return reply(res, 400, { error: "bad body" }), true;
      if (p === "/api/notify/refresh") {
        // A forced poll still obeys GitHub's X-Poll-Interval: inside it the cached answer is the freshest there is.
        const gap = Math.max(FORCE_MS, pollSeconds * 1000);
        if (now() - forcedAt >= FORCE_MS && now() - lastPollAt >= gap) { forcedAt = now(); clearTimeout(timer); await tick(); }
        return reply(res, 200, answer(scope)), true;
      }
      const ids = Array.isArray(body.ids) ? body.ids.filter((x) => /^\d{1,30}$/.test(String(x))).slice(0, 500) : null;
      if (!ids && body.all !== true) return reply(res, 400, { error: "ids or all required" }), true;
      const n = body.unread === true && ids ? unreadScope(scope, ids) : markScope(scope, body.all === true ? null : ids);
      return reply(res, 200, { ok: true, changed: n, ...answer(scope) }), true;
    },
  };
}
