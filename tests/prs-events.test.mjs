// The PR board's "what happened" feed: a PR that leaves the open list is announced as merged when it was merged (the merged
// list is read on its own, slower cadence), and as "closed without merging" only once that list has missed it twice.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeBoard } from "../server/prs/board.mjs";

const P = { repo: "example/app", repoPath: null, defaultBranch: "main", gateCheck: null, boardFiles: [], holds: {}, me: "alice", reviewers: [{ login: "bob" }], reviewMarkers: { ask: [], fail: [], pass: [] } };
const pr = (n) => ({ number: n, title: `PR ${n}`, head: `h${n}`, mergeable: "MERGEABLE", ci: { gate: "pass", fail: 0, failed: [] }, review: null });
const merged = (n) => ({ number: n, title: `PR ${n}`, url: "", author: "alice", at: "2026-03-10T12:00:00Z", by: "bob", sha: "" });

function board() {
  const Board = makeBoard(P);
  const b = new Board({ dataRoot: fs.mkdtempSync(path.join(os.tmpdir(), "ld-prs-")) });
  const events = [];
  b.on("event", (e) => events.push(e));
  return { b, events };
}

test("a PR merged between two merged reads is announced as merged, never as closed", () => {
  const { b, events } = board();
  b.applyMerged([]); // the first read: nothing merged in the last 14 days
  b.diff(new Map([[1, pr(1)], [2, pr(2)]]), new Map([[2, pr(2)]]), null, { sha: "x" });
  assert.deepEqual(events, [], "gone from the open list: not yet known whether merged or closed");
  b.applyMerged([merged(1)]);
  assert.deepEqual(events.map((e) => [e.k, e.n, e.by]), [["merged", 1, "bob"]]);
  b.applyMerged([merged(1)]);
  assert.equal(events.length, 1);
});

test("a PR closed without merging is announced once the merged list missed it twice; a reopened one is not", () => {
  const { b, events } = board();
  b.applyMerged([]);
  b.diff(new Map([[1, pr(1)], [2, pr(2)]]), new Map(), null, { sha: "x" });
  b.applyMerged([]);
  assert.deepEqual(events, [], "the search index may lag one read");
  b.diff(new Map(), new Map([[2, pr(2)]]), null, { sha: "x" }); // #2 reopened
  b.applyMerged([]);
  assert.deepEqual(events.map((e) => [e.k, e.n]), [["opened", 2], ["closed", 1]]);
});

test("the first merge after an empty merged list is still an event", () => {
  const { b, events } = board();
  b.applyMerged([]);
  b.applyMerged([merged(5)]);
  assert.deepEqual(events.map((e) => [e.k, e.n]), [["merged", 5]]);
});
