import test from "node:test";
import assert from "node:assert/strict";
import { createBudget } from "../server/budget.mjs";

const clock = () => { let t = 1_000_000; return { now: () => t, tick: (ms) => { t += ms; } }; };

test("spend is denied past the hourly limit and counted", () => {
  const c = clock();
  const b = createBudget(() => 10, c.now);
  for (let i = 0; i < 10; i++) assert.equal(b.spend(1, "a"), true);
  assert.equal(b.spend(1, "a"), false);
  assert.equal(b.usage().used, 10);
  assert.equal(b.usage().denied, 1);
});

test("the window slides: calls older than an hour are forgotten", () => {
  const c = clock();
  const b = createBudget(() => 3, c.now);
  assert.ok(b.spend(3, "a"));
  assert.equal(b.spend(1, "a"), false);
  c.tick(3600e3 + 1);
  assert.equal(b.spend(1, "a"), true);
});

test("fair share: one owner cannot starve the others once the hour is half used", () => {
  const c = clock();
  const b = createBudget(() => 100, c.now);
  assert.ok(b.spend(1, "ci"));
  assert.ok(b.spend(1, "prs:p2"));
  let hogged = 0;
  while (b.spend(1, "branch:p1")) hogged++;
  // the hog runs free until half the hour is used, then is held to its share: the other half stays for the others
  assert.ok(hogged <= 48, `hog took ${hogged}`);
  assert.equal(b.spend(1, "ci"), true);
  assert.equal(b.spend(1, "prs:p2"), true);
  assert.ok(b.usage().owners["branch:p1"].denied > 0);
});

test("under half the budget nobody is limited by share", () => {
  const c = clock();
  const b = createBudget(() => 100, c.now);
  b.spend(1, "ci");
  for (let i = 0; i < 40; i++) assert.ok(b.spend(1, "a"));
});

test("refund gives calls back (a 304 costs nothing)", () => {
  const c = clock();
  const b = createBudget(() => 5, c.now);
  b.spend(1, "ci"); b.spend(1, "ci");
  b.refund(1, "ci");
  assert.equal(b.usage().used, 1);
  assert.equal(b.usage().owners.ci.used, 1);
});

test("usage reports every owner, CI included", () => {
  const b = createBudget(() => 50, clock().now);
  b.spend(2, "ci"); b.spend(1, "prs:x");
  const u = b.usage();
  assert.deepEqual(Object.keys(u.owners).sort(), ["ci", "prs:x"]);
  assert.equal(u.limit, 50);
});
