// What a GitHub notification row says happened: derived from what changed (the latest comment, the subject's state, the
// newest timeline events), never from GitHub's sticky `reason`. Table-driven, with fixtures shaped like the REST answers
// (`gh api /notifications`, an issue / PR, a comment, a review, a timeline page). You are "alice" throughout.
import test from "node:test";
import assert from "node:assert/strict";
import { commentKind, deriveEvent, EVENTS, explained, latestFact, mentions, mentionsTeam, refOf } from "../server/notify/events.mjs";

const ME = "alice";
const API = "https://api.github.com/repos/example/app";
const U = "2026-03-10T12:00:00Z"; // the thread's updated_at
const before = (s) => new Date(Date.parse(U) - s * 1000).toISOString();
const LONG_AGO = "2026-02-01T09:00:00Z";
const u = (login) => ({ login, avatar_url: `https://avatars.githubusercontent.com/u/${login.length}?v=4` });

/** A notification: reason, subject type, number, latest_comment_url ("self" = the subject itself). */
function note(reason, type = "PullRequest", { n = 12, lc = "self", url, title = "Add the export button" } = {}) {
  const kind = type === "PullRequest" ? "pulls" : "issues";
  const su = url !== undefined ? url : ["PullRequest", "Issue"].includes(type) ? `${API}/${kind}/${n}` : null;
  return {
    id: "1", unread: true, reason, updated_at: U,
    subject: { title, type, url: su, latest_comment_url: lc === "self" ? su : lc },
    repository: { full_name: "example/app", html_url: "https://github.com/example/app" },
  };
}
const pr = (over = {}) => ({ state: "open", merged: false, merged_at: null, merged_by: null, closed_at: null, closed_by: null, user: u("bob"), created_at: LONG_AGO, body: "", html_url: "https://github.com/example/app/pull/12", ...over });
const issue = (over = {}) => ({ state: "open", closed_at: null, closed_by: null, user: u("bob"), created_at: LONG_AGO, body: "", html_url: "https://github.com/example/app/issues/12", assignees: [u(ME)], ...over });
const comment = (login, body, over = {}) => ({ kind: "comment", user: u(login), body, html_url: "https://github.com/example/app/issues/12#issuecomment-1", at: before(5), ...over });

// [name, notification, facts, expected { event, actor, self, section, review?, body? }]
const CASES = [
  // --- the two rows measured on real data ---
  ["your own PR was merged (reason mention, latest = the PR itself)", note("mention"), { subject: pr({ user: u(ME), state: "closed", merged: true, merged_at: before(3), merged_by: u(ME), closed_at: before(3) }) },
    { event: "merged", actor: ME, self: true, section: "state" }],
  ["an issue assigned long ago was closed by that merge (reason assign)", note("assign", "Issue"), { subject: issue({ state: "closed", closed_at: before(2), closed_by: u("bob") }) },
    { event: "closed", actor: "bob", self: false, section: "state" }],
  ["the same issue closed by your own merge", note("assign", "Issue"), { subject: issue({ state: "closed", closed_at: before(2), closed_by: u(ME) }) },
    { event: "closed", actor: ME, self: true, section: "state" }],
  // --- comments: a mention only when the comment really @-mentions you ---
  ["a comment that @-mentions you", note("comment", "Issue", { lc: `${API}/issues/comments/1` }), { comment: comment("bob", "@alice can you look?") },
    { event: "mention", actor: "bob", section: "mentions" }],
  ["a plain comment on a thread you were once mentioned in (sticky reason mention)", note("mention", "Issue", { lc: `${API}/issues/comments/1` }), { comment: comment("bob", "Rebased on main.") },
    { event: "comment", actor: "bob", section: "replies" }],
  ["a quoted or code-fenced @you is not a new mention", note("mention", "Issue", { lc: `${API}/issues/comments/1` }), { comment: comment("bob", "> @alice said this\n\n`@alice` ```\n@alice\n```\nok") },
    { event: "comment", section: "replies" }],
  ["an email address is not a mention", note("comment", "Issue", { lc: `${API}/issues/comments/1` }), { comment: comment("bob", "mail dev@alice.example") },
    { event: "comment" }],
  ["a team mention with @org/team", note("team_mention", "Issue", { lc: `${API}/issues/comments/1` }), { comment: comment("bob", "@example/reviewers please check") },
    { event: "mention", section: "mentions" }],
  ["a team-mention thread with a plain comment", note("team_mention", "Issue", { lc: `${API}/issues/comments/1` }), { comment: comment("bob", "Thanks") },
    { event: "comment", section: "replies" }],
  ["your own comment (never 'mentioned you')", note("author", "PullRequest", { lc: `${API}/issues/comments/1` }), { comment: comment(ME, "Fixed in the last push, @alice note to self") },
    { event: "comment", actor: ME, self: true, section: "replies" }],
  ["a PR review comment (pulls/comments)", note("author", "PullRequest", { lc: `${API}/pulls/comments/3` }), { comment: comment("bob", "nit: rename this", { kind: "review_comment" }) },
    { event: "comment", actor: "bob", section: "replies" }],
  ["a commit comment", note("comment", "Commit", { url: `${API}/commits/0123456789abcdef0123`, lc: `${API}/comments/9` }), { comment: comment("bob", "This broke the build", { kind: "commit_comment" }) },
    { event: "comment", actor: "bob", section: "replies", ref: "0123456" }],
  // --- reviews ---
  ["an approval on your PR (latest = the review)", note("author", "PullRequest", { lc: `${API}/pulls/12/reviews/5` }), { comment: comment("bob", "", { kind: "review", state: "APPROVED" }) },
    { event: "approved", actor: "bob", section: "reviews", review: "approved" }],
  ["changes requested on your PR, found on the timeline", note("author"), { subject: pr({ user: u(ME) }), timeline: [{ event: "reviewed", user: u("bob"), state: "changes_requested", submitted_at: before(10), body: "Please split it" }] },
    { event: "changes_requested", actor: "bob", section: "reviews", review: "changes_requested", body: "Please split it" }],
  ["a review on someone else's PR is a reply, not 'a review on your PR'", note("comment", "PullRequest", { lc: `${API}/pulls/12/reviews/5` }), { comment: comment("bob", "LGTM", { kind: "review", state: "COMMENTED" }), subject: pr({ user: u("carol") }) },
    { event: "reviewed", actor: "bob", section: "replies", review: "commented" }],
  ["a review that @-mentions you", note("review_requested", "PullRequest", { lc: `${API}/pulls/12/reviews/5` }), { comment: comment("bob", "@alice what do you think?", { kind: "review", state: "COMMENTED" }) },
    { event: "mention", actor: "bob", section: "mentions" }],
  // --- review requests and assignments: only when the latest event really is that ---
  ["your review was requested (timeline)", note("review_requested"), { subject: pr(), timeline: [{ event: "review_requested", actor: u("bob"), review_requester: u("bob"), requested_reviewer: u(ME), created_at: before(4) }] },
    { event: "review_requested", actor: "bob", section: "review" }],
  ["a team's review was requested (timeline)", note("review_requested"), { subject: pr(), timeline: [{ event: "review_requested", review_requester: u("bob"), requested_team: { name: "reviewers" }, created_at: before(4) }] },
    { event: "review_requested", actor: "bob", section: "review" }],
  ["someone else's review was requested on a PR you review (sticky review_requested)", note("review_requested"), { subject: pr(), timeline: [{ event: "review_requested", review_requester: u("bob"), requested_reviewer: u("carol"), created_at: before(4) }] },
    { event: "activity", actor: "bob", section: "state" }],
  ["you were assigned (timeline)", note("assign", "Issue"), { subject: issue(), timeline: [{ event: "assigned", actor: u("bob"), assignee: u(ME), created_at: before(1) }] },
    { event: "assigned", actor: "bob", section: "assigned" }],
  ["you assigned yourself", note("assign", "Issue"), { subject: issue(), timeline: [{ event: "assigned", actor: u(ME), assignee: u(ME), created_at: before(1) }] },
    { event: "assigned", actor: ME, self: true, section: "assigned" }],
  ["someone else was assigned on an issue assigned to you long ago", note("assign", "Issue"), { subject: issue(), timeline: [{ event: "assigned", actor: u("bob"), assignee: u("carol"), created_at: before(1) }] },
    { event: "activity", actor: "bob", section: "state" }],
  // --- state changes ---
  ["reopened (timeline)", note("author", "Issue"), { subject: issue({ user: u(ME) }), timeline: [{ event: "closed", actor: u("bob"), created_at: LONG_AGO }, { event: "reopened", actor: u("bob"), created_at: before(6) }] },
    { event: "reopened", actor: "bob", section: "state" }],
  ["a PR closed without merging (the PR has no closed_by: the timeline tells)", note("author"), { subject: pr({ user: u(ME), state: "closed", closed_at: before(2) }), timeline: [{ event: "closed", actor: u("bob"), created_at: before(2) }] },
    { event: "closed", actor: "bob", section: "state" }],
  ["a merge also closes: merged wins the tie", note("author"), { timeline: [{ event: "closed", actor: u("bob"), created_at: before(1) }, { event: "merged", actor: u("bob"), created_at: before(1) }] },
    { event: "merged", actor: "bob", section: "state" }],
  ["close with comment: the state change, with the comment as its excerpt", note("comment", "Issue"), { timeline: [{ event: "commented", user: u("bob"), body: "Duplicate of #3", created_at: before(2) }, { event: "closed", actor: u("bob"), created_at: before(1) }] },
    { event: "closed", actor: "bob", section: "state", body: "Duplicate of #3" }],
  ["marked ready for review", note("review_requested"), { timeline: [{ event: "ready_for_review", actor: u("bob"), created_at: before(1) }] },
    { event: "ready", actor: "bob", section: "state" }],
  ["a force push", note("comment"), { timeline: [{ event: "head_ref_force_pushed", actor: u("bob"), created_at: before(1) }] },
    { event: "pushed", actor: "bob", section: "state" }],
  ["a label alone is noise next to the merge", note("author"), { timeline: [{ event: "merged", actor: u("bob"), created_at: before(30) }, { event: "labeled", actor: u("bot"), created_at: before(20) }, { event: "head_ref_deleted", actor: u(ME), created_at: before(10) }] },
    { event: "merged", actor: "bob" }],
  ["only a label changed: 'updated', not the old opening", note("comment", "Issue"), { subject: issue({ created_at: LONG_AGO }), timeline: [{ event: "labeled", actor: u("bob"), created_at: before(1) }] },
    { event: "activity", actor: "bob", section: "state" }],
  // --- newly opened threads ---
  ["a new issue that @-mentions you", note("mention", "Issue"), { subject: issue({ created_at: before(1), body: "cc @alice", assignees: [] }) },
    { event: "mention", actor: "bob", section: "mentions" }],
  ["a new PR that asks for your review", note("review_requested"), { subject: pr({ created_at: before(1) }) },
    { event: "review_requested", actor: "bob", section: "review" }],
  ["a new issue assigned to you", note("assign", "Issue"), { subject: issue({ created_at: before(1) }) },
    { event: "assigned", actor: "bob", section: "assigned" }],
  ["a new issue on a thread you only comment on", note("manual", "Issue"), { subject: issue({ created_at: before(1), assignees: [] }) },
    { event: "opened", actor: "bob", section: "replies" }],
  // --- degraded reads ---
  ["a deleted comment (404) on a closed issue: the close", note("comment", "Issue", { lc: `${API}/issues/comments/1` }), { comment: { missing: true }, subject: issue({ state: "closed", closed_at: before(2), closed_by: u("bob") }) },
    { event: "closed", actor: "bob" }],
  ["a deleted comment and nothing else readable: a generic row", note("mention", "Issue", { lc: `${API}/issues/comments/1` }), { comment: { missing: true } },
    { event: "activity", actor: null, section: "mentions" }],
  ["an update nothing explains: generic, never the old opening", note("assign", "Issue"), { subject: issue() },
    { event: "activity", actor: null, section: "assigned" }],
  ["nothing read at all", note("mention", "Issue"), {}, { event: "activity", actor: null, section: "mentions" }],
  ["your login unknown: a mention by reason, only when the comment @-mentions someone", note("mention", "Issue", { lc: `${API}/issues/comments/1` }), { comment: comment("bob", "@someone look") },
    { event: "mention", me: null }],
  // --- the other subject types ---
  ["a release (watching the repo)", note("subscribed", "Release", { url: `${API}/releases/77` }), { release: { author: u("bob"), name: "v2.0.0", tag_name: "v2.0.0", html_url: "https://github.com/example/app/releases/tag/v2.0.0", body: "Notes" } },
    { event: "release", actor: "bob", section: "other", ref: "v2.0.0" }],
  ["a release not read (other hidden)", note("subscribed", "Release", { url: `${API}/releases/77`, title: "v2.0.1" }), {}, { event: "release", actor: null, section: "other", ref: "v2.0.1" }],
  ["a failed CI run", note("ci_activity", "CheckSuite", { url: null, title: "CI workflow run failed for main branch" }), {}, { event: "ci_failed", section: "other" }],
  ["a passing CI run", note("ci_activity", "WorkflowRun", { url: null, title: "Build workflow run succeeded for main branch" }), {}, { event: "ci_passed", section: "other" }],
  ["a CI run with an unknown title", note("ci_activity", "CheckSuite", { url: null, title: "Nightly" }), {}, { event: "ci", section: "other" }],
  ["a deployment waiting for your approval", note("approval_requested", "WorkflowRun", { url: null, title: "Deploy to production" }), {}, { event: "approval", section: "review" }],
  ["a vulnerability alert", note("security_alert", "RepositoryVulnerabilityAlert", { url: null }), {}, { event: "security", section: "other" }],
  ["a Dependabot alerts thread", note("security_alert", "RepositoryDependabotAlertsThread", { url: null }), {}, { event: "security", section: "other" }],
  ["an invitation", note("invitation", "RepositoryInvitation", { url: null }), {}, { event: "invitation", section: "other" }],
  ["a security advisory credit", note("security_advisory_credit", "SecurityAdvisory", { url: null }), {}, { event: "advisory", section: "other" }],
  ["a discussion you were mentioned in (REST gives no detail)", note("mention", "Discussion", { url: null }), {}, { event: "activity", section: "mentions" }],
  ["a watched discussion", note("subscribed", "Discussion", { url: null }), {}, { event: "activity", section: "other" }],
  ["a member feature request", note("member_feature_requested", "MemberFeatureRequest", { url: null }), {}, { event: "activity", section: "other" }],
  ["an unknown subject type", note("bogus_reason", "SomethingNew", { url: null }), {}, { event: "activity", section: "other" }],
  ["a watched issue with a comment", note("subscribed", "Issue", { lc: `${API}/issues/comments/1` }), { comment: comment("bob", "hello") }, { event: "comment", section: "other" }],
  ["state_change with a merge", note("state_change"), { subject: pr({ state: "closed", merged_at: before(1), merged_by: u("bob"), closed_at: before(1) }) }, { event: "merged", actor: "bob", section: "state" }],
];

for (const [name, n, facts, want] of CASES) {
  test(`event: ${name}`, () => {
    const me = "me" in want ? want.me : ME;
    const d = deriveEvent(n, facts, me);
    assert.ok(EVENTS.includes(d.event), `unknown event ${d.event}`);
    for (const k of ["event", "actor", "self", "section", "review", "body"]) if (k in want) assert.equal(d[k], want[k], `${k}`);
    if ("ref" in want) assert.equal(refOf(n, facts), want.ref);
    if (!("self" in want)) assert.equal(d.self, !!d.actor && d.actor === ME);
  });
}

const REASONS = ["assign", "author", "comment", "ci_activity", "invitation", "manual", "member_feature_requested", "mention", "review_requested", "security_alert", "security_advisory_credit", "state_change", "subscribed", "team_mention", "approval_requested", "something_new", undefined];
const TYPES = ["Issue", "PullRequest", "Commit", "Release", "Discussion", "CheckSuite", "WorkflowRun", "RepositoryVulnerabilityAlert", "RepositoryDependabotAlertsThread", "RepositoryInvitation", "SecurityAdvisory", "SomethingNew", undefined];
test("every reason x every subject type gives a known event and a section, with or without facts, and never throws", () => {
  const SECTIONS = ["mentions", "replies", "review", "reviews", "assigned", "state", "other"];
  for (const reason of REASONS) for (const type of TYPES) for (const facts of [{}, { comment: { missing: true } }, { timeline: [{ event: "weird" }, null, 7] }, { subject: "not an object" }]) {
    const d = deriveEvent(note(reason, type), facts, ME);
    assert.ok(EVENTS.includes(d.event), `${reason}/${type}: ${d.event}`);
    assert.ok(SECTIONS.includes(d.section), `${reason}/${type}: ${d.section}`);
  }
  assert.doesNotThrow(() => deriveEvent(null, null, null));
  assert.doesNotThrow(() => deriveEvent({}, undefined, ME));
});

test("comment kinds from latest_comment_url", () => {
  assert.equal(commentKind("repos/example/app/issues/comments/1"), "comment");
  assert.equal(commentKind("repos/example/app/pulls/comments/1"), "review_comment");
  assert.equal(commentKind("repos/example/app/pulls/12/reviews/3"), "review");
  assert.equal(commentKind("repos/example/app/comments/9"), "commit_comment");
  for (const x of ["repos/example/app/pulls/12", "repos/example/app/issues/12", "repos/example/app/releases/1", null, ""]) assert.equal(commentKind(x), null);
});

test("mentions: word boundaries, case, code and quotes", () => {
  assert.equal(mentions("hi @Alice!", ME), true);
  assert.equal(mentions("@alice-bot hi", ME), false);
  assert.equal(mentions("@alicex", ME), false);
  assert.equal(mentions("a@alice.example", ME), false);
  assert.equal(mentions("(@alice)", ME), true);
  assert.equal(mentions("> @alice\nno", ME), false);
  assert.equal(mentions("@alice", null), false);
  assert.equal(mentionsTeam("cc @example/reviewers"), true);
  assert.equal(mentionsTeam("cc @alice"), false);
});

test("the timeline is read only when the comment and the subject do not explain the update", () => {
  const n = note("author", "PullRequest", { lc: `${API}/issues/comments/1` });
  assert.equal(explained(n, { comment: comment("bob", "x") }), true);
  assert.equal(explained(n, { comment: comment("bob", "x", { at: LONG_AGO }) }), false, "an old comment: something newer happened");
  assert.equal(explained(n, { comment: { missing: true } }), false);
  assert.equal(explained(n, { subject: pr({ merged_at: before(1), merged_by: u("bob") }) }), true);
  assert.equal(explained(n, { subject: issue({ state: "closed", closed_at: before(1), closed_by: u("bob") }) }), true);
  assert.equal(explained(n, { subject: pr({ state: "closed", closed_at: before(1) }) }), false, "a PR has no closed_by");
  assert.equal(explained(n, { subject: pr({ created_at: before(1) }) }), true);
  assert.equal(explained(n, { subject: pr() }), false);
});

test("latestFact ignores facts newer than the update (another notification will come for those)", () => {
  const f = latestFact([{ kind: "comment", at: before(60), actor: { login: "bob" } }, { kind: "closed", at: new Date(Date.parse(U) + 3600e3).toISOString(), actor: { login: "carol" } }], U);
  assert.equal(f.kind, "comment");
  assert.equal(latestFact([], U), null);
});

// ---------- the poller: what it reads for each kind of thread, and what it costs ----------
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createNotify, linkPage } from "../server/notify/notify.mjs";

const http = (status, body, headers = {}) =>
  `HTTP/2.0 ${status} X\r\n${Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join("\r\n")}${Object.keys(headers).length ? "\r\n" : ""}\r\n${body === undefined ? "" : JSON.stringify(body)}`;
const ok = (body, headers = {}) => ({ code: 0, out: http(200, body, { ETag: `"${JSON.stringify(body).length}"`, ...headers }), err: "" });

/** A poller over a fake gh: `routes` = [[regex, (args) => answer]]; the list is `list()`; `user` answers alice. */
function poller(list, routes, { hideSelf, sections } = {}) {
  const calls = [];
  const fresh = [];
  const github = { enabled: true, sections: sections || ["mentions", "replies", "review", "reviews", "assigned", "state"], pollSeconds: 60 };
  if (hideSelf !== undefined) github.hideSelf = hideSelf;
  const cfg = { projects: [{ id: "sd-sample", repo: "example/app" }], tools: { gh: "gh" }, notifications: { github, browser: false } };
  const n = createNotify({
    root: fs.mkdtempSync(path.join(os.tmpdir(), "ld-notify-ev-")), autostart: false, config: () => cfg, spend: () => true, refund: () => {},
    onFresh: (rows) => fresh.push(...rows),
    run: async (_gh, args) => {
      const p = args.find((a) => /^(notifications|repos\/|user)/.test(a));
      if (/^notifications/.test(p)) return ok(list());
      calls.push(p);
      if (p === "user") return ok({ login: ME });
      const inm = (args.find((a) => a.startsWith("If-None-Match: ")) || "").slice(15);
      for (const [re, fn] of routes) if (re.test(p)) { const r = fn(args, inm); return r; }
      return { code: 1, out: http(404, { message: "Not Found" }), err: "gh: Not Found (HTTP 404)" };
    },
  });
  return { n, calls, fresh, cfg };
}
const at = (s) => new Date(Date.parse(U) + s * 1000).toISOString();
const thread = (id, reason, type, num, lc, updated = U) => {
  const kind = type === "PullRequest" ? "pulls" : "issues";
  return { id: String(id), unread: true, reason, updated_at: updated, subject: { title: `Thread ${id}`, type, url: `${API}/${kind}/${num}`, latest_comment_url: lc === "self" ? `${API}/${kind}/${num}` : lc }, repository: { full_name: "example/app", html_url: "https://github.com/example/app" } };
};

test("poller: your merged PR costs one subject read, is never unread, and is hidden by default", async () => {
  const list = [thread(1, "mention", "PullRequest", 12, "self"), thread(2, "assign", "Issue", 7, "self")];
  const { n, calls } = poller(() => list, [
    [/pulls\/12$/, () => ok(pr({ user: u(ME), state: "closed", merged: true, merged_at: before(3), merged_by: u(ME), closed_at: before(3) }))],
    [/issues\/7$/, () => ok(issue({ state: "closed", closed_at: before(2), closed_by: u("bob") }))],
  ]);
  await n.tick();
  assert.deepEqual(calls, ["user", "repos/example/app/pulls/12", "repos/example/app/issues/7"], "no timeline read: the subject explains both");
  const a = n.answer("all");
  assert.deepEqual(a.items.map((r) => [r.id, r.event, r.actor, r.self, r.unread]), [["2", "closed", "bob", false, true]]);
  assert.equal(a.counts.unread, 1);
  assert.equal(a.settings.hideSelf, true);
});

test("poller: with hideSelf off, your own action is listed, muted and not counted", async () => {
  const list = [thread(1, "mention", "PullRequest", 12, "self")];
  const { n } = poller(() => list, [[/pulls\/12$/, () => ok(pr({ user: u(ME), state: "closed", merged: true, merged_at: before(3), merged_by: u(ME), closed_at: before(3) }))]], { hideSelf: false });
  await n.tick();
  const a = n.answer("all");
  assert.deepEqual(a.items.map((r) => [r.event, r.self, r.unread, r.section]), [["merged", true, false, "state"]]);
  assert.equal(a.counts.unread, 0);
});

test("poller: an unchanged thread is never read again; a new update reads only what changed (ETag)", async () => {
  let list = [thread(1, "author", "Issue", 7, "self")];
  let pages = 3;
  const tl = (k) => [{ event: k === pages ? "reopened" : "labeled", actor: u("bob"), created_at: before(5) }];
  const seen = [];
  const { n, calls } = poller(() => list, [
    [/issues\/7$/, () => ok(issue({ user: u(ME) }))],
    [/issues\/7\/timeline/, (args, inm) => {
      const k = Number((/[?&]page=(\d+)/.exec(args.find((a) => a.startsWith("repos/"))) || [])[1] || 1);
      seen.push([k, inm]);
      const body = tl(k);
      const etag = `"tl${k}-${pages}"`;
      if (inm === etag) return { code: 1, out: http(304, undefined, { ETag: etag }), err: "" };
      const link = k < pages ? `<${API}/issues/7/timeline?per_page=100&page=${k + 1}>; rel="next", <${API}/issues/7/timeline?per_page=100&page=${pages}>; rel="last"` : "";
      return ok(body, { ETag: etag, ...(link ? { Link: link } : {}) });
    }],
  ]);
  await n.tick();
  assert.deepEqual(seen.map((x) => x[0]), [1, 3], "the first page tells where the last one is, which holds the newest events");
  assert.equal(n.answer("all").items[0].event, "reopened");
  const before1 = calls.length;
  await n.tick();
  assert.equal(calls.length, before1, "same updated_at: no read at all");
  list = [thread(1, "author", "Issue", 7, "self", at(60))];
  await n.tick();
  assert.deepEqual(seen.slice(2).map((x) => x[0]), [3], "the remembered last page is asked directly");
  assert.ok(seen[2][1], "with its ETag");
});

test("poller: a deleted comment (404) falls back to the subject; a watched thread is not read while Other is hidden", async () => {
  const list = [thread(1, "comment", "Issue", 7, `${API}/issues/comments/99`), thread(2, "subscribed", "Issue", 8, `${API}/issues/comments/100`)];
  const { n, calls } = poller(() => list, [[/issues\/7$/, () => ok(issue({ state: "closed", closed_at: before(1), closed_by: u("bob") }))]]);
  await n.tick();
  assert.ok(!calls.some((c) => /issues\/(8|comments\/100)/.test(c)), "the watched thread costs nothing");
  assert.deepEqual(n.answer("all").items.map((r) => [r.id, r.event, r.actor]), [["1", "closed", "bob"]]);
});

test("poller: the calls per poll are capped; the rest is read next poll; only resolved rows are announced", async () => {
  const list = Array.from({ length: 12 }, (_, i) => thread(i + 1, "comment", "Issue", 100 + i, "self", at(-i)));
  const { n, calls, fresh } = poller(() => list, [
    [/issues\/\d+$/, () => ok(issue())],
    // Long threads: two timeline pages each, so 12 threads need 1 + 12 x 3 calls, more than one poll may make.
    [/issues\/\d+\/timeline/, (args) => /page=2/.test(args.join(" "))
      ? ok([{ event: "commented", user: u("bob"), body: "ping", created_at: before(30) }])
      : ok([{ event: "labeled", actor: u("bob"), created_at: LONG_AGO }], { Link: `<${API}/issues/1/timeline?per_page=100&page=2>; rel="next", <${API}/issues/1/timeline?per_page=100&page=2>; rel="last"` })],
  ]);
  await n.tick();
  assert.ok(calls.length <= 30, `${calls.length} calls`);
  const first = n.answer("all").items.filter((r) => r.resolved).length;
  assert.ok(first < 12 && first > 0, `${first} resolved`);
  await n.tick();
  assert.equal(n.answer("all").items.filter((r) => r.resolved).length, 12);
  assert.ok(fresh.length > 0 && fresh.every((r) => r.resolved && r.event === "comment"), "rows resolved on the second poll are announced once they say what happened");
});

test("linkPage reads GitHub's Link header", () => {
  assert.equal(linkPage(`<${API}/issues/7/timeline?per_page=100&page=2>; rel="next", <${API}/issues/7/timeline?per_page=100&page=5>; rel="last"`, "last"), 5);
  assert.equal(linkPage(`<${API}/x?page=2>; rel="next"`, "last"), null);
  assert.equal(linkPage(null, "last"), null);
});

import { checkSettings } from "../server/config.mjs";
test("config: hideSelf defaults on, the Other section is valid but off by default, a bad hideSelf is refused", () => {
  const c = checkSettings({});
  assert.equal(c.ok, true);
  assert.equal(c.settings.notifications.github.hideSelf, true);
  assert.ok(!c.settings.notifications.github.sections.includes("other"));
  assert.ok(checkSettings({ notifications: { github: { sections: ["mentions", "other"] } } }).settings.notifications.github.sections.includes("other"));
  const bad = checkSettings({ notifications: { github: { hideSelf: "yes" } } });
  assert.deepEqual([bad.ok, bad.key], [false, "notifications.github.hideSelf"]);
});
