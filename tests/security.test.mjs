// Security tests: the central Host / Origin guard (issue #10) and path safety for the project folder (issue #11).
//   node --test tests/
// On Windows a directory symlink is created as a junction (no admin rights needed); file symlinks need Developer Mode, so the
// file-symlink cases are skipped when the OS refuses to create one.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sd-sec-"));
const cfg = path.join(tmp, "config.json");
fs.writeFileSync(cfg, "{}");
process.env.LANEDECK_CONFIG = cfg;

const { createGuard } = await import("../server/guard.mjs");
const { safePath, realRoot, readPlainAsync } = await import("../server/safepath.mjs");
const { doSetup, addInstructions, setupStatus, archiveSetupFile } = await import("../server/setup.mjs");
const { readProtocol } = await import("../server/protocol.mjs");

process.on("exit", () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } });

/** A fresh repo folder and a folder outside it, per test. */
function layout(name) {
  const base = path.join(tmp, name);
  const repo = path.join(base, "repo"), outside = path.join(base, "outside");
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  return { repo, outside };
}
const dirLink = (target, p) => fs.symlinkSync(target, p, process.platform === "win32" ? "junction" : "dir");
function fileLink(target, p) {
  try { fs.symlinkSync(target, p, "file"); return true; } catch { return false; }
}
const ls = (d) => fs.readdirSync(d).sort();

// ---------- #10: the guard ----------
const req = (headers) => ({ headers, socket: { remoteAddress: "127.0.0.1" } });
// remote-token checks are in remote-token.test.mjs; here remote access is open so only the Host / Origin rules are tested
const g = createGuard({ port: 4998, allowedHosts: ["tunnel.example"], auth: () => ({ token: null, allowUnauthenticatedRemote: true }) });

test("guard: loopback hosts and allowedHosts pass", () => {
  for (const host of ["127.0.0.1:4998", "localhost:4998", "[::1]:4998", "tunnel.example", "LOCALHOST:4998"]) assert.equal(g.check(req({ host })), null, host);
  assert.equal(g.check(req({ host: "localhost:4998", origin: "http://localhost:4998", "sec-fetch-site": "same-origin" })), null);
});

test("guard: forged Host, wrong port, missing Host are refused with 403", () => {
  for (const host of ["evil.example:4998", "evil.example", "127.0.0.1:4999", "localhost", undefined]) assert.equal(g.check(req({ host }))?.[0], 403, String(host));
});

test("guard: a foreign or null Origin is refused", () => {
  for (const origin of ["http://evil.example", "null", "http://localhost:4999", "file://"]) assert.equal(g.check(req({ host: "localhost:4998", origin }))?.[0], 403, origin);
});

test("guard: cross-site /api requests are refused, cross-site page navigations are not", () => {
  assert.equal(g.check(req({ host: "localhost:4998", "sec-fetch-site": "cross-site" }), true)?.[0], 403);
  assert.equal(g.check(req({ host: "localhost:4998", "sec-fetch-site": "same-site" }), true)?.[0], 403);
  assert.equal(g.check(req({ host: "localhost:4998", "sec-fetch-site": "cross-site" }), false), null);
});

// ---------- #11: path safety ----------
test("safePath: a junction / symlinked folder escaping repoPath is refused", () => {
  const { repo, outside } = layout("escape");
  dirLink(outside, path.join(repo, "link"));
  const root = realRoot(repo);
  assert.throws(() => safePath(root, ["link", "x.md"]), /symlink or junction/);
  assert.throws(() => safePath(root, [".."]), /bad path component/);
  assert.equal(safePath(root, ["plain", "new.md"]), path.join(root, "plain", "new.md"));
});

test("doSetup: a junctioned .lanedeck writes nothing outside", () => {
  const { repo, outside } = layout("deck-link");
  dirLink(outside, path.join(repo, ".lanedeck"));
  assert.throws(() => doSetup(repo, "en"), /symlink or junction/);
  assert.deepEqual(ls(outside), []);
});

test("doSetup: a junctioned .lanedeck/inbox writes nothing outside", () => {
  const { repo, outside } = layout("inbox-link");
  fs.mkdirSync(path.join(repo, ".lanedeck"));
  dirLink(outside, path.join(repo, ".lanedeck", "inbox"));
  assert.throws(() => doSetup(repo, "en"), /symlink or junction/);
  assert.deepEqual(ls(outside), []);
  assert.ok(setupStatus(repo, "en").unsafe);
});

test("archiveSetupFile: a junctioned _archive is not written to, and the setup file stays", () => {
  const { repo, outside } = layout("archive-link");
  const inbox = path.join(repo, ".lanedeck", "inbox");
  fs.mkdirSync(inbox, { recursive: true });
  fs.writeFileSync(path.join(inbox, "00-setup.md"), "## Steps\n- [x] one\n");
  dirLink(outside, path.join(inbox, "_archive"));
  assert.equal(archiveSetupFile(inbox, repo), false);
  assert.deepEqual(ls(outside), []);
  assert.ok(fs.existsSync(path.join(inbox, "00-setup.md")));
});

test("doSetup + archive: the normal case still works", () => {
  const { repo } = layout("normal");
  const out = doSetup(repo, "en");
  assert.deepEqual(out.created, [".lanedeck/PROTOCOL.md", ".lanedeck/inbox/00-setup.md"]);
  assert.equal(out.gitignore, "added");
  assert.equal(doSetup(repo, "en").gitignore, "present");
  assert.deepEqual(addInstructions(repo, ["AGENTS.md"], { create: true }).created, ["AGENTS.md"]);
  assert.deepEqual(addInstructions(repo, ["AGENTS.md"]).already, ["AGENTS.md"]);
  const inbox = path.join(repo, ".lanedeck", "inbox");
  assert.equal(archiveSetupFile(inbox, repo), true);
  assert.ok(fs.existsSync(path.join(inbox, "_archive", "00-setup.md")));
});

test("addInstructions / .gitignore: a file symlink pointing outside is never appended to", (t) => {
  const { repo, outside } = layout("file-link");
  const victim = path.join(outside, "victim.txt");
  fs.writeFileSync(victim, "keep\n");
  if (!fileLink(victim, path.join(repo, "CLAUDE.md")) || !fileLink(victim, path.join(repo, ".gitignore"))) return t.skip("file symlinks need Developer Mode on Windows");
  assert.throws(() => addInstructions(repo, ["CLAUDE.md"]), /symlink/);
  assert.throws(() => doSetup(repo, "en"), /symlink/);
  assert.equal(fs.readFileSync(victim, "utf8"), "keep\n");
  const st = setupStatus(repo, "en");
  assert.equal(st.instructions.find((x) => x.name === "CLAUDE.md").symlink, true);
  assert.equal(st.gitignore.exists, false);
});

test("readProtocol: a junctioned .lanedeck is not read and is warned about", async () => {
  const { repo, outside } = layout("read-deck");
  fs.writeFileSync(path.join(outside, "project.md"), "SECRET");
  dirLink(outside, path.join(repo, ".lanedeck"));
  const p = await readProtocol(path.join(repo, ".lanedeck"), []);
  assert.equal(p.project, null);
  assert.ok(p.warnings.some((w) => /\.lanedeck is a symlink/.test(w)));
});

test("readProtocol / readPlainAsync: a symlinked project.md is skipped with a warning", async (t) => {
  const { repo, outside } = layout("read-file");
  const secret = path.join(outside, "secret.md");
  fs.writeFileSync(secret, "SECRET");
  const dir = path.join(repo, ".lanedeck");
  fs.mkdirSync(dir);
  if (!fileLink(secret, path.join(dir, "project.md"))) return t.skip("file symlinks need Developer Mode on Windows");
  assert.equal(await readPlainAsync(path.join(dir, "project.md")), null);
  const p = await readProtocol(dir, [], ["notes.md"]);
  assert.equal(p.project, null);
  assert.ok(p.warnings.includes("project.md is a symlink or junction: not read"));
  assert.ok(p.warnings.includes("inbox/notes.md is a symlink or junction: not read"));
});
