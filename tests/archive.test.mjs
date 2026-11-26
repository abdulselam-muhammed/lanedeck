// Inbox archive: nothing is deleted, archive and restore round-trip, a taken name never gets overwritten, the age rule, the
// open-question rule, and paths outside the inbox are refused.
//   node --test tests/archive.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { archiveItems, autoArchive, listArchive, restoreItems, hasOpenQuestions, parseRel } from "../server/archive.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sd-arch-"));
process.on("exit", () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } });
let n = 0;
/** A fresh explicit inbox folder (no repo). */
function inbox(files = {}) {
  const dir = path.join(tmp, `i${++n}`, "inbox");
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return { inboxDir: dir, repoPath: null, proto: true };
}
const old = (ctx, name, days) => { const t = new Date(Date.now() - days * 864e5); fs.utimesSync(path.join(ctx.inboxDir, name), t, t); };
const ls = (d) => fs.readdirSync(d).sort();

test("archive moves the file under .archive/YYYY-MM with a manifest, and restore puts it back", () => {
  const ctx = inbox({ "a.md": "# A\nhello\n" });
  const r = archiveItems(ctx, ["a.md"], { by: "manual", now: Date.UTC(2026, 10, 5) });
  assert.equal(r.archived.length, 1);
  assert.equal(r.archived[0].id, "2026-11/a.md");
  assert.deepEqual(ls(ctx.inboxDir), [".archive"]);
  assert.deepEqual(ls(path.join(ctx.inboxDir, ".archive", "2026-11")), ["a.md", "a.md.archived.json"]);
  const items = listArchive(ctx);
  assert.equal(items.length, 1);
  assert.equal(items[0].original, "a.md");
  assert.equal(items[0].by, "manual");
  assert.equal(items[0].title, "A");
  const back = restoreItems(ctx, ["2026-11/a.md"]);
  assert.equal(back.restored[0].to, "a.md");
  assert.equal(fs.readFileSync(path.join(ctx.inboxDir, "a.md"), "utf8"), "# A\nhello\n"); // content is byte for byte the same
  assert.deepEqual(listArchive(ctx), []);
  assert.deepEqual(ls(path.join(ctx.inboxDir, ".archive", "2026-11")), []); // the manifest went with it
});

test("a relative path inside a folder is kept, and a folder moves whole", () => {
  const ctx = inbox({ "sub/b.md": "b", "dir/x.md": "x", "dir/y.md": "y" });
  archiveItems(ctx, ["sub/b.md", "dir"], { now: Date.UTC(2026, 0, 2) });
  assert.ok(fs.existsSync(path.join(ctx.inboxDir, ".archive", "2026-01", "sub", "b.md")));
  assert.ok(fs.existsSync(path.join(ctx.inboxDir, ".archive", "2026-01", "dir", "y.md")));
  assert.equal(fs.existsSync(path.join(ctx.inboxDir, "dir")), false);
  const kinds = Object.fromEntries(listArchive(ctx).map((i) => [i.original, i.kind]));
  assert.deepEqual(kinds, { "sub/b.md": "file", dir: "dir" });
  restoreItems(ctx, "all");
  assert.equal(fs.readFileSync(path.join(ctx.inboxDir, "sub", "b.md"), "utf8"), "b");
  assert.equal(fs.readFileSync(path.join(ctx.inboxDir, "dir", "x.md"), "utf8"), "x");
});

test("archiving the same name twice keeps both; restoring onto a taken name restores beside it, never over it", () => {
  const ctx = inbox({ "a.md": "first" });
  archiveItems(ctx, ["a.md"], { now: Date.UTC(2026, 5, 1) });
  fs.writeFileSync(path.join(ctx.inboxDir, "a.md"), "second");
  const r = archiveItems(ctx, ["a.md"], { now: Date.UTC(2026, 5, 2) });
  assert.equal(r.archived[0].id, "2026-06/a (2).md");
  fs.writeFileSync(path.join(ctx.inboxDir, "a.md"), "third (the name is taken again)");
  const back = restoreItems(ctx, "all");
  assert.equal(back.failed.length, 0);
  assert.equal(back.restored.length, 2);
  assert.equal(fs.readFileSync(path.join(ctx.inboxDir, "a.md"), "utf8"), "third (the name is taken again)"); // untouched
  const got = ls(ctx.inboxDir).filter((x) => x.endsWith(".md")).map((x) => fs.readFileSync(path.join(ctx.inboxDir, x), "utf8")).sort();
  assert.deepEqual(got, ["first", "second", "third (the name is taken again)"]);
  assert.ok(back.restored.every((x) => x.renamed));
});

test("auto-archive: only files older than N days; a recent one stays", () => {
  const ctx = inbox({ "old.md": "# old\nno question\n", "new.md": "# new\n" });
  old(ctx, "old.md", 20);
  const r = autoArchive(ctx, 14);
  assert.deepEqual(r.archived.map((x) => x.name), ["old.md"]);
  assert.deepEqual(ls(ctx.inboxDir).filter((x) => x.endsWith(".md")), ["new.md"]);
  assert.equal(listArchive(ctx)[0].by, "auto");
  assert.deepEqual(autoArchive(ctx, 14).archived, []); // nothing left to take
});

test("auto-archive never takes an unanswered question, but takes an answered one", () => {
  const ctx = inbox({
    "open.md": "# T\n\n## Q1 - which db?\nSome text\n",
    "answered.md": "# T\n\n## Q1 - which db?\n**Answer:** postgres\n",
    "00-README.md": "# readme\n",
  });
  for (const f of ["open.md", "answered.md", "00-README.md"]) old(ctx, f, 60);
  const r = autoArchive(ctx, 7);
  assert.deepEqual(r.archived.map((x) => x.name), ["answered.md"]);
  assert.deepEqual(r.skipped.map((x) => [x.name, x.code]), [["open.md", "open-question"]]);
  assert.ok(fs.existsSync(path.join(ctx.inboxDir, "open.md")));
  assert.ok(fs.existsSync(path.join(ctx.inboxDir, "00-README.md"))); // the readme is never swept
});

test("legacy (non-protocol) inboxes count every question line as open", () => {
  assert.equal(hasOpenQuestions("## Q1 - x\n**Answer:** y\n", true), false);
  assert.equal(hasOpenQuestions("## Q1 - x\n**Answer:** y\n", false), true);
});

test("a manual archive can skip open questions and files that are too new", () => {
  const ctx = inbox({ "q.md": "## Q2 - ?\n", "fresh.md": "x", "stale.md": "y" });
  old(ctx, "stale.md", 40); old(ctx, "q.md", 40);
  const r = archiveItems(ctx, ["q.md", "fresh.md", "stale.md"], { skipOpenQuestions: true, olderThanDays: 30 });
  assert.deepEqual(r.archived.map((x) => x.name), ["stale.md"]);
  assert.deepEqual(Object.fromEntries(r.skipped.map((x) => [x.name, x.code])), { "q.md": "open-question", "fresh.md": "too-new" });
});

test("traversal and absolute paths are rejected, nothing outside the inbox is touched", () => {
  const ctx = inbox({ "a.md": "a" });
  const outside = path.join(path.dirname(ctx.inboxDir), "secret.md");
  fs.writeFileSync(outside, "secret");
  for (const bad of ["../secret.md", "..", "a/../../secret.md", "/etc/passwd", "C:\\x.md", "..\\secret.md", ".archive/2026-01/x", "_archive/x.md", "", "a.md.archived.json"]) {
    const r = archiveItems(ctx, [bad]);
    assert.equal(r.archived.length, 0, bad);
    assert.equal(r.skipped.length, 1, bad);
  }
  assert.equal(fs.readFileSync(outside, "utf8"), "secret");
  assert.throws(() => parseRel("a/../b"));
  // restore: bad ids and a tampered manifest that points outside
  archiveItems(ctx, ["a.md"], { now: Date.UTC(2026, 2, 3) });
  for (const bad of ["../x", "2026-03/../../secret.md", "x/a.md", "2026-03", "/2026-03/a.md"]) assert.equal(restoreItems(ctx, [bad]).restored.length, 0, bad);
  const meta = path.join(ctx.inboxDir, ".archive", "2026-03", "a.md.archived.json");
  const m = JSON.parse(fs.readFileSync(meta, "utf8"));
  m.original = "../secret.md";
  fs.writeFileSync(meta, JSON.stringify(m));
  const r = restoreItems(ctx, ["2026-03/a.md"]);
  assert.equal(r.restored.length, 0);
  assert.equal(r.failed[0].code, "bad-path");
  assert.equal(fs.readFileSync(outside, "utf8"), "secret");
});

test("a symlinked inbox entry is not moved (junction or link components are refused)", (t) => {
  const ctx = inbox({ "a.md": "a" });
  const real = path.join(path.dirname(ctx.inboxDir), "elsewhere");
  fs.mkdirSync(real);
  fs.writeFileSync(path.join(real, "z.md"), "z");
  try { fs.symlinkSync(real, path.join(ctx.inboxDir, "link"), process.platform === "win32" ? "junction" : "dir"); } catch { return t.skip("cannot create a link here"); }
  const r = archiveItems(ctx, ["link/z.md", "link"]);
  assert.equal(r.archived.length, 0);
  assert.ok(fs.existsSync(path.join(real, "z.md")));
});

test("the archive is invisible to the inbox reader: only top-level *.md files are listed", () => {
  const ctx = inbox({ "a.md": "a", "b.md": "b" });
  archiveItems(ctx, ["a.md"]);
  const listed = fs.readdirSync(ctx.inboxDir).filter((x) => x.toLowerCase().endsWith(".md"));
  assert.deepEqual(listed, ["b.md"]);
});

test("restoring an item whose file vanished reports it and leaves the manifest", () => {
  const ctx = inbox({ "a.md": "a" });
  const { archived } = archiveItems(ctx, ["a.md"], { now: Date.UTC(2026, 3, 1) });
  fs.rmSync(path.join(ctx.inboxDir, ".archive", archived[0].id));
  assert.equal(listArchive(ctx)[0].missing, true);
  const r = restoreItems(ctx, [archived[0].id]);
  assert.equal(r.failed[0].code, "missing");
});
