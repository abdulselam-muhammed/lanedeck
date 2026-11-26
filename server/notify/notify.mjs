// The GitHub side of the Inbox: your GitHub notifications for the repos linked to lanedeck projects, grouped in sections.
// READ-ONLY on GitHub: every call is a GET through `gh api` (the user's own gh login; no token is read or stored here), counted
// against the shared hourly budget (server/budget.mjs). The list is polled with If-Modified-Since (a 304 costs nothing and is
// refunded) at the larger of the configured interval and GitHub's X-Poll-Interval. A row says what actually happened (merged,
// closed, commented, reviewed, ...; server/notify/events.mjs), never what GitHub's sticky `reason` says: the extra reads that
// tell it (the latest comment, then the subject, then the newest timeline page only when those do not explain the thread's
// updated_at) run only for threads whose updated_at changed, are ETag-cached (a 304 is refunded) and capped per poll, in
// threads and in calls. Notifications of repos that no project links are dropped as soon as
// the list arrives: they are never enriched, stored, logged or sent to the page.
// Read / unread is lanedeck's own state (<data>/data/notify/read.json); nothing is marked read on GitHub. So is the archive
// (<data>/data/notify/archive.json: thread id -> the updated_at it was archived at); nothing is marked done on GitHub, and
// archiving costs no GitHub call.
// Low load: GitHub has no push channel for a user's notifications, so this is ONE server-side poller, and it polls only while
// someone is looking (`wanted()`: a page is connected, or /api/notify was asked within IDLE_GRACE_MS). With nobody looking it
// sleeps (no timer, no gh call); the next page that connects wakes it for one catch-up poll, never sooner than X-Poll-Interval
// after the last one. Every result goes to the open pages through `onChange` (server/index.mjs pushes it over the SSE
// channel), so tabs never poll; the unread counts come from this cached state.
//   GET  /api/notify[?scope=all]   { state, settings, items, counts } for the project (or every project with scope=all)
//   POST /api/notify/read          { ids: [...] } or { all: true }: mark rows of that scope read (local only);
//                                  { ids: [...], unread: true } marks those rows unread again
//   POST /api/notify/refresh       poll GitHub now (at most once every 30 s, and never sooner than X-Poll-Interval)
//   POST /api/notify/archive       { ids: [...] } or { read: true } (every read row of that scope): archive them (local only,
//                                  <data>/data/notify/archive.json); a thread with newer activity comes back by itself
//   POST /api/notify/restore       { ids: [...] } or { all: true }: archived rows of that scope back to the inbox
import fs from "node:fs";
import path from "node:path";
import { getConfig, projectById } from "../config.mjs";
import { refund as budgetRefund, spend as budgetSpend } from "../budget.mjs";
import { killTree, safeSpawn } from "../platform.mjs";
import { scrub } from "../ci/scrub.mjs";
import { archive, countsOf, emptyArchive, emptyRead, errorCode, keepLinked, markRead, markUnread, parseArchive, parseRead, prune, pruneArchive, repoIndex, returned, seed, toItem, unarchive, view } from "./logic.mjs";
import { commentKind, deriveEvent, explained, preSection, refOf } from "./events.mjs";

const WHO = "notify";
const API = "https://api.github.com/";
const ENRICH_PER_POLL = 12; // threads read per poll (the rest next time)
const CALLS_PER_POLL = 30; // gh calls those reads may make per poll
const MAX_TEXT = 8000; // a body is kept this long (enough to find an @mention, small enough to cache)
const DEFER = Symbol("defer"); // out of calls, budget or rate limit: this thread is read again next poll
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

// What is kept of each read (the ETag cache holds these, not GitHub's full answers).
const user = (u) => (u && typeof u === "object" && u.login ? { login: String(u.login), avatar_url: u.avatar_url || null } : null);
const text = (b) => (typeof b === "string" ? b.slice(0, MAX_TEXT) : "");
export const slimComment = (c) => (c && typeof c === "object" && !Array.isArray(c) ? { user: user(c.user), body: text(c.body), html_url: c.html_url || null, created_at: c.created_at || null, submitted_at: c.submitted_at || null, state: c.state || null } : null);
export const slimSubject = (x) => (x && typeof x === "object" && !Array.isArray(x)
  ? { state: x.state || null, merged: !!x.merged, merged_at: x.merged_at || null, merged_by: user(x.merged_by), closed_at: x.closed_at || null, closed_by: user(x.closed_by), user: user(x.user), created_at: x.created_at || null, body: text(x.body), html_url: x.html_url || null, assignees: Array.isArray(x.assignees) ? x.assignees.map(user).filter(Boolean) : null }
  : null);
export const slimTimeline = (list) => (Array.isArray(list)
  ? list.filter((x) => x && typeof x === "object" && x.event).map((x) => ({
    event: String(x.event), created_at: x.created_at || null, submitted_at: x.submitted_at || null, state: x.state || null, body: text(x.body), html_url: x.html_url || null,
    user: user(x.user), actor: user(x.actor), assignee: user(x.assignee), assigner: user(x.assigner), requested_reviewer: user(x.requested_reviewer), review_requester: user(x.review_requester),
    requested_team: x.requested_team ? { name: String(x.requested_team.name || "") } : null,
    comments: Array.isArray(x.comments) && x.comments.length ? [slimComment(x.comments[x.comments.length - 1])] : undefined,
  }))
  : null);
const slimRelease = (r) => (r && typeof r === "object" && !Array.isArray(r) ? { author: user(r.author), name: r.name || null, tag_name: r.tag_name || null, html_url: r.html_url || null, body: text(r.body) } : null);
/** The page number of a Link header's rel (GitHub paginates the timeline oldest first, so the newest events are on the last page). */
export function linkPage(link, rel) {
  for (const part of String(link || "").split(",")) {
    const m = /<([^>]*)>\s*;\s*rel="([^"]+)"/.exec(part);
    if (m && m[2] === rel) { const k = /[?&]page=(\d+)/.exec(m[1]); return k ? Number(k[1]) : null; }
  }
  return null;
}

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
  const archFile = path.join(dir, "archive.json");
  let archState = emptyArchive();
  try { archState = parseArchive(fs.readFileSync(archFile, "utf8")); } catch { /* first run */ }
  const write = (f, v, what) => {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = f + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(v));
      fs.renameSync(tmp, f);
    } catch (e) { console.error(`notify: ${what} not saved:`, scrub(e.message)); }
  };
  const save = () => write(file, readState, "read state");
  const saveArch = () => write(archFile, archState, "archive");

  const cache = new Map(); // api path -> { etag, lastModified, body } (bodies slimmed)
  const lastPage = new Map(); // timeline path -> its last page number
  const details = new Map(); // thread id -> { at, detail }
  let raw = null; // the last notifications list (only kept to re-filter when the linked repos change)
  let items = [];
  let known = null; // thread id -> updated_at of the last poll (null until the first poll)
  let me = null;
  let meTried = 0; // the poll that last tried to learn `me` (at most one try per poll)
  let pollNo = 0;
  let callsLeft = 0;
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
  const opts = (archived = false) => ({ hideSelf: settings().github.hideSelf !== false, arch: archState, archived });
  const gh = () => config().tools.gh;

  /** One GET. `lm`: use If-Modified-Since (the notifications list) instead of If-None-Match. */
  async function get(p, { lm = false, slim = null } = {}) {
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
    const kept = slim ? slim(body) : body;
    cache.delete(p);
    cache.set(p, { etag: h("etag"), lastModified: h("last-modified"), body: kept });
    if (cache.size > 600) cache.delete(cache.keys().next().value);
    return { status, h, body: kept };
  }

  /** An enrichment read: counted against the per-poll cap; out of calls, budget or rate limit -> DEFER (read next poll). */
  async function read(p, slim) {
    if (callsLeft <= 0) throw DEFER;
    callsLeft--;
    const r = await get(p, { slim });
    if (r.budget || r.status === 429 || r.status === 0) throw DEFER;
    return r;
  }

  /** Your login (one call per process; a failure is tried again at most once per poll). Null when unknown. */
  async function login() {
    if (me || meTried === pollNo) return me;
    meTried = pollNo;
    const r = await read("user", (b) => (b && b.login ? { login: String(b.login) } : null));
    if (r.body?.login) me = r.body.login;
    return me;
  }

  /** The newest page of a thread's timeline (the page number is remembered, so later polls ask that page with its ETag). */
  async function timeline(su) {
    const base = su.replace(/\/pulls\/(\d+)$/, "/issues/$1") + "/timeline?per_page=100";
    let page = lastPage.get(base) || 1;
    const at = (k) => (k > 1 ? `${base}&page=${k}` : base);
    let r = await read(at(page), slimTimeline);
    const last = linkPage(r.h?.("link"), "last");
    if (last && last > page) { page = last; r = await read(at(page), slimTimeline); }
    lastPage.delete(base);
    lastPage.set(base, page);
    if (lastPage.size > 400) lastPage.delete(lastPage.keys().next().value);
    return Array.isArray(r.body) ? r.body : null;
  }

  /**
   * What a row needs beyond the list, and what really happened (server/notify/events.mjs):
   *   1. the latest comment, when latest_comment_url is a comment (a 404 = deleted: the row degrades to the subject);
   *   2. the issue / PR itself, when the comment does not explain the thread's updated_at (or there is no comment);
   *   3. the newest timeline page, only when neither explains it (reopened, assigned, review requested, closed PR, ...).
   */
  async function enrich(n) {
    const s = n.subject || {};
    const facts = { comment: null, subject: null, timeline: null, release: null };
    const lc = apiPath(s.latest_comment_url);
    const su = apiPath(s.url);
    const thread = !!su && /^repos\/[\w.-]+\/[\w.-]+\/(issues|pulls)\/\d+$/.test(su) && (s.type === "Issue" || s.type === "PullRequest");
    const needsMe = thread || s.type === "Commit" || s.type === "Release";
    const who = needsMe ? await login() : me;
    const kind = lc && lc !== su ? commentKind(lc) : null;
    if (kind) {
      const c = await read(lc, slimComment);
      if (c.status === 404 || c.status === 410) facts.comment = { missing: true };
      else if (c.body) facts.comment = { kind, user: c.body.user, body: c.body.body, html_url: c.body.html_url, at: c.body.submitted_at || c.body.created_at, state: c.body.state };
    }
    if (thread) {
      // A review on a PR the notification does not say is yours: the subject tells whose PR it is ("reviews" vs "replies").
      const reviewElsewhere = kind === "review" && n.reason !== "author";
      if (!explained(n, facts) || reviewElsewhere) {
        const x = await read(su, slimSubject);
        if (x.body) facts.subject = x.body;
      }
      if (!explained(n, facts)) facts.timeline = await timeline(su);
    } else if (s.type === "Release" && su && /^repos\/[\w.-]+\/[\w.-]+\/releases\/\d+$/.test(su)) {
      const x = await read(su, slimRelease);
      if (x.body) facts.release = x.body;
    }
    return { ...deriveEvent(n, facts, who), ref: refOf(n, facts) };
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
    // The extra reads: rows that are new or have newer activity, newest first, a few per poll (the rest next time). Threads
    // that can only land in "other" (CI, releases, security, watched threads) are not read while that section is hidden.
    pollNo++;
    callsLeft = CALLS_PER_POLL;
    const other = s.github.sections.includes("other");
    const todo = kept.filter((n) => details.get(String(n.id))?.at !== n.updated_at && (other || preSection(n) !== "other")).sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
    for (const n of todo.slice(0, ENRICH_PER_POLL)) {
      if (stopped) return null;
      try { details.set(String(n.id), { at: n.updated_at, detail: await enrich(n) }); } catch (e) {
        if (e === DEFER) break;
        details.set(String(n.id), { at: n.updated_at, detail: { ...deriveEvent(n, {}, me), ref: refOf(n) } }); // unreadable: the generic row
      }
    }
    const live = new Set(kept.map((n) => String(n.id)));
    for (const id of details.keys()) if (!live.has(id)) details.delete(id);
    rebuild();
    let dirty = seed(readState, items);
    // Archived threads with newer activity come back to the inbox (Gmail-style): the archive entry goes, the row is unread.
    let archDirty = returned(archState, items).length > 0;
    // Rows that became unread since the last poll (new threads, or new activity): the page raises a toast for them.
    // Only rows whose event is known count: a row is announced once it says what happened (never "someone did something").
    const shown = view(items, readState, "all", s.github.sections, opts());
    if (known) {
      const fresh = shown.filter((it) => it.unread && it.resolved && known.get(it.id) !== it.at);
      if (fresh.length) { try { onFresh(fresh.slice(0, 5)); } catch { /* listener */ } }
    }
    known = new Map(items.filter((it) => it.resolved).map((it) => [it.id, it.at]));
    const before = Object.keys(readState.read).length;
    prune(readState, live, now());
    if (Object.keys(readState.read).length !== before) dirty = true;
    if (dirty) save();
    const archBefore = Object.keys(archState.threads).length;
    pruneArchive(archState, live, now());
    if (archDirty || Object.keys(archState.threads).length !== archBefore) saveArch();
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
    const rows = s.github.enabled ? view(items, readState, scope, s.github.sections, opts()) : [];
    const arch = s.github.enabled ? view(items, readState, scope, s.github.sections, opts(true)) : [];
    const linked = [...repoIndex(config().projects).entries()].filter(([, ids]) => scope === "all" || ids.includes(scope)).map(([r]) => r);
    const code = state.code === "ok" || state.code === "loading" ? (linked.length || !s.github.enabled ? state.code : "norepos") : state.code;
    return {
      state: { ...state, code, pollSeconds },
      settings: { enabled: s.github.enabled, sections: s.github.sections, pollSeconds: s.github.pollSeconds, hideSelf: s.github.hideSelf !== false, browser: s.browser },
      repos: linked,
      items: rows.slice(0, MAX_ROWS),
      archived: arch.slice(0, MAX_ROWS),
      counts: { ...countsOf(rows), archived: arch.length },
    };
  }

  /** Mark rows of a scope unread again (local only). Returns how many changed. */
  function unreadScope(scope, ids) {
    const want = new Set(ids.map(String));
    const n = markUnread(readState, view(items, readState, scope, settings().github.sections, opts()).filter((r) => want.has(r.id)));
    if (n) { save(); changed(); }
    return n;
  }

  /** Mark rows of a scope read. `ids` = those rows; null = every row of the scope. Returns how many changed. */
  function markScope(scope, ids = null) {
    const rows = view(items, readState, scope, settings().github.sections, opts());
    const want = ids ? new Set(ids.map(String)) : null;
    const n = markRead(readState, want ? rows.filter((r) => want.has(r.id)) : rows);
    if (n) { save(); changed(); }
    return n;
  }

  /** Archive rows of a scope. `ids` = those rows; null = every read row of the scope. Returns how many changed. */
  function archiveScope(scope, ids = null) {
    const rows = view(items, readState, scope, settings().github.sections, opts());
    const want = ids ? new Set(ids.map(String)) : null;
    const n = archive(archState, want ? rows.filter((r) => want.has(r.id)) : rows.filter((r) => !r.unread), now());
    if (n) { saveArch(); changed(); }
    return n;
  }

  /** Archived rows of a scope back to the inbox. `ids` = those rows; null = all of the scope. Returns how many changed. */
  function restoreScope(scope, ids = null) {
    const rows = view(items, readState, scope, settings().github.sections, opts(true));
    const want = ids ? new Set(ids.map(String)) : null;
    const n = unarchive(archState, want ? rows.filter((r) => want.has(r.id)) : rows);
    if (n) { saveArch(); changed(); }
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
    archive: archiveScope,
    restore: restoreScope,
    stop() { stopped = true; clearTimeout(timer); },
    /** /api/notify, /api/notify/read, /api/notify/refresh, /api/notify/archive, /api/notify/restore. `pid` is the project of the URL; ?scope=all asks for every project. */
    async handle(req, res, url, pid) {
      const p = url.pathname;
      if (!["/api/notify", "/api/notify/read", "/api/notify/refresh", "/api/notify/archive", "/api/notify/restore"].includes(p)) return false;
      const scope = url.searchParams.get("scope") === "all" ? "all" : pid;
      if (scope !== "all" && !projectById(scope)) return reply(res, 404, { error: "unknown project" }), true;
      seenAt = now();
      wake();
      if (p === "/api/notify") {
        if (req.method !== "GET") return reply(res, 405, { error: "method not allowed" }), true;
        return reply(res, 200, answer(scope)), true;
      }
      if (req.method !== "POST") return reply(res, 405, { error: "method not allowed" }), true;
      // Local writes only (the read state, the archive). The guard already refused foreign origins and cross-site requests; a JSON body is
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
      if (p === "/api/notify/archive") {
        if (!ids && body.read !== true) return reply(res, 400, { error: "ids or read required" }), true;
        return reply(res, 200, { ok: true, changed: archiveScope(scope, body.read === true ? null : ids), ...answer(scope) }), true;
      }
      if (p === "/api/notify/restore") {
        if (!ids && body.all !== true) return reply(res, 400, { error: "ids or all required" }), true;
        return reply(res, 200, { ok: true, changed: restoreScope(scope, body.all === true ? null : ids), ...answer(scope) }), true;
      }
      if (!ids && body.all !== true) return reply(res, 400, { error: "ids or all required" }), true;
      const n = body.unread === true && ids ? unreadScope(scope, ids) : markScope(scope, body.all === true ? null : ids);
      return reply(res, 200, { ok: true, changed: n, ...answer(scope) }), true;
    },
  };
}
