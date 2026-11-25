import test from "node:test";
import assert from "node:assert/strict";
import { attention, isBot, needsCount, pendingMention, prGroup, replyState } from "../server/mine/logic.mjs";
import { buildMine, errorCode, searches } from "../server/mine/mine.mjs";

const ME = "octo";

test("a reply from someone else after my last comment is new", () => {
  const s = replyState([{ by: "octo", at: "2026-01-01T10:00:00Z" }, { by: "ana", at: "2026-01-01T11:00:00Z" }], ME);
  assert.equal(s.newReply, true);
  assert.equal(s.replyBy, "ana");
  assert.deepEqual(s.last, { by: "ana", at: "2026-01-01T11:00:00Z" });
});

test("no new reply once I answered, and logins compare without case", () => {
  const s = replyState([{ by: "ana", at: "2026-01-01T11:00:00Z" }, { by: "OCTO", at: "2026-01-01T12:00:00Z" }], ME);
  assert.equal(s.newReply, false);
  assert.equal(s.last.by, "OCTO");
});

test("opening, assignment or a push count as my activity", () => {
  const c = [{ by: "ana", at: "2026-01-02T00:00:00Z" }];
  assert.equal(replyState(c, ME, ["2026-01-01T00:00:00Z"]).newReply, true);
  assert.equal(replyState(c, ME, ["2026-01-03T00:00:00Z"]).newReply, false);
});

test("without any activity of mine nothing is called new; bots never count", () => {
  assert.equal(replyState([{ by: "ana", at: "2026-01-02T00:00:00Z" }], ME).newReply, false);
  const s = replyState([{ by: "octo", at: "2026-01-01T00:00:00Z" }, { by: "ci", bot: true, at: "2026-01-02T00:00:00Z" }], ME);
  assert.equal(s.newReply, false);
  assert.equal(s.last.by, "octo");
  assert.equal(isBot({ __typename: "Bot", login: "x" }), true);
  assert.equal(isBot({ __typename: "User", login: "dependabot[bot]" }), true);
  assert.equal(isBot({ __typename: "User", login: "ana" }), false);
});

test("a mention waits until I comment after it", () => {
  const item = { by: "ana", at: "2026-01-01T00:00:00Z", body: "plan", comments: [{ by: "bob", at: "2026-01-02T00:00:00Z", body: "@octo can you look?" }] };
  assert.deepEqual(pendingMention(item, ME), { by: "bob", at: "2026-01-02T00:00:00Z" });
  item.comments.push({ by: "octo", at: "2026-01-03T00:00:00Z", body: "done" });
  assert.equal(pendingMention(item, ME), null);
});

test("a mention needs the whole login, and my own text or a bot's does not count", () => {
  const at = "2026-01-01T00:00:00Z";
  assert.equal(pendingMention({ by: "ana", at, body: "@octocat hi", comments: [] }, ME), null);
  assert.equal(pendingMention({ by: "octo", at, body: "@octo note to self", comments: [] }, ME), null);
  assert.equal(pendingMention({ by: "ana", at, body: "", comments: [{ by: "bot", bot: true, at, body: "@octo" }] }, ME), null);
  assert.ok(pendingMention({ by: "ana", at, body: "cc @Octo.", comments: [] }, ME));
});

test("PR groups follow the board's stage, in plain reasons", () => {
  assert.deepEqual(prGroup({ stage: "changes" }), { group: "needs", reason: "changes" });
  assert.deepEqual(prGroup({ stage: "code-conflict" }), { group: "needs", reason: "conflict" });
  assert.deepEqual(prGroup({ stage: "ci-failed" }), { group: "needs", reason: "ci" });
  assert.deepEqual(prGroup({ stage: "review", talk: { newReply: true } }), { group: "needs", reason: "reply" });
  assert.deepEqual(prGroup({ stage: "review" }), { group: "waiting", reason: "review" });
  assert.deepEqual(prGroup({ stage: "ci-running" }), { group: "waiting", reason: "checks" });
  assert.deepEqual(prGroup({ stage: "draft", draft: true, talk: { newReply: true } }), { group: "waiting", reason: "draft" });
  assert.deepEqual(prGroup({ stage: "ready", review: "APPROVED" }), { group: "ready", reason: "approved" });
  assert.deepEqual(prGroup({ stage: "ready", review: null }), { group: "ready", reason: "green" });
});

test("the needs-you count and the attention keys", () => {
  const parts = {
    issues: [{ number: 1, newReply: true, replyAt: "t1", replyBy: "ana", title: "a" }, { number: 2, newReply: false }],
    prs: [{ number: 3, group: "needs", reason: "ci" }, { number: 4, group: "needs", reason: "reply", replyAt: "t2" }, { number: 5, group: "ready", reason: "green" }],
    asked: [{ kind: "review", number: 6 }, { kind: "mention", number: 7, at: "t3" }],
  };
  assert.equal(needsCount(parts), 5);
  assert.deepEqual(attention(parts).map((a) => a.key), ["i1@t1", "p4@t2", "r6", "m7@t3"]);
});

test("buildMine merges both issue searches, links PRs, and skips mentions already shown", () => {
  const issue = {
    number: 10, title: "Fix it", url: "u10", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-05T00:00:00Z", author: { login: "ana" },
    labels: { nodes: [{ name: "bug", color: "d73a4a" }] },
    comments: { nodes: [{ author: { __typename: "User", login: "ana" }, createdAt: "2026-01-04T00:00:00Z" }] },
    closedByPullRequestsReferences: { nodes: [{ number: 20, url: "u20", state: "OPEN" }] },
    timelineItems: { nodes: [
      { __typename: "AssignedEvent", createdAt: "2026-01-02T00:00:00Z", assignee: { login: "octo" } },
      { __typename: "CrossReferencedEvent", createdAt: "2026-01-03T00:00:00Z", source: { __typename: "PullRequest", number: 21, url: "u21", state: "MERGED" } },
      { __typename: "CrossReferencedEvent", createdAt: "2026-01-03T00:00:00Z", source: { __typename: "Issue", number: 22 } },
    ] },
  };
  const d = {
    viewer: { login: ME },
    assigned: { nodes: [issue] },
    opened: { nodes: [] },
    review: { nodes: [{ number: 30, title: "Review me", url: "u30", isDraft: false, updatedAt: "2026-01-06T00:00:00Z", author: { login: "bob" } }, { number: 31, isDraft: true }] },
    mentions: { nodes: [
      { __typename: "Issue", number: 10, title: "dup", createdAt: "x", author: { login: "ana" }, body: "@octo", comments: { nodes: [] } },
      { __typename: "PullRequest", number: 40, title: "Look", url: "u40", createdAt: "2026-01-01T00:00:00Z", author: { login: "bob" }, body: "", comments: { nodes: [{ author: { login: "bob" }, createdAt: "2026-01-02T00:00:00Z", body: "@octo ?" }] }, reviews: { nodes: [] } },
    ] },
  };
  const board = { me: ME, readAt: 1, prs: [{ number: 50, title: "Mine", url: "u50", mine: true, draft: false, updated: "2026-01-01T00:00:00Z", stage: "ci-failed", ci: { pass: 3, fail: 1, run: 0, queue: 0 } }, { number: 51, mine: false, stage: "ready", ci: {} }] };
  const m = buildMine(d, board, "o/r");
  assert.equal(m.issues.length, 1);
  const i = m.issues[0];
  assert.equal(i.why, "assigned");
  assert.equal(i.newReply, true); // ana commented after I was assigned
  assert.deepEqual(i.linked.map((p) => [p.number, p.closes]), [[20, true], [21, false]]);
  assert.deepEqual(m.prs.map((p) => [p.number, p.group, p.reason]), [[50, "needs", "ci"]]);
  assert.deepEqual(m.asked.map((a) => [a.kind, a.number]), [["review", 30], ["mention", 40]]);
  assert.equal(m.counts.needsYou, 4);
  assert.equal(buildMine(d, { loading: true }, "o/r").prs, null);
  assert.equal(buildMine(d, { me: ME, readAt: 0, prs: [] }, "o/r").prs, null); // merged list read, open PRs not yet
});

test("search strings are scoped to the repo, and errors become friendly codes", () => {
  for (const q of Object.values(searches("o/r"))) assert.match(q, /^repo:o\/r is:/);
  assert.equal(errorCode("To get started with GitHub CLI, please run:  gh auth login"), "auth");
  assert.equal(errorCode("Error: spawn gh ENOENT"), "nogh");
  assert.equal(errorCode("Could not resolve to a Repository with the name 'o/r'."), "repo");
  assert.equal(errorCode("GitHub request budget for this hour is used up"), "budget");
  assert.equal(errorCode("something else"), "failed");
});
