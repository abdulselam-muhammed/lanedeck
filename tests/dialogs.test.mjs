// The in-app dialogs' logic (src/lib/dialogs.mjs): a confirm resolves true or false once, requests queue, Esc cancels, Enter confirms
// (but presses Cancel when focus is on it), and the Tab trap wraps.
//   node --test tests/dialogs.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDialogs, keyAction, nextFocus } from "../src/lib/dialogs.mjs";

test("confirm resolves true when confirmed and false when cancelled", async () => {
  const d = createDialogs();
  const a = d.confirm({ title: "A" });
  assert.equal(d.current().opts.title, "A");
  d.settle(true);
  assert.equal(await a, true);
  assert.equal(d.current(), null);
  const b = d.confirm({ title: "B", tone: "danger" });
  d.settle(false);
  assert.equal(await b, false);
});

test("requests queue and show one after the other; the snapshot stays the same object until it settles", async () => {
  const d = createDialogs();
  const a = d.confirm({ title: "A" });
  const b = d.confirm({ title: "B" });
  const first = d.current();
  assert.equal(d.current(), first);
  d.settle(true);
  assert.equal(await a, true);
  assert.equal(d.current().opts.title, "B");
  d.settle(false);
  assert.equal(await b, false);
});

test("a notice resolves when it is closed, whichever way", async () => {
  const d = createDialogs();
  const n = d.notice({ title: "Heads up" });
  assert.equal(d.current().kind, "notice");
  d.settle(false);
  assert.equal(await n, undefined);
});

test("subscribers hear about every change, and settle with nothing open is harmless", () => {
  const d = createDialogs();
  let n = 0;
  const off = d.subscribe(() => n++);
  d.settle(true);
  assert.equal(n, 0);
  d.confirm({ title: "A" });
  d.settle(true);
  assert.equal(n, 2);
  off();
  d.confirm({ title: "B" });
  assert.equal(n, 2);
});

test("keys: Esc cancels, Enter confirms, Enter on Cancel and held-down Enter do not confirm", () => {
  assert.equal(keyAction({ key: "Escape" }), "cancel");
  assert.equal(keyAction({ key: "Enter" }), "confirm");
  assert.equal(keyAction({ key: "Enter", onCancelButton: true }), null);
  assert.equal(keyAction({ key: "Enter", repeat: true }), null);
  assert.equal(keyAction({ key: "a" }), null);
});

test("the focus trap wraps in both directions and starts at either end when focus is outside", () => {
  assert.equal(nextFocus(0, 2, false), 1);
  assert.equal(nextFocus(1, 2, false), 0);
  assert.equal(nextFocus(0, 2, true), 1);
  assert.equal(nextFocus(-1, 2, false), 0);
  assert.equal(nextFocus(-1, 2, true), 1);
  assert.equal(nextFocus(0, 0, false), -1);
});
