import test from "node:test";
import assert from "node:assert/strict";
import { badgeOf, chipCounts, chipOfSection, chipsFor, CHIPS, dayOf, groupByDay, initials, kindOf, matchChip } from "../src/lib/notify/list.mjs";

const row = (id, section, { unread = false, review = null, state = null } = {}) => ({ id: String(id), section, unread, review, state });

test("the chips, in order; a requested review and a review on my PR share the Reviews chip", () => {
  assert.deepEqual(CHIPS, ["all", "unread", "mentions", "replies", "reviews", "assigned", "status"]);
  assert.equal(chipOfSection("mentions"), "mentions");
  assert.equal(chipOfSection("replies"), "replies");
  assert.equal(chipOfSection("review"), "reviews");
  assert.equal(chipOfSection("reviews"), "reviews");
  assert.equal(chipOfSection("assigned"), "assigned");
  assert.equal(chipOfSection("state"), "status");
  assert.equal(chipOfSection("bogus"), null);
});

test("a chip shows its rows only; All shows every row; Unread shows the unread ones", () => {
  const rows = [row(1, "mentions", { unread: true }), row(2, "review"), row(3, "reviews", { unread: true }), row(4, "state"), row(5, "replies")];
  const ids = (c) => rows.filter((r) => matchChip(r, c)).map((r) => r.id);
  assert.deepEqual(ids("all"), ["1", "2", "3", "4", "5"]);
  assert.deepEqual(ids("unread"), ["1", "3"]);
  assert.deepEqual(ids("reviews"), ["2", "3"]);
  assert.deepEqual(ids("status"), ["4"]);
  assert.deepEqual(ids("assigned"), []);
});

test("chip counts: All counts every row, the others their unread rows", () => {
  const n = chipCounts([row(1, "mentions", { unread: true }), row(2, "review", { unread: true }), row(3, "reviews"), row(4, "state", { unread: true })]);
  assert.deepEqual(n, { all: 4, unread: 3, mentions: 1, replies: 0, reviews: 1, assigned: 0, status: 1 });
});

test("only the chips of the sections kept in Settings are offered", () => {
  assert.deepEqual(chipsFor(["mentions", "state"]), ["all", "unread", "mentions", "status"]);
  assert.deepEqual(chipsFor(["review"]), ["all", "unread", "reviews"]);
  assert.deepEqual(chipsFor([]), ["all", "unread"]);
});

test("day groups follow the local calendar: today, yesterday, earlier this week, older", () => {
  const now = new Date(2026, 4, 20, 9, 30).getTime();
  assert.equal(dayOf(new Date(2026, 4, 20, 0, 1).getTime(), now), "today");
  assert.equal(dayOf(new Date(2026, 4, 19, 23, 59).getTime(), now), "yesterday");
  assert.equal(dayOf(new Date(2026, 4, 19, 0, 0).getTime(), now), "yesterday");
  assert.equal(dayOf(new Date(2026, 4, 18, 12, 0).getTime(), now), "week");
  assert.equal(dayOf(new Date(2026, 4, 14, 0, 0).getTime(), now), "week");
  assert.equal(dayOf(new Date(2026, 4, 13, 23, 59).getTime(), now), "older");
});

test("groupByDay: groups in order, newest first inside, empty groups dropped", () => {
  const now = new Date(2026, 4, 20, 12, 0).getTime();
  const at = (d, h) => new Date(2026, 4, d, h).getTime();
  const g = groupByDay([{ k: "a", at: at(20, 8) }, { k: "b", at: at(10, 9) }, { k: "c", at: at(20, 11) }, { k: "d", at: at(17, 9) }], now);
  assert.deepEqual(g.map((x) => x.day), ["today", "week", "older"]);
  assert.deepEqual(g[0].rows.map((r) => r.k), ["c", "a"]);
  assert.deepEqual(groupByDay([], now), []);
});

test("a row's kind follows its section, review and state; every kind has a badge", () => {
  assert.equal(kindOf(row(1, "mentions")), "mention");
  assert.equal(kindOf(row(1, "replies")), "comment");
  assert.equal(kindOf(row(1, "review")), "review_requested");
  assert.equal(kindOf(row(1, "reviews", { review: "approved" })), "approved");
  assert.equal(kindOf(row(1, "reviews", { review: "changes_requested" })), "changes_requested");
  assert.equal(kindOf(row(1, "reviews", { review: "commented" })), "reviewed");
  assert.equal(kindOf(row(1, "assigned")), "assigned");
  assert.equal(kindOf(row(1, "state", { state: "merged" })), "merged");
  assert.equal(kindOf(row(1, "state", { state: "closed" })), "closed");
  assert.equal(kindOf(row(1, "state", { state: "open" })), "reopened");
  for (const k of ["mention", "comment", "review_requested", "approved", "changes_requested", "reviewed", "assigned", "merged", "closed", "reopened"]) assert.equal(badgeOf(k).length, 2);
  assert.deepEqual(badgeOf("unknown"), badgeOf("comment"));
});

test("initials for an avatar without a picture", () => {
  assert.equal(initials("alice"), "AL");
  assert.equal(initials("mary-ann"), "MA");
  assert.equal(initials("ci-bot[bot]"), "CB");
  assert.equal(initials(null), "?");
});
