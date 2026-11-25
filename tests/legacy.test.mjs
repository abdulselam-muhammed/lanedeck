// Legacy fallbacks: the pre-rename config folder and project protocol folder are still read while the new ones do not exist.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ld-legacy-"));
process.on("exit", () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } });
delete process.env.LANEDECK_CONFIG;
process.env.XDG_CONFIG_HOME = tmp; process.env.APPDATA = tmp;
const { defaultConfigPath } = await import("../server/config.mjs");
const { protocolDirName } = await import("../server/protocol.mjs");

test("the old config folder is used only while the new one is missing", () => {
  fs.mkdirSync(path.join(tmp, "selam-deck"));
  assert.equal(defaultConfigPath(), path.join(tmp, "selam-deck", "config.json"));
  fs.mkdirSync(path.join(tmp, "lanedeck"));
  assert.equal(defaultConfigPath(), path.join(tmp, "lanedeck", "config.json"));
});

test("the old protocol folder is used only while the new one is missing", () => {
  const repo = fs.mkdtempSync(path.join(tmp, "repo-"));
  assert.equal(protocolDirName(repo), ".lanedeck");
  fs.mkdirSync(path.join(repo, ".selam-deck"));
  assert.equal(protocolDirName(repo), ".selam-deck");
  fs.mkdirSync(path.join(repo, ".lanedeck"));
  assert.equal(protocolDirName(repo), ".lanedeck");
});
