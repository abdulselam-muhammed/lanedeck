import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { changeHidden, hiddenIds } from "../server/hiddenagents.mjs";
import { checkSettings } from "../server/config.mjs";

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ld-hidden-")), "hidden-agents.json");

test("hide, unhide and unhide all: a list of ids in our own file, reversible", () => {
  const file = tmp();
  assert.deepEqual(hiddenIds(file), []);
  assert.deepEqual(changeHidden("hide", ["a1", "a2", "a3"], { file }).sort(), ["a1", "a2", "a3"]);
  assert.deepEqual(changeHidden("hide", ["a1"], { file, now: Date.now() + 5 }).sort(), ["a1", "a2", "a3"]); // idempotent
  assert.deepEqual(changeHidden("unhide", ["a2"], { file }).sort(), ["a1", "a3"]);
  assert.deepEqual(hiddenIds(file).sort(), ["a1", "a3"]); // persisted
  assert.deepEqual(changeHidden("unhideAll", [], { file }), []);
  assert.deepEqual(hiddenIds(file), []);
});

test("bad input is refused and ids not seen for 90 days are dropped on write", () => {
  const file = tmp();
  assert.throws(() => changeHidden("hide", ["../etc"], { file }), /ids must be/);
  assert.throws(() => changeHidden("hide", [], { file }), /ids must be/);
  assert.throws(() => changeHidden("delete", ["a1"], { file }), /action must be/);
  changeHidden("hide", ["old"], { file, now: 1_000 });
  assert.deepEqual(changeHidden("hide", ["new"], { file, now: 1_000 + 91 * 86400e3 }), ["new"]);
});

test("a broken or foreign file reads as empty, never throws", () => {
  const file = tmp();
  fs.writeFileSync(file, "{not json");
  assert.deepEqual(hiddenIds(file), []);
  fs.writeFileSync(file, JSON.stringify({ hidden: { ok1: 5, "bad id": 6, x: "no" } }));
  assert.deepEqual(hiddenIds(file), ["ok1"]);
});

test("agents.windowHours: 48 by default, only 24, 48 or 168 accepted", () => {
  assert.equal(checkSettings({}).settings.agents.windowHours, 48);
  assert.equal(checkSettings({ agents: { windowHours: 168 } }).ok, true);
  assert.equal(checkSettings({ agents: { windowHours: 72 } }).ok, false);
});
