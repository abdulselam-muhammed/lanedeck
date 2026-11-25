// Machine-load monitor (READ-ONLY): samples this PC every ~5 s through ONE long-lived BelowNormal PowerShell
// (sampler.ps1, CIM counters only) and, every 30 s, asks docker inside WSL what is running (`docker ps`, `docker top`
// of the CI runner container). It never kills or changes any process, container or runner. A timed-out wsl.exe is
// ended by tree with `taskkill /T /F /PID <the pid we launched>` - never by name.
//   GET /api/load   { current, history[~30 min], alert, groups, docker, ... }  (cached; the sampler runs once)
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import config from "../config.mjs";
import { usage as githubUsage } from "../budget.mjs";
import { bin, createNodeSampler, features, hasWsl, isWin, killTree, safeSpawn } from "../platform.mjs";
import { ts } from "../i18n/server.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DISTRO = config.machine.wslDistro;
const CI_CONTAINER = config.machine.ciContainer;
const HISTORY_MS = 30 * 60 * 1000;
const DOCKER_EVERY_MS = 30_000;
const SUSTAIN_MS = 30_000;
// Alert thresholds (the banner is shown when any holds): RAM is immediate; CPU and Disk must hold for 30 s.
export const THRESHOLDS = config.machine.thresholds;
// ETA assumptions (approximate, deliberately simple): typical durations, in seconds.
const TYPICAL = { e2e: 8 * 60, tool: 4 * 60 };
const TOOL_RE = /\b(jest|tsc|eslint|vitest|knip|pnpm|nest|next)\b/i;

function run(cmd, args, timeout) {
  return new Promise((resolve) => {
    let done = false, timer = null, c;
    const finish = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
    try { c = safeSpawn(cmd, args, { windowsHide: true, env: { ...process.env, WSL_UTF8: "1" } }, () => finish({ code: -1, out: "", missing: true })); } catch { return finish({ code: -1, out: "" }); }
    const out = [];
    c.stdout.on("data", (d) => out.push(d));
        c.on("close", (code) => finish({ code, out: Buffer.concat(out).toString("utf8").replace(/\u0000/g, "") }));
    timer = setTimeout(() => { killTree(c); finish({ code: -2, out: "" }); }, timeout);
  });
}

/** "Up 3 minutes" / "Up About an hour" / "Up 26 hours" -> seconds (null when unknown). */
function ageSeconds(status) {
  const m = /Up\s+(?:(?:About|Less than)\s+)?(an?|\d+)\s+(second|minute|hour|day|week|month)/i.exec(status || "");
  if (!m) return null;
  const n = /^an?$/i.test(m[1]) ? 1 : Number(m[1]);
  return n * { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2592000 }[m[2].toLowerCase()];
}
const etimeSeconds = (e) => {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec((e || "").trim());
  return m ? Number(m[1] || 0) * 86400 + Number(m[2] || 0) * 3600 + Number(m[3]) * 60 + Number(m[4]) : null;
};
const isAgentGroup = (k) => k.startsWith("node:agent-") || k.startsWith("node:wt-");

export function createLoad(opts = {}) {
  let prevCpu = new Map();    // pid -> cpu ms at the previous sample
  let prevT = 0;
  const history = [];         // { t, cpu, ram, disk }
  let view = null;            // { sample, groups, nodeCount, nodes }
  let docker = { at: 0, ok: false, stale: false, containers: [], ci: { running: false, job: false, busyFor: null } };
  let lastKernel = null;
  let child = null, buf = "", restarts = 0, stopped = false, nodeSampler = null;
  // Why a feature is off (shown on the load page instead of crashing or staying blank).
  const status = { sampler: { ok: false, reason: "starting" }, docker: { ok: false, reason: "starting" } };

  function startSampler() {
    if (stopped) return;
    if (!isWin()) {
      // Linux / macOS: Node's os module + df; no per-process groups.
      status.sampler = { ok: true, reason: null };
      nodeSampler = createNodeSampler({ onSample, onError: (e) => { status.sampler = { ok: false, reason: String(e.message || e) }; } });
      return;
    }
    buf = "";
    let missing = false;
    try {
      child = safeSpawn(bin.powershell(), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(HERE, "sampler.ps1"), "-Interval", "5"], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }, (e) => {
        if (e.code === "ENOENT") missing = true;
        status.sampler = { ok: false, reason: e.code === "ENOENT" ? `${bin.powershell()} not found: the machine load sampler is off` : `sampler failed: ${e.message}` };
      });
    } catch { status.sampler = { ok: false, reason: "cannot start the sampler" }; setTimeout(startSampler, 15000).unref?.(); return; }
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line.startsWith("{")) { try { status.sampler = { ok: true, reason: null }; onSample(JSON.parse(line)); } catch { /* partial line */ } }
      }
    });
    child.on("close", () => { child = null; if (!stopped && !missing) setTimeout(startSampler, Math.min(60000, 3000 * ++restarts)).unref?.(); });
  }

  function groupOf(p) {
    const n = p.n.toLowerCase();
    if (n === "node.exe") {
      const cmd = p.cmd || "";
      const wt = /[\\/]worktrees[\\/](agent-[^\\/\s"']+)/i.exec(cmd) || /[\\/]infra[\\/](wt-[^\\/\s"']+)/i.exec(cmd);
      if (wt) return { key: "node:" + wt[1], label: "node — " + wt[1], kind: "node" };
      if (/lanedeck|agents-inbox-viewer|viewer-phase/i.test(cmd)) return { key: "node:viewer", label: "node — this deck", kind: "other" };
      return { key: "node:other", label: ts("load.srv.nodeOther"), kind: "node" };
    }
    if (n.startsWith("vmmem")) return { key: "wsl", label: "WSL (" + p.n + ")", kind: "wsl" };
    if (n === "chrome.exe") return { key: "chrome", label: "Chrome", kind: "chrome" };
    if (n === "claude.exe") return { key: "claude", label: ts("load.srv.claude"), kind: "claude" };
    return { key: "o:" + n, label: p.n, kind: "other" };
  }

  function onSample(s) {
    const dt = prevT ? Math.max(1, s.t - prevT) : 0;
    const total = s.ramTotalMB || 1;
    const sample = {
      t: s.t * 1000,
      cpu: Math.min(100, Math.round(s.cpu ?? 0)),
      ram: Math.round(((total - s.ramFreeMB) / total) * 100),
      ramUsedMB: total - s.ramFreeMB, ramTotalMB: total,
      disk: Math.min(100, Math.round(s.disk ?? 0)),
    };
    history.push(sample);
    while (history.length && sample.t - history[0].t > HISTORY_MS) history.shift();

    const nowCpu = new Map();
    const groups = new Map();
    const nodes = [];
    for (const p of s.procs || []) {
      nowCpu.set(p.pid, p.c);
      const was = prevCpu.get(p.pid);
      const cores = was != null && dt ? Math.max(0, (p.c - was) / 1000 / dt) : 0; // cores busy since the last sample
      const g = groupOf(p);
      const e = groups.get(g.key) || { ...g, count: 0, memMB: 0, cores: 0, oldest: 0, tools: [] };
      e.count++; e.memMB += p.m; e.cores += cores;
      const age = p.s ? s.t - p.s : 0;
      if (age > e.oldest) e.oldest = age;
      if (p.n === "node.exe") {
        const tool = TOOL_RE.exec(p.cmd || "")?.[1]?.toLowerCase() || null;
        if (tool && g.key !== "node:viewer" && !e.tools.includes(tool)) e.tools.push(tool);
        nodes.push({ g: g.key, age, tool: g.key === "node:viewer" ? null : tool, busy: cores >= 0.05 });
      }
      groups.set(g.key, e);
    }
    prevCpu = nowCpu;
    prevT = s.t;
    const list = [...groups.values()]
      .map((g) => ({ key: g.key, label: g.label, kind: g.kind, count: g.count, memMB: Math.round(g.memMB), cores: +g.cores.toFixed(2), tools: g.tools, ageS: g.oldest }))
      .sort((a, b) => b.memMB - a.memMB)
      .slice(0, 25);
    if (s.kernel) lastKernel = { pagedMB: s.kernel.pagedMB, nonpagedMB: s.kernel.nonpagedMB, uptimeS: s.kernel.uptimeS, at: s.t * 1000 };
    const kernel = lastKernel ? { ...lastKernel, procsWsMB: Math.round(s.procsWsMB ?? 0) } : null;
    view = { sample, groups: list, nodeCount: nodes.length, nodes, kernel };
  }

  // ---- docker inside WSL, every 30 s (one wsl.exe call, killed by tree on timeout) ----
  let dockerBusy = false;
  async function sampleDocker() {
    if (dockerBusy || stopped) return;
    if (hasWsl() && !DISTRO) { status.docker = { ok: false, reason: "no WSL distro configured (machine.wslDistro)" }; return; }
    dockerBusy = true;
    try {
      const script = `docker ps --format '{{.Names}}|{{.Image}}|{{.Status}}|{{.Label "com.docker.compose.project"}}'; echo ---; ${CI_CONTAINER ? `docker top ${CI_CONTAINER} -eo pid,etime,args 2>/dev/null | head -60` : "true"}`;
      let r;
      if (hasWsl()) r = await run(bin.wsl(), ["-d", DISTRO, "-u", "root", "--", "sh", "-c", script], 25000);
      else {
        // Native docker: two direct calls (a missing docker CLI must show as such, not as an empty list).
        const ps = await run(bin.docker(), ["ps", "--format", "{{.Names}}|{{.Image}}|{{.Status}}|{{.Label \"com.docker.compose.project\"}}"], 25000);
        const top = ps.code === 0 && CI_CONTAINER ? await run(bin.docker(), ["top", CI_CONTAINER, "-eo", "pid,etime,args"], 25000) : { out: "" };
        r = ps.code === 0 ? { code: 0, out: `${ps.out}\n---\n${top.out.split(/\r?\n/).slice(0, 60).join("\n")}` } : ps;
      }
      if (r.code !== 0 || !r.out.includes("---")) {
        docker = { ...docker, stale: true };
        status.docker = { ok: false, reason: r.missing || (!hasWsl() && r.code === -1) ? `${hasWsl() ? bin.wsl() : bin.docker()} not found: the docker part is off` : !hasWsl() ? "docker is installed but not answering (is the daemon running?)" : "docker did not answer; showing the last reading" };
        return;
      }
      status.docker = { ok: true, reason: null };
      const [a, b = ""] = r.out.split(/^---\r?$/m);
      const containers = a.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
        const [name, image, status, project] = l.split("|");
        return { name, image, status, project: project || null, ageS: ageSeconds(status) };
      });
      const ages = b.split(/\r?\n/).filter((l) => /Runner\.Worker/.test(l)).map((l) => etimeSeconds(l.trim().split(/\s+/)[1]));
      const job = ages.length > 0;
      const busyFor = job ? Math.min(...ages.filter((x) => x != null)) : null;
      docker = { at: Date.now(), ok: true, stale: false, containers, ci: { running: !!CI_CONTAINER && containers.some((c) => c.name === CI_CONTAINER), job, busyFor: Number.isFinite(busyFor) ? busyFor : null } };
    } finally { dockerBusy = false; }
  }

  const sustained = (key, limit) => {
    const from = Date.now() - SUSTAIN_MS;
    const w = history.filter((h) => h.t >= from);
    return w.length >= 3 && w.every((h) => h[key] >= limit);
  };

  // alert + cause + ETA, rebuilt on demand from the last sample
  function analyse() {
    const s = view.sample;
    const reasons = [];
    if (s.ram >= THRESHOLDS.ram) reasons.push(`RAM ${s.ram}%`);
    if (sustained("cpu", THRESHOLDS.cpu)) reasons.push(`CPU ${s.cpu}%`);
    if (sustained("disk", THRESHOLDS.disk)) reasons.push(`Disk ${s.disk}%`);
    const pagedGB = view.kernel ? view.kernel.pagedMB / 1024 : 0;
    const leak = pagedGB >= THRESHOLDS.pagedPoolGB;
    if (leak) reasons.push(`Paged pool ${pagedGB.toFixed(1)}GB`);
    const wsl = view.groups.find((g) => g.kind === "wsl");
    const e2e = docker.containers.filter((c) => c.project && c.project !== "runner");
    const projects = [...new Set(e2e.map((c) => c.project))];
    const agents = new Set(view.nodes.filter((n) => isAgentGroup(n.g)).map((n) => n.g));
    const activeAgents = new Set(view.nodes.filter((n) => n.busy && isAgentGroup(n.g)).map((n) => n.g));
    const tools = [...new Set(view.nodes.filter((n) => n.tool).map((n) => n.tool))];
    const parts = [];
    if (leak) parts.push(ts("load.srv.leak", { gb: pagedGB.toFixed(1) }));
    if (agents.size) parts.push(ts("load.srv.agents", { n: agents.size, tools: tools.length ? tools.slice(0, 3).join("/") : "node" }));
    if (projects.length) parts.push(`Docker e2e (${projects.length} stack${wsl ? ", WSL " + (wsl.memMB / 1024).toFixed(1) + "GB" : ""})`);
    else if (wsl && wsl.memMB > 3072) parts.push(`WSL ${(wsl.memMB / 1024).toFixed(1)}GB`);
    if (docker.ci.job) parts.push(ts("load.srv.ciJob"));
    const chrome = view.groups.find((g) => g.kind === "chrome");
    if (!parts.length && chrome && chrome.memMB > 2048) parts.push(`Chrome ${(chrome.memMB / 1024).toFixed(1)}GB`);

    // ETA: the longest remaining time of the parts we can reason about. APPROXIMATE, always labelled so.
    const rem = [];
    for (const c of e2e) if (c.ageS != null) rem.push({ s: Math.max(90, TYPICAL.e2e - c.ageS), why: `e2e ${c.project}` });
    // only finite jobs count (not dev servers / wrappers), and a process older than 30 min is a daemon, not a run
    const busyTools = view.nodes.filter((n) => n.busy && /^(jest|tsc|eslint|vitest|knip)$/.test(n.tool || "") && n.age < 1800);
    if (busyTools.length) rem.push({ s: Math.max(60, TYPICAL.tool - Math.max(...busyTools.map((n) => n.age))), why: ts("load.srv.procs", { n: busyTools.length, tools: [...new Set(busyTools.map((n) => n.tool))].slice(0, 2).join("/") }) });
    let eta = { minutes: null, why: ts("load.srv.noBasis") };
    if (rem.length) {
      const m = rem.reduce((a, b) => (b.s > a.s ? b : a));
      eta = { minutes: Math.max(1, Math.round(m.s / 60)), why: m.why };
    } else if (activeAgents.size) eta = { minutes: null, why: ts("load.srv.agentsNoTests", { n: activeAgents.size }) };
    if (leak) eta = { minutes: null, why: ts("load.srv.untilRestart"), untilRestart: true };
    return { high: reasons.length > 0, reasons, cause: parts.join(" + ") || ts("load.srv.unclear"), eta: { ...eta, approximate: true }, agents: agents.size, active: activeAgents.size };
  }

  const answer = () => {
    if (!view) return { ready: false, features: features(), status, github: githubUsage(), machine: "local", machines: opts.machines?.() ?? [], thresholds: THRESHOLDS };
    const a = analyse();
    return {
      ready: true, machine: "local", machines: opts.machines?.() ?? [], now: Date.now(), thresholds: THRESHOLDS, current: view.sample,
      history: history.map((h) => [h.t, h.cpu, h.ram, h.disk]),
      alert: { high: a.high, reasons: a.reasons, cause: a.cause, eta: a.eta },
      agents: { worktrees: a.agents, active: a.active },
      nodeCount: view.nodeCount, groups: view.groups, kernel: view.kernel,
      features: features(), status, github: githubUsage(),
      docker: { ...docker, containers: docker.containers.map((c) => ({ ...c, e2e: !!c.project && c.project !== "runner" })) },
      typical: TYPICAL,
    };
  };

  startSampler();
  sampleDocker();
  const timer = setInterval(sampleDocker, DOCKER_EVERY_MS);
  timer.unref?.();
  process.on("exit", () => { stopped = true; clearInterval(timer); nodeSampler?.stop(); killTree(child); });

  return {
    async handle(req, res, url) {
      if (req.method !== "GET" || url.pathname !== "/api/load") return false;
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.end(JSON.stringify(answer()));
      return true;
    },
  };
}
