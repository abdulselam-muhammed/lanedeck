// Platform adapters: ONE place that decides what this OS can do, and the helpers every child process goes through.
// SELAM_DECK_PLATFORM (win32 | linux | darwin) overrides process.platform for tests. SELAM_DECK_POWERSHELL / _WSL /
// _TASKKILL / _DOCKER override the tool paths (point them at a missing binary to test the "not installed" states).
import { execFile, spawn } from "node:child_process";
import os from "node:os";

export const platform = () => process.env.SELAM_DECK_PLATFORM || process.platform;
export const isWin = () => platform() === "win32";
export const PLATFORM_NAMES = { win32: "Windows", linux: "Linux", darwin: "macOS" };
export const platformName = () => PLATFORM_NAMES[platform()] || platform();

export const bin = {
  powershell: () => process.env.SELAM_DECK_POWERSHELL || "powershell.exe",
  wsl: () => process.env.SELAM_DECK_WSL || "wsl.exe",
  taskkill: () => process.env.SELAM_DECK_TASKKILL || "taskkill",
  docker: () => process.env.SELAM_DECK_DOCKER || "docker",
};

/** WSL exists only on Windows: there the local docker is reached through wsl.exe, elsewhere directly. */
export const hasWsl = () => isWin();

/** spawn() that can never take the server down: an 'error' listener (ENOENT is reported asynchronously) is always attached. */
export function safeSpawn(cmd, args, opts, onError) {
  const c = spawn(cmd, args, opts);
  c.on("error", (e) => { try { onError?.(e); } catch { /* listener must not throw */ } });
  return c;
}

/** Ends a child (and on Windows its whole tree). Never throws; a missing taskkill falls back to child.kill(). */
export function killTree(c) {
  if (!c || c.exitCode !== null) return;
  const plain = () => { try { c.kill(isWin() ? undefined : "SIGTERM"); } catch { /* gone */ } };
  if (isWin() && c.pid) {
    try { safeSpawn(bin.taskkill(), ["/T", "/F", "/PID", String(c.pid)], { windowsHide: true, stdio: "ignore" }, plain); return; } catch { /* fall through */ }
  }
  plain();
}

/** Run a file to completion, never through a shell; resolves { code, out } and never throws (missing binary -> code -1, missing: true). */
export function runFile(file, args, { timeout = 8000 } = {}) {
  return new Promise((resolve) => {
    try {
      const c = execFile(file, args, { timeout, windowsHide: true, maxBuffer: 2 << 20 }, (e, out) => resolve({ code: e ? (typeof e.code === "number" ? e.code : -1) : 0, out: String(out || ""), missing: e?.code === "ENOENT" }));
      c.on("error", () => { /* reported through the callback */ });
    } catch { resolve({ code: -1, out: "", missing: true }); }
  });
}

/** What this OS can do, for /api/load and the CI panel. */
export function features() {
  const win = isWin();
  return {
    platform: platform(),
    platformName: platformName(),
    processSampler: win,      // per-process groups (agents, WSL, Chrome) need the PowerShell/CIM sampler
    wsl: win,
    nativeDocker: !win,
    note: win ? null : `Per-process groups are Windows-only; ${platformName()} shows CPU, RAM and disk. The CI runner is read through the native docker CLI.`,
  };
}

/** A CPU / RAM / disk sampler built on Node's os module + `df`: the non-Windows replacement for sampler.ps1. */
export function createNodeSampler({ intervalMs = 5000, onSample, onError }) {
  let prev = os.cpus();
  let timer = null;
  const cpuPct = () => {
    const now = os.cpus();
    let idle = 0, total = 0;
    for (let i = 0; i < now.length; i++) {
      const a = prev[i]?.times, b = now[i].times;
      if (!a) continue;
      const di = b.idle - a.idle;
      const dt = b.user + b.nice + b.sys + b.idle + b.irq - (a.user + a.nice + a.sys + a.idle + a.irq);
      idle += di; total += dt;
    }
    prev = now;
    return total > 0 ? Math.max(0, Math.min(100, (1 - idle / total) * 100)) : 0;
  };
  const tick = async () => {
    try {
      const df = await runFile("df", ["-Pk", "/"], { timeout: 4000 });
      let disk = 0;
      const m = /(\d+)%/.exec(df.out.split("\n")[1] || "");
      if (m) disk = Number(m[1]);
      onSample({ t: Math.floor(Date.now() / 1000), cpu: cpuPct(), ramTotalMB: Math.round(os.totalmem() / 1048576), ramFreeMB: Math.round(os.freemem() / 1048576), disk, procs: [] });
    } catch (e) { onError?.(e); }
  };
  tick();
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}
