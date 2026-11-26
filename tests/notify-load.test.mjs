// The Inbox's GitHub poller costs nothing while nobody looks, does not multiply with tabs, and pushes instead of being polled.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createNotify } from "../server/notify/notify.mjs";
import { createNotifyPush, rowsKey } from "../server/notify/push.mjs";
import { createBudget } from "../server/budget.mjs";
import { simulate } from "../scripts/sim-notify-load.mjs";

const http = (status, body, headers = {}) =>
  `HTTP/2.0 ${status} X\r\n${Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join("\r\n")}${Object.keys(headers).length ? "\r\n" : ""}\r\n${body === undefined ? "" : JSON.stringify(body)}`;
const flush = async () => { for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r)); };
const cfg = {
  projects: [{ id: "sd-sample", repo: "example/repo" }],
  tools: { gh: "gh" },
  notifications: { github: { enabled: true, sections: ["mentions", "replies", "review", "reviews", "assigned", "state"], pollSeconds: 60 }, browser: false },
};
const LM = "Mon, 05 Jan 2026 08:00:00 GMT";
/** A fake gh whose list is empty: 200 the first time, 304 to If-Modified-Since after. */
function fakeGh(pollInterval = 60) {
  const calls = [];
  const run = async (_gh, a) => {
    calls.push(a);
    if (a.some((x) => x === `If-Modified-Since: ${LM}`)) return { code: 1, out: http(304, undefined, { "X-Poll-Interval": String(pollInterval) }), err: "gh: HTTP 304" };
    return { code: 0, out: http(200, [], { "Last-Modified": LM, "X-Poll-Interval": String(pollInterval) }), err: "" };
  };
  return { calls, run };
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ld-notify-load-"));

test("one simulated hour: 0 tabs cost nothing, 1 and 3 tabs cost the same GitHub calls, tabs never poll", async () => {
  const [zero, one, three] = [await simulate(0), await simulate(1), await simulate(3)];
  assert.deepEqual([zero.gh, zero.github, zero.budget, zero.local], [0, 0, 0, 0]);
  assert.equal(one.gh, three.gh, "the GitHub calls do not grow with the tabs");
  assert.equal(one.budget, three.budget);
  assert.ok(one.github <= 11, `github calls ${one.github}`);
  assert.equal(one.budget, one.github, "every 304 is refunded: only what GitHub counts stays booked");
  assert.equal(three.local, 6, "each tab reads its two scopes once, then only receives pushes");
  assert.equal(one.data, 5, "rows are pushed on the first poll and on each of the 4 changes only");
});

test("nobody looking: the poller sleeps; a page wakes it, never sooner than X-Poll-Interval after the last poll", async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.parse("2026-01-05T09:00:00Z") });
  try {
    let looking = false;
    const { calls, run } = fakeGh(90);
    const n = createNotify({ root: tmp(), run, config: () => cfg, spend: () => true, refund: () => {}, wanted: () => looking, autostart: true });
    mock.timers.tick(600e3);
    await flush();
    assert.equal(calls.length, 0, "no page: not even the start-up poll");
    assert.equal(n.sleeping(), true);
    looking = true;
    n.wake();
    mock.timers.tick(1000);
    await flush();
    assert.equal(calls.length, 1, "the catch-up poll");
    looking = false;
    mock.timers.tick(90e3);
    await flush();
    assert.equal(calls.length, 1, "the page left: the due poll is skipped");
    assert.equal(n.sleeping(), true);
    // Back once X-Poll-Interval (90 s) since the last poll has passed: the catch-up poll is due at once.
    looking = true;
    n.wake();
    assert.equal(n.answer("all").state.nextAt != null, true);
    mock.timers.tick(1000);
    await flush();
    assert.equal(calls.length, 2, "91 s after the last poll: due now");
    assert.ok(calls[1].includes(`If-Modified-Since: ${LM}`), "the catch-up is conditional");
    n.wake();
    mock.timers.tick(30e3);
    await flush();
    assert.equal(calls.length, 2, "a second wake does not poll faster than X-Poll-Interval");
    mock.timers.tick(60e3);
    await flush();
    assert.equal(calls.length, 3);
    n.stop();
  } finally {
    mock.timers.reset();
  }
});

test("a 304 is refunded to lanedeck's budget and pushes only the small state event", async () => {
  const budget = createBudget(() => 1000);
  const { run } = fakeGh();
  let push = () => {};
  const n = createNotify({ root: tmp(), run, config: () => cfg, spend: (k, w) => budget.spend(k, w), refund: (k, w) => budget.refund(k, w), onChange: () => push(), autostart: false });
  const sent = [];
  const sticky = new Map();
  const publishEach = (type, fn) => { const d = fn("sd-sample"); if (d === undefined) return; const t = JSON.stringify(d); if (sticky.get(type) !== t) { sticky.set(type, t); sent.push(type); } };
  push = createNotifyPush({ answer: n.answer, publishEach }).push;
  await n.tick();
  assert.equal(budget.usage().owners.notify.used, 1, "the first list read is a 200");
  assert.deepEqual(sent, ["notify.data", "notify.state"]);
  sent.length = 0;
  await new Promise((r) => setTimeout(r, 5)); // checkedAt moves
  await n.tick();
  assert.equal(budget.usage().owners.notify.used, 1, "the 304 was refunded");
  assert.deepEqual(sent, ["notify.state"], "unchanged rows are not sent again");
  // A page that connects gets its project's rows again (a new channel has no sticky copy yet).
  sent.length = 0;
  sticky.clear();
  createNotifyPush({ answer: n.answer, publishEach }).push("sd-sample");
  assert.deepEqual(sent, ["notify.data", "notify.state"]);
});

test("rowsKey ignores only the fields that move on every poll", () => {
  const a = { items: [1], state: { code: "ok", at: 1, checkedAt: 2, nextAt: 3 } };
  assert.equal(rowsKey(a), rowsKey({ ...a, state: { code: "ok", at: 9, checkedAt: 9, nextAt: 9 } }));
  assert.notEqual(rowsKey(a), rowsKey({ ...a, state: { ...a.state, code: "auth" } }));
  assert.notEqual(rowsKey(a), rowsKey({ ...a, items: [2] }));
});
