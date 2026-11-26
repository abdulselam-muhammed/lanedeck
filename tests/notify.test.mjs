import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { archive, countsOf, DEFAULT_SECTIONS, emptyArchive, isArchived, parseArchive, pruneArchive, returned, unarchive, errorCode, emptyRead, excerpt, guessSection, htmlOf, isUnread, keepLinked, markRead, markUnread, parseRead, prune, repoIndex, safeAvatar, seed, SECTIONS, toItem, view } from "../server/notify/logic.mjs";
import { createNotify, parseHttp } from "../server/notify/notify.mjs";

const PROJECTS = [
  { id: "sd-sample", repo: "example/repo" },
  { id: "sd-sample-2", repo: "Example/Other" },
  { id: "sd-sample-3", repo: null },
];
const API = "https://api.github.com/repos";
/** A notification shaped like `gh api notifications`. */
const note = (id, reason, { repo = "example/repo", type = "PullRequest", n = 7, at = "2026-01-02T10:00:00Z", unread = true, comment = null, title = "Add the sample" } = {}) => ({
  id: String(id),
  unread,
  reason,
  updated_at: at,
  subject: { title, type, url: `${API}/${repo}/${type === "PullRequest" ? "pulls" : "issues"}/${n}`, latest_comment_url: comment },
  repository: { full_name: repo, html_url: `https://github.com/${repo}` },
});

test("seven sections, \"other\" off by default; before a thread is read its section is a guess from the reason", () => {
  assert.deepEqual(SECTIONS, ["mentions", "replies", "review", "reviews", "assigned", "state", "other"]);
  assert.deepEqual(DEFAULT_SECTIONS, ["mentions", "replies", "review", "reviews", "assigned", "state"]);
  assert.equal(guessSection("mention"), "mentions");
  assert.equal(guessSection("team_mention"), "mentions");
  assert.equal(guessSection("comment"), "replies");
  assert.equal(guessSection("review_requested"), "review");
  assert.equal(guessSection("assign"), "assigned");
  assert.equal(guessSection("state_change"), "state");
  for (const r of ["ci_activity", "subscribed", "security_alert", "invitation", "bogus", undefined]) assert.equal(guessSection(r), "other");
  const idx = repoIndex(PROJECTS);
  const it = toItem(note(1, "mention"), null, idx);
  assert.deepEqual([it.section, it.event, it.resolved, it.self], ["mentions", "activity", false, false]);
  const done = toItem(note(1, "mention"), { event: "merged", section: "state", actor: "alice", self: true }, idx);
  assert.deepEqual([done.section, done.event, done.resolved, done.self], ["state", "merged", true, true]);
});

test("your own action is never unread, is not counted, and is hidden with hideSelf", () => {
  const idx = repoIndex(PROJECTS);
  const s = emptyRead();
  const mine = toItem(note(1, "mention"), { event: "merged", section: "state", actor: "alice", self: true }, idx);
  const theirs = toItem(note(2, "comment"), { event: "comment", section: "replies", actor: "bob" }, idx);
  assert.equal(isUnread(s, mine), false);
  const rows = view([mine, theirs], s, "all", SECTIONS);
  assert.deepEqual(rows.map((r) => [r.id, r.unread]), [["1", false], ["2", true]]);
  assert.equal(countsOf(rows).unread, 1);
  assert.deepEqual(view([mine, theirs], s, "all", SECTIONS, { hideSelf: true }).map((r) => r.id), ["2"]);
});

test("only repos linked to a project are kept, compared without case", () => {
  const idx = repoIndex(PROJECTS);
  assert.deepEqual([...idx.keys()], ["example/repo", "example/other"]);
  const list = [note(1, "mention"), note(2, "mention", { repo: "example/OTHER" }), note(3, "mention", { repo: "someone/private" }), null, { reason: "mention" }];
  assert.deepEqual(keepLinked(list, idx).map((n) => n.id), ["1", "2"]);
  assert.deepEqual(keepLinked(undefined, idx), []);
  assert.deepEqual(toItem(note(2, "mention", { repo: "example/OTHER" }), null, idx).projects, ["sd-sample-2"]);
});

test("a row: html link, number, excerpt; only github.com links leave the server", () => {
  const idx = repoIndex(PROJECTS);
  const it = toItem(note(9, "comment", { n: 12 }), { actor: "ana", body: "> quoted\nLooks **good**, see [the docs](https://x.test/a)\n```js\ncode\n```", url: "https://github.com/example/repo/pull/12#issuecomment-1" }, idx);
  assert.equal(it.section, "replies");
  assert.equal(it.number, 12);
  assert.equal(it.actor, "ana");
  assert.equal(it.excerpt, "Looks good, see the docs");
  assert.equal(it.url, "https://github.com/example/repo/pull/12#issuecomment-1");
  assert.equal(toItem(note(9, "comment"), { url: "javascript:alert(1)" }, idx).url, "https://github.com/example/repo/pull/7");
  assert.equal(htmlOf(`${API}/example/repo/issues/3`), "https://github.com/example/repo/issues/3");
  assert.equal(htmlOf("https://evil.test/x", "https://github.com/example/repo"), "https://github.com/example/repo");
  assert.equal(excerpt("a".repeat(300)).length, 160);
});

test("read state: unread until read, unread again on newer activity, mark all", () => {
  const idx = repoIndex(PROJECTS);
  const s = emptyRead();
  const a = toItem(note(1, "mention"), null, idx);
  const b = toItem(note(2, "assign", { repo: "example/other" }), null, idx);
  assert.equal(isUnread(s, a), true);
  assert.equal(markRead(s, [a]), 1);
  assert.equal(isUnread(s, a), false);
  assert.equal(markRead(s, [a]), 0);
  const a2 = { ...a, at: "2026-01-03T00:00:00Z" };
  assert.equal(isUnread(s, a2), true);
  const rows = view([a2, b], s, "all", SECTIONS);
  assert.deepEqual(rows.map((r) => r.id), ["1", "2"]); // newest first
  assert.deepEqual(countsOf(rows), { total: 2, unread: 2, sections: { mentions: 1, replies: 0, review: 0, reviews: 0, assigned: 1, state: 0, other: 0 } });
  assert.deepEqual(view([a2, b], s, "sd-sample", SECTIONS).map((r) => r.id), ["1"]);
  assert.deepEqual(view([a2, b], s, "all", ["assigned"]).map((r) => r.id), ["2"]);
  markRead(s, rows);
  assert.equal(countsOf(view([a2, b], s, "all", SECTIONS)).unread, 0);
});

test("mark unread: a read row is unread again; an unread row is left alone", () => {
  const idx = repoIndex(PROJECTS);
  const s = emptyRead();
  const a = toItem(note(1, "mention"), null, idx);
  const b = toItem(note(2, "comment"), null, idx);
  markRead(s, [a]);
  assert.equal(markUnread(s, [a, b]), 1);
  assert.equal(isUnread(s, a), true);
  assert.equal(markUnread(s, [a]), 0);
});

test("a row's avatar comes only from GitHub's avatar host, and only with an actor", () => {
  const idx = repoIndex(PROJECTS);
  const pic = "https://avatars.githubusercontent.com/u/1?v=4";
  assert.equal(safeAvatar(pic), pic);
  for (const bad of ["http://avatars.githubusercontent.com/u/1", "https://evil.test/a.png", "javascript:alert(1)", "https://avatars.githubusercontent.com/u/1\"onerror=x", null]) assert.equal(safeAvatar(bad), null);
  assert.equal(toItem(note(3, "comment"), { actor: "alice", avatar: pic }, idx).avatar, pic);
  assert.equal(toItem(note(3, "comment"), { actor: null, avatar: pic }, idx).avatar, null);
  assert.equal(toItem(note(3, "comment"), null, idx).avatar, null);
});

test("the first run takes GitHub's read flags once; bad files and old entries are cleaned", () => {
  const idx = repoIndex(PROJECTS);
  const s = emptyRead();
  const read = toItem(note(1, "mention", { unread: false }), null, idx);
  const fresh = toItem(note(2, "mention"), null, idx);
  assert.equal(seed(s, [read, fresh]), true);
  assert.equal(isUnread(s, read), false);
  assert.equal(isUnread(s, fresh), true);
  assert.equal(seed(s, [fresh]), false);
  assert.deepEqual(parseRead("not json"), emptyRead());
  assert.deepEqual(parseRead(JSON.stringify({ seeded: true, read: { 12: "2026-01-01T00:00:00Z", "../x": "2026-01-01T00:00:00Z", 13: "nope" } })), { v: 1, seeded: true, read: { 12: "2026-01-01T00:00:00Z" } });
  const old = { v: 1, seeded: true, read: { 1: "2025-01-01T00:00:00Z", 2: "2025-01-01T00:00:00Z", 3: "2026-01-01T00:00:00Z" } };
  prune(old, new Set(["2"]), Date.parse("2026-01-10T00:00:00Z"));
  assert.deepEqual(Object.keys(old.read).sort(), ["2", "3"]);
});

test("gh -i output is parsed with or without a status line", () => {
  const r = parseHttp("HTTP/2.0 200 OK\r\nX-Poll-Interval: 120\r\nLast-Modified: Thu, 01 Jan 2026 00:00:00 GMT\r\n\r\n[1,2]");
  assert.equal(r.status, 200);
  assert.equal(r.h("x-poll-interval"), "120");
  assert.deepEqual(r.body, [1, 2]);
  assert.equal(parseHttp("").status, 0);
  assert.equal(parseHttp("HTTP/2.0 304 Not Modified\r\n\r\n").body, null);
});

// ---------- the poller, with a fake gh ----------
const http = (status, body, headers = {}) =>
  `HTTP/2.0 ${status} X\r\n${Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join("\r\n")}${Object.keys(headers).length ? "\r\n" : ""}\r\n${body === undefined ? "" : JSON.stringify(body)}`;

function harness(routes, extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ld-notify-"));
  const calls = [];
  const cfg = {
    projects: PROJECTS,
    tools: { gh: "gh" },
    notifications: { github: { enabled: true, sections: [...SECTIONS], pollSeconds: 60 }, browser: false },
    ...extra.config,
  };
  const fresh = [];
  const n = createNotify({
    root,
    autostart: false,
    config: () => cfg,
    spend: () => true,
    refund: () => {},
    onFresh: (rows) => fresh.push(...rows),
    run: async (gh, args) => {
      const p = args.find((a) => /^(notifications|repos\/|user)/.test(a));
      calls.push({ p, args });
      for (const [re, fn] of routes) if (re.test(p)) return fn(args);
      return { code: 1, out: http(404, { message: "Not Found" }), err: "" };
    },
  });
  return { n, calls, root, cfg, fresh };
}

test("the poller keeps linked repos only, enriches them, and never reads an unlinked repo", async () => {
  const list = [
    note(1, "mention", { comment: `${API}/example/repo/issues/comments/55` }),
    note(2, "author", { n: 8, at: "2026-01-02T11:00:00Z" }),
    note(3, "comment", { repo: "someone/private", comment: `${API}/someone/private/issues/comments/1` }),
  ];
  const { n, calls } = harness([
    [/^notifications/, () => ({ code: 0, out: http(200, list, { "X-Poll-Interval": "90", "Last-Modified": "Thu, 01 Jan 2026 00:00:00 GMT" }), err: "" })],
    [/issues\/comments\/55$/, () => ({ code: 0, out: http(200, { user: { login: "ana" }, body: "@octo can you look?", html_url: "https://github.com/example/repo/pull/7#issuecomment-55" }), err: "" })],
    [/issues\/8\/timeline/, () => ({ code: 0, out: http(200, [{ event: "reviewed", user: { login: "bob", avatar_url: "https://avatars.githubusercontent.com/u/2?v=4" }, state: "changes_requested", submitted_at: "2026-01-02T11:00:00Z", body: "Please split it", html_url: "https://github.com/example/repo/pull/8#pullrequestreview-1" }]), err: "" })],
    [/pulls\/8$/, () => ({ code: 0, out: http(200, { state: "open", user: { login: "octo" }, html_url: "https://github.com/example/repo/pull/8", body: "" }), err: "" })],
    [/^user$/, () => ({ code: 0, out: http(200, { login: "octo" }), err: "" })],
  ]);
  await n.tick();
  assert.ok(!calls.some((c) => /someone\/private/.test(c.p)), "an unlinked repo is never read");
  const a = n.answer("all");
  assert.equal(a.state.code, "ok");
  assert.equal(a.state.pollSeconds, 90); // X-Poll-Interval wins over the configured 60
  assert.deepEqual(a.items.map((r) => [r.id, r.section, r.actor]), [["2", "reviews", "bob"], ["1", "mentions", "ana"]]);
  assert.equal(a.items[0].review, "changes_requested");
  assert.equal(a.items[0].avatar, "https://avatars.githubusercontent.com/u/2?v=4");
  assert.equal(a.items[1].avatar, null); // ana has no avatar_url in the fixture
  assert.equal(a.items[1].excerpt, "@octo can you look?");
  assert.equal(a.counts.unread, 2);
  assert.ok(!JSON.stringify(a).includes("someone/private"));
  assert.deepEqual(n.answer("sd-sample-2").items, []);
  assert.equal(n.answer("sd-sample-3").state.code, "norepos");
});

test("a 304 reuses the last list (If-Modified-Since); read state survives a restart; new activity raises fresh rows", async () => {
  let list = [note(1, "assign", { type: "Issue" })];
  let status = 200;
  const routes = [
    [/^notifications/, (args) => {
      if (status === 304) assert.ok(args.includes("If-Modified-Since: Thu, 01 Jan 2026 00:00:00 GMT"));
      return { code: status === 200 ? 0 : 1, out: status === 200 ? http(200, list, { "Last-Modified": "Thu, 01 Jan 2026 00:00:00 GMT" }) : http(304), err: "" };
    }],
    [/issues\/7$/, () => ({ code: 0, out: http(200, { state: "open", user: { login: "ana" }, html_url: "https://github.com/example/repo/issues/7", body: "Text" }), err: "" })],
  ];
  const h = harness(routes);
  await h.n.tick();
  assert.equal(h.fresh.length, 0, "the first poll only learns what is there");
  assert.equal(h.n.markRead("all"), 1);
  status = 304;
  await h.n.tick();
  assert.equal(h.n.answer("all").items.length, 1);
  assert.equal(h.n.answer("all").counts.unread, 0);
  // A restart reads the saved state.
  const again = createNotify({ root: h.root, autostart: false, config: () => h.cfg, spend: () => true, refund: () => {}, run: async (gh, args) => routes.find(([re]) => re.test(args.find((a) => /^(notifications|repos\/)/.test(a))))[1](args) });
  status = 200;
  await again.tick();
  assert.equal(again.answer("all").counts.unread, 0);
  // New activity on the same thread: unread again, and a fresh row for the toast.
  list = [note(1, "assign", { type: "Issue", at: "2026-01-05T00:00:00Z" }), note(2, "mention", { type: "Issue", n: 9 })];
  await h.n.tick();
  assert.deepEqual(h.fresh.map((r) => r.id).sort(), ["1", "2"]);
  assert.equal(h.n.answer("all").counts.unread, 2);
});

test("graceful states: gh missing, signed out, rate limited, disabled, no linked repos", async () => {
  const nogh = harness([[/^notifications/, () => ({ code: -1, out: "", err: "Error: spawn gh ENOENT" })]]);
  await nogh.n.tick();
  assert.equal(nogh.n.answer("all").state.code, "nogh");
  const auth = harness([[/^notifications/, () => ({ code: 4, out: "", err: "To get started with GitHub CLI, please run:  gh auth login" })]]);
  await auth.n.tick();
  assert.equal(auth.n.answer("all").state.code, "auth");
  const rl = harness([[/^notifications/, () => ({ code: 1, out: http(403, { message: "API rate limit exceeded" }, { "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "4102444800" }), err: "" })]]);
  await rl.n.tick();
  assert.equal(rl.n.answer("all").state.code, "ratelimit");
  const off = harness([], { config: { notifications: { github: { enabled: false, sections: [...SECTIONS], pollSeconds: 60 }, browser: false } } });
  await off.n.tick();
  assert.equal(off.n.answer("all").state.code, "disabled");
  assert.equal(off.calls.length, 0);
  const none = harness([], { config: { projects: [{ id: "sd-sample", repo: null }] } });
  await none.n.tick();
  assert.equal(none.n.answer("all").state.code, "norepos");
  assert.equal(none.calls.length, 0);
});

test("every gh call is a GET: no method flag, no body fields", async () => {
  const { n, calls } = harness([[/^notifications/, () => ({ code: 0, out: http(200, [note(1, "mention", { comment: `${API}/example/repo/issues/comments/5` })]), err: "" })]]);
  await n.tick();
  assert.ok(calls.length >= 2);
  for (const c of calls) {
    assert.equal(c.args[0], "api");
    for (const bad of ["-X", "--method", "-f", "-F", "--field", "--raw-field", "--input"]) assert.ok(!c.args.includes(bad), `${bad} in ${c.args.join(" ")}`);
  }
});

const FAILS = [
  ["missing scope, 404 (gh text)", 404, "This API operation needs the \"notifications\" scope. To request it, run:  gh auth refresh -h github.com -s notifications", "scope"],
  ["missing scope, 403 (gh text)", 403, "This API operation needs the \"notifications\" scope. To request it, run:  gh auth refresh -h github.com -s notifications", "scope"],
  ["missing scope, no status (gh text only)", 0, "This API operation needs the \"notifications\" scope. To request it, run:  gh auth refresh -h github.com -s notifications", "scope"],
  ["bare 404 from the notifications list", 404, "", "scope"],
  ["signed out", 0, "To get started with GitHub CLI, please run:  gh auth login", "auth"],
  ["bad credentials", 401, "HTTP 401: Bad credentials", "auth"],
  ["gh not installed", 0, "Error: spawn gh ENOENT", "nogh"],
  ["rate limit stays a rate limit", 403, "API rate limit exceeded", "ratelimit"],
];
for (const [name, status, err, code] of FAILS) {
  test(`errorCode: ${name}`, () => assert.equal(errorCode(status, err), code));
  test(`a failing gh poll shows state ${code}, never ok: ${name}`, async () => {
    const { n } = harness([[/^notifications/, () => ({ code: 1, out: status ? http(status, { message: "x" }) : "", err })]]);
    await n.tick();
    const a = n.answer("sd-sample");
    assert.equal(a.state.code, code === "ratelimit" ? "ratelimit" : code);
    assert.notEqual(a.state.code, "ok");
    assert.equal(a.items.length, 0);
  });
}

test("an empty 200 from a token without the notifications scope is reported as scope, not as an empty inbox", async () => {
  const { n } = harness([[/^notifications/, () => ({ code: 0, out: http(200, [], { "X-OAuth-Scopes": "gist, read:org", "X-Accepted-OAuth-Scopes": "notifications, repo" }), err: "" })]]);
  await n.tick();
  assert.equal(n.answer("sd-sample").state.code, "scope");
});

test("an empty 200 from a token that has the scope is a normal empty inbox", async () => {
  const { n } = harness([[/^notifications/, () => ({ code: 0, out: http(200, [], { "X-OAuth-Scopes": "gist, notifications", "X-Accepted-OAuth-Scopes": "notifications, repo" }), err: "" })]]);
  await n.tick();
  assert.equal(n.answer("sd-sample").state.code, "ok");
});

// ---------- the local archive ----------
test("archive: an archived row leaves the list and the counts, shows in the archived view, and restores", () => {
  const idx = repoIndex(PROJECTS);
  const s = emptyRead();
  const arch = emptyArchive();
  const a = toItem(note(1, "mention"), null, idx);
  const b = toItem(note(2, "comment", { at: "2026-01-02T09:00:00Z" }), null, idx);
  assert.equal(archive(arch, [a], Date.parse("2026-01-03T00:00:00Z")), 1);
  assert.equal(archive(arch, [a]), 0, "archiving twice changes nothing");
  assert.deepEqual(arch.threads["1"], { at: a.at, on: "2026-01-03T00:00:00.000Z" });
  assert.equal(isArchived(arch, a), true);
  const inbox = view([a, b], s, "all", SECTIONS, { arch });
  assert.deepEqual(inbox.map((r) => r.id), ["2"]);
  assert.equal(countsOf(inbox).unread, 1);
  const shelf = view([a, b], s, "all", SECTIONS, { arch, archived: true });
  assert.deepEqual(shelf.map((r) => [r.id, r.archivedAt]), [["1", "2026-01-03T00:00:00.000Z"]]);
  assert.equal(unarchive(arch, [a]), 1);
  assert.equal(unarchive(arch, [a]), 0);
  assert.deepEqual(view([a, b], s, "all", SECTIONS, { arch }).map((r) => r.id), ["1", "2"]);
  // no archive object at all: nothing is archived
  assert.deepEqual(view([a, b], s, "all", SECTIONS).map((r) => r.id), ["1", "2"]);
});

test("archive: newer activity on an archived thread brings it back (Gmail-style), unread", () => {
  const idx = repoIndex(PROJECTS);
  const s = emptyRead();
  const arch = emptyArchive();
  const a = toItem(note(1, "mention"), null, idx);
  markRead(s, [a]);
  archive(arch, [a]);
  assert.deepEqual(returned(arch, [a]), [], "no new activity: it stays archived");
  const newer = toItem(note(1, "mention", { at: "2026-01-04T00:00:00Z" }), null, idx);
  assert.equal(isArchived(arch, newer), false, "already out of the archive before the entry is cleaned");
  assert.deepEqual(view([newer], s, "all", SECTIONS, { arch, archived: true }), []);
  assert.deepEqual(returned(arch, [newer]), ["1"]);
  assert.equal(arch.threads["1"], undefined);
  assert.deepEqual(view([newer], s, "all", SECTIONS, { arch }).map((r) => [r.id, r.unread]), [["1", true]]);
});

test("archive file: bad entries are dropped; old entries of unlisted threads are pruned", () => {
  assert.deepEqual(parseArchive("nope"), emptyArchive());
  assert.deepEqual(parseArchive(JSON.stringify({ threads: [] })), emptyArchive());
  const p = parseArchive(JSON.stringify({ threads: { 1: { at: "2026-01-01T00:00:00Z", on: "2026-01-02T00:00:00Z" }, x: { at: "2026-01-01T00:00:00Z", on: "2026-01-02T00:00:00Z" }, 2: { at: "bad", on: "2026-01-02T00:00:00Z" }, 3: "2026-01-01T00:00:00Z" } }));
  assert.deepEqual(Object.keys(p.threads), ["1"]);
  const arch = { v: 1, threads: { 1: { at: "2025-01-01T00:00:00Z", on: "2025-01-01T00:00:00Z" }, 2: { at: "2025-01-01T00:00:00Z", on: "2025-01-01T00:00:00Z" }, 3: { at: "2026-01-01T00:00:00Z", on: "2026-01-09T00:00:00Z" } } };
  pruneArchive(arch, new Set(["2"]), Date.parse("2026-01-10T00:00:00Z"));
  assert.deepEqual(Object.keys(arch.threads).sort(), ["2", "3"]);
});

test("the poller: archive / archive all read / restore are local, cost no gh call, survive a restart, and new activity un-archives", async () => {
  let list = [note(1, "assign", { type: "Issue" }), note(2, "mention", { type: "Issue", n: 9, at: "2026-01-02T09:00:00Z" })];
  const routes = [
    [/^notifications/, () => ({ code: 0, out: http(200, list, { "Last-Modified": "Thu, 01 Jan 2026 00:00:00 GMT" }), err: "" })],
    [/issues\/(7|9)$/, () => ({ code: 0, out: http(200, { state: "open", user: { login: "ana" }, html_url: "https://github.com/example/repo/issues/7", body: "Text" }), err: "" })],
  ];
  const h = harness(routes);
  await h.n.tick();
  h.n.markRead("all", ["2"]);
  const before = h.calls.length;
  assert.equal(h.n.archive("all", ["1"]), 1);
  assert.equal(h.n.archive("all"), 1, "archive all read takes the read row only");
  assert.equal(h.calls.length, before, "archiving makes no GitHub call");
  let a = h.n.answer("all");
  assert.deepEqual([a.items.length, a.counts.unread, a.counts.archived], [0, 0, 2]);
  assert.deepEqual(a.archived.map((r) => r.id).sort(), ["1", "2"]);
  assert.ok(a.archived.every((r) => typeof r.archivedAt === "string"));
  assert.ok(fs.existsSync(path.join(h.root, "data", "notify", "archive.json")));
  // A restart reads the saved archive.
  const again = createNotify({ root: h.root, autostart: false, config: () => h.cfg, spend: () => true, refund: () => {}, run: async (gh, args) => routes.find(([re]) => re.test(args.find((x) => /^(notifications|repos\/)/.test(x))))[1](args) });
  await again.tick();
  assert.equal(again.answer("all").counts.archived, 2);
  // Restore one by id.
  assert.equal(h.n.restore("all", ["2"]), 1);
  a = h.n.answer("all");
  assert.deepEqual([a.items.map((r) => r.id), a.archived.map((r) => r.id)], [["2"], ["1"]]);
  // New activity on the archived thread: back in the inbox, unread, out of the archived list, and a toast.
  list = [note(1, "assign", { type: "Issue", at: "2026-01-05T00:00:00Z" }), list[1]];
  await h.n.tick();
  a = h.n.answer("all");
  assert.deepEqual(a.items.map((r) => [r.id, r.unread]), [["1", true], ["2", false]]);
  assert.deepEqual([a.archived.length, a.counts.archived], [0, 0]);
  assert.deepEqual(h.fresh.map((r) => r.id), ["1"]);
  const saved = JSON.parse(fs.readFileSync(path.join(h.root, "data", "notify", "archive.json"), "utf8"));
  assert.deepEqual(saved.threads, {}, "the returned thread's entry is gone from the file");
  // Restore all.
  h.n.archive("all", ["1", "2"]);
  assert.equal(h.n.restore("all"), 2);
  assert.equal(h.n.answer("all").counts.archived, 0);
});

test("the archive endpoints: JSON only, ids or read/all required, scoped answer back", async () => {
  const list = [note(1, "assign", { type: "Issue" })];
  const h = harness([
    [/^notifications/, () => ({ code: 0, out: http(200, list), err: "" })],
    [/issues\/7$/, () => ({ code: 0, out: http(200, { state: "open", user: { login: "ana" }, html_url: "https://github.com/example/repo/issues/7", body: "" }), err: "" })],
  ]);
  await h.n.tick();
  const { Readable } = await import("node:stream");
  const call = async (p, body, type = "application/json") => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]);
    req.method = "POST";
    req.headers = { "content-type": type };
    let status = 0, out = "";
    const res = { writeHead: (c) => { status = c; }, end: (b) => { out = b; } };
    await h.n.handle(req, res, new URL(`http://x${p}?scope=all`), "sd-sample");
    return { status, body: out ? JSON.parse(out) : null };
  };
  assert.equal((await call("/api/notify/archive", { ids: ["1"] }, "text/plain")).status, 415);
  assert.equal((await call("/api/notify/archive", {})).status, 400);
  assert.equal((await call("/api/notify/restore", { read: true })).status, 400);
  const r = await call("/api/notify/archive", { ids: ["1", "x"] });
  assert.deepEqual([r.status, r.body.changed, r.body.counts.archived, r.body.items.length], [200, 1, 1, 0]);
  const back = await call("/api/notify/restore", { all: true });
  assert.deepEqual([back.body.changed, back.body.items.length], [1, 1]);
});
