// Project profiles load from <config folder>/profiles/<name>/profile.json (the user's own), not from the repository.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sd-prof-"));
process.on("exit", () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } });
fs.mkdirSync(path.join(tmp, "profiles", "demo"), { recursive: true });
fs.writeFileSync(path.join(tmp, "profiles", "demo", "profile.json"), JSON.stringify({ name: "demo", text: { "who.reviewer": "With the lead" } }));
fs.writeFileSync(path.join(tmp, "config.json"), JSON.stringify({ projects: [{ id: "p", name: "P", profile: "demo" }, { id: "q", name: "Q", profile: "nope" }, { id: "r", name: "R" }] }));
process.env.LANEDECK_CONFIG = path.join(tmp, "config.json");

const { loadProfile, projectById, profileDirs } = await import("../server/config.mjs");

test("a profile is read from the config folder", () => {
  assert.equal(profileDirs()[0], path.join(tmp, "profiles"));
  assert.equal(loadProfile(projectById("p")).text["who.reviewer"], "With the lead");
});
test("a missing profile or none gives null", () => {
  assert.equal(loadProfile(projectById("q")), null);
  assert.equal(loadProfile(projectById("r")), null);
});
