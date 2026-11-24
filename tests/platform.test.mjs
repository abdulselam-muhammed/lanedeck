import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { bin, features, hasWsl, isWin, killTree, platform, runFile, safeSpawn } from "../server/platform.mjs";

const withEnv = (k, v, fn) => { const old = process.env[k]; process.env[k] = v; try { return fn(); } finally { if (old === undefined) delete process.env[k]; else process.env[k] = old; } };
const MISSING = "selam-deck-no-such-binary-xyz";

test("SELAM_DECK_PLATFORM overrides the platform checks", () => {
  withEnv("SELAM_DECK_PLATFORM", "linux", () => {
    assert.equal(platform(), "linux");
    assert.equal(isWin(), false);
    assert.equal(hasWsl(), false);
    const f = features();
    assert.equal(f.processSampler, false);
    assert.equal(f.nativeDocker, true);
    assert.match(f.note, /Linux/);
  });
  withEnv("SELAM_DECK_PLATFORM", "win32", () => {
    assert.equal(isWin(), true);
    assert.equal(features().note, null);
  });
});

test("tool paths can be pointed at a missing binary", () => {
  withEnv("SELAM_DECK_POWERSHELL", MISSING, () => assert.equal(bin.powershell(), MISSING));
});

test("safeSpawn of a missing binary reports through the callback and does not throw or crash", async () => {
  const err = await new Promise((res) => safeSpawn(MISSING, [], {}, res));
  assert.equal(err.code, "ENOENT");
});

test("a bare spawn would crash, safeSpawn does not (the process stays alive)", async () => {
  const c = safeSpawn(MISSING, [], {});
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(c.pid, undefined);
});

test("runFile resolves with missing: true for a missing binary", async () => {
  const r = await runFile(MISSING, []);
  assert.equal(r.code, -1);
  assert.equal(r.missing, true);
});

test("killTree ends a child with a missing taskkill (win32) and with plain kill (linux)", async () => {
  for (const [plat, extra] of [["win32", { SELAM_DECK_TASKKILL: MISSING }], ["linux", {}]]) {
    const old = { ...process.env };
    process.env.SELAM_DECK_PLATFORM = plat; Object.assign(process.env, extra);
    try {
      const c = spawn(process.execPath, ["-e", "setTimeout(()=>{},60000)"], { stdio: "ignore" });
      await new Promise((r) => setTimeout(r, 150));
      const closed = new Promise((r) => c.on("close", r));
      killTree(c);
      await Promise.race([closed, new Promise((_, rej) => setTimeout(() => rej(new Error(`child not ended on ${plat}`)), 5000))]);
    } finally { for (const k of Object.keys(process.env)) if (!(k in old)) delete process.env[k]; Object.assign(process.env, old); }
  }
});

test("killTree on a null / finished child is a no-op", () => {
  killTree(null);
  killTree({ exitCode: 0 });
});
