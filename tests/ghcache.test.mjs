import test from "node:test";
import assert from "node:assert/strict";
import { cachedGet, httpOut } from "../server/ghcache.mjs";

const OK = (etag, body) => `HTTP/2.0 200 OK\r\nEtag: ${etag}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(body)}`;
const NOT_MODIFIED = 'HTTP/2.0 304 Not Modified\r\nEtag: "a"\r\n\r\n';
const exit1 = new Error("Command failed: gh: HTTP 304");

function rig(answers) {
  const calls = []; let spent = 0, refunded = 0;
  const etags = new Map();
  const exec = async (args) => { calls.push(args); return answers.shift(); };
  const get = () => cachedGet({ exec, spend: () => { spent++; return true; }, refund: () => { refunded++; }, etags, url: "repos/o/r/commits/main" });
  return { get, calls, counts: () => ({ spent, refunded }) };
}

test("gh exits 1 with a 304 head: not modified, cached body, request refunded", async () => {
  const r = rig([{ err: null, out: OK('"a"', { sha: "1" }) }, { err: exit1, out: NOT_MODIFIED }, { err: exit1, out: NOT_MODIFIED }]);
  assert.deepEqual(await r.get(), { body: { sha: "1" } });
  assert.deepEqual(await r.get(), { body: { sha: "1" } });
  assert.deepEqual(await r.get(), { body: { sha: "1" } });
  assert.ok(r.calls[1].includes('If-None-Match: "a"'));
  assert.deepEqual(r.counts(), { spent: 3, refunded: 2 });
});

test("a non-zero exit with no HTTP head is a failure and is refunded", async () => {
  const r = rig([{ err: new Error("ENOENT"), out: "" }]);
  assert.deepEqual(await r.get(), { failed: true });
  assert.deepEqual(r.counts(), { spent: 1, refunded: 1 });
});

test("other error statuses (404, 403) stay failures", async () => {
  const r = rig([{ err: exit1, out: "HTTP/2.0 404 Not Found\r\n\r\n{}" }]);
  assert.deepEqual(await r.get(), { failed: true });
});

test("a 304 without a cached body is a failure, not an empty answer", async () => {
  const r = rig([{ err: exit1, out: NOT_MODIFIED }]);
  assert.deepEqual(await r.get(), { failed: true });
});

test("the budget being used up is denied before any call", async () => {
  const out = await cachedGet({ exec: async () => assert.fail("no call"), spend: () => false, refund() {}, etags: new Map(), url: "x" });
  assert.deepEqual(out, { denied: true });
});

test("httpOut keeps stdout only for an HTTP answer", () => {
  assert.equal(httpOut(null, "abc\n"), "abc");
  assert.equal(httpOut(exit1, NOT_MODIFIED).startsWith("HTTP/2.0 304"), true);
  assert.equal(httpOut(exit1, "garbage"), null);
  assert.equal(httpOut(exit1, undefined), null);
});
