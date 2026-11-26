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

test("fair share: one owner cannot starve the others once three quarters of the hour is used", () => {
  const c = clock();
  const b = createBudget(() => 100, c.now);
  assert.ok(b.spend(1, "ci"));
  assert.ok(b.spend(1, "prs:p2"));
  let hogged = 0;
  while (b.spend(1, "branch:p1")) hogged++;
  // the hog runs free until three quarters of the hour is used, then is held to its share: the last quarter stays for the others
  assert.ok(hogged <= 73, `hog took ${hogged}`);
  assert.equal(b.spend(1, "ci"), true);
  assert.equal(b.spend(1, "prs:p2"), true);
  assert.ok(b.usage().owners["branch:p1"].denied > 0);
});

test("under three quarters of the budget nobody is limited by share", () => {
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

test("owners that went quiet do not shrink the share of the one still working", () => {
  const c = clock();
  const b = createBudget(() => 100, c.now);
  for (const who of ["a", "b", "c", "d"]) assert.ok(b.spend(1, who));
  c.tick(20 * 60e3); // a..d are quiet now, but their calls are still inside the hour
  let board = 0;
  while (b.spend(1, "prs:x")) board++;
  // with 5 counted owners the share would be 20; with only the active one it can use what is left
  assert.ok(board > 60, `board got ${board}`);
});

test("refund gives the calls back to the owner that spent them", () => {
  const c = clock();
  const b = createBudget(() => 10, c.now);
  b.spend(3, "a"); b.spend(2, "b");
  b.refund(2, "a");
  assert.equal(b.usage().owners.a.used, 1);
  assert.equal(b.usage().owners.b.used, 2);
  assert.equal(b.usage().used, 3);
});

test("top names the biggest spenders, for the message that says who used the budget", () => {
  const c = clock();
  const b = createBudget(() => 100, c.now);
  b.spend(5, "prs:a"); b.spend(2, "mine:a"); b.spend(9, "ci");
  assert.equal(b.top(2), "ci 9, prs:a 5");
  assert.equal(createBudget(() => 1, c.now).top(), "");
});
