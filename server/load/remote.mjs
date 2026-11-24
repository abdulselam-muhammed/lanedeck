// Remote machines for the load page (STRICTLY READ-ONLY): ONE ssh call every ~10 s, only while somebody is viewing that machine.
// The remote command is a fixed constant script that only READS (/proc, df, ps, docker ps): no docker exec, no writes, no
// start/stop. A timed-out ssh.exe is ended by tree with `taskkill /T /F /PID <the pid we launched>` - never by name.
import config from "../config.mjs";
import { killTree, safeSpawn } from "../platform.mjs";

const EVERY_MS = 10_000;
const VIEW_WINDOW_MS = 30_000;   // a machine is sampled only if its page asked in the last 30 s
const TIMEOUT_MS = 10_000;
const HISTORY_MS = 30 * 60 * 1000;
const SUSTAIN_MS = 30_000;
const THRESHOLDS = config.machine.remoteThresholds;

const SCRIPT = [
  `echo "UP $(cut -d' ' -f1 /proc/uptime)"`,
  `head -1 /proc/stat`,
  `grep -E '^(MemTotal|MemAvailable):' /proc/meminfo`,
  `echo "LA $(cut -d' ' -f1-3 /proc/loadavg)"`,
  `awk '$3 ~ /^(sd[a-z]+|vd[a-z]+|nvme[0-9]+n[0-9]+)$/ {print "DISK",$3,$13}' /proc/diskstats`,
  `echo "DF $(df -B1 -P / | tail -1)"`,
  `echo "WK"; ps -eo etimes=,comm= | awk '$2=="Runner.Worker"'`,
  `echo "PS"; ps -eo pid,pcpu,pmem,etime,comm --sort=-pcpu | head -16`,
  `echo "DK"; docker ps --format '{{.Names}}|{{.Image}}|{{.Status}}|{{.Label "com.docker.compose.project"}}' 2>/dev/null`,
].join("; ");

function ssh(alias) {
  return new Promise((resolve) => {
    let done = false, timer, c;
    const finish = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
    try { c = safeSpawn("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", alias, SCRIPT], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }, () => finish(null)); } catch { return finish(null); }
    const out = [];
    c.stdout.on("data", (d) => out.push(d));
    c.on("close", (code) => finish(code === 0 ? Buffer.concat(out).toString("utf8") : null));
    timer = setTimeout(() => { killTree(c); finish(null); }, TIMEOUT_MS);
  });
}

export function listMachines() {
  return config.machine.machines.slice(0, 8).map((x) => ({ id: x.id, label: x.label, ssh: x.ssh }));
}

const ageSeconds = (status) => {
  const m = /Up\s+(?:(?:About|Less than)\s+)?(an?|\d+)\s+(second|minute|hour|day|week|month)/i.exec(status || "");
  if (!m) return null;
  return (/^an?$/i.test(m[1]) ? 1 : Number(m[1])) * { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2592000 }[m[2].toLowerCase()];
};
const etimeSeconds = (e) => {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec((e || "").trim());
  return m ? Number(m[1] || 0) * 86400 + Number(m[2] || 0) * 3600 + Number(m[3]) * 60 + Number(m[4]) : null;
};

function parse(text) {
  const r = { disks: {}, procs: [], containers: [], workers: [] };
  let sec = "";
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l) continue;
    if (l === "WK" || l === "PS" || l === "DK") { sec = l; continue; }
    if (l.startsWith("UP ")) r.up = Number(l.slice(3));
    else if (l.startsWith("cpu ")) { const f = l.split(/\s+/).slice(1).map(Number); r.cpuTotal = f.reduce((a, b) => a + b, 0); r.cpuIdle = (f[3] || 0) + (f[4] || 0); }
    else if (l.startsWith("MemTotal:")) r.memTotalKB = Number(l.split(/\s+/)[1]);
    else if (l.startsWith("MemAvailable:")) r.memAvailKB = Number(l.split(/\s+/)[1]);
    else if (l.startsWith("LA ")) r.load = l.slice(3).split(" ").map(Number);
    else if (l.startsWith("DISK ")) { const [, n, ms] = l.split(" "); r.disks[n] = Number(ms); }
    else if (l.startsWith("DF ")) { const f = l.slice(3).split(/\s+/); r.rootTotal = Number(f[1]); r.rootUsed = Number(f[2]); }
    else if (sec === "WK") { const s = Number(l.split(/\s+/)[0]); if (Number.isFinite(s)) r.workers.push(s); }
    else if (sec === "PS" && !l.startsWith("PID")) { const f = l.split(/\s+/); if (f.length >= 5) r.procs.push({ pid: Number(f[0]), cpu: Number(f[1]), mem: Number(f[2]), etime: f[3], ageS: etimeSeconds(f[3]), comm: f.slice(4).join(" ") }); }
    else if (sec === "DK") { const [name, image, status, project] = l.split("|"); if (name) r.containers.push({ name, image, status, project: project || null, ageS: ageSeconds(status) }); }
  }
  return r.up != null && r.cpuTotal != null && r.memTotalKB ? r : null;
}

const procGroup = (p) => {
  if (/^Runner\./.test(p.comm) || p.comm === "dotnet") return "ci";
  if (/^(dockerd|containerd|docker|runc)/.test(p.comm)) return "docker";
  return "other";
};

export function createRemote() {
  const state = new Map(); // id -> { viewedAt, busy, startedAt, prev, history, last, lastSeen, ok }
  const get = (id) => {
    let s = state.get(id);
    if (!s) { s = { viewedAt: 0, busy: false, startedAt: 0, prev: null, history: [], last: null, lastSeen: 0, ok: false }; state.set(id, s); }
    return s;
  };

  async function sample(m) {
    const s = get(m.id);
    if (s.busy) return;
    s.busy = true;
    s.startedAt = Date.now();
    try {
      const out = await ssh(m.ssh);
      const p = out ? parse(out) : null;
      if (!p) { s.ok = false; s.prev = null; return; }
      const now = Date.now();
      const sm = { t: now, cpu: null, ram: 0, disk: null };
      const total = p.memTotalKB / 1024;
      sm.ramTotalMB = Math.round(total);
      sm.ramUsedMB = Math.round(total - (p.memAvailKB ?? 0) / 1024);
      sm.ram = Math.round((sm.ramUsedMB / total) * 100);
      const pv = s.prev;
      if (pv && p.up > pv.up) {
        const dT = p.cpuTotal - pv.cpuTotal;
        if (dT > 0) sm.cpu = Math.min(100, Math.max(0, Math.round((1 - (p.cpuIdle - pv.cpuIdle) / dT) * 100)));
        const dMs = (p.up - pv.up) * 1000;
        let busiest = 0;
        for (const [n, ms] of Object.entries(p.disks)) if (pv.disks[n] != null) busiest = Math.max(busiest, (ms - pv.disks[n]) / dMs);
        sm.disk = Math.min(100, Math.round(busiest * 100));
      }
      s.prev = { up: p.up, cpuTotal: p.cpuTotal, cpuIdle: p.cpuIdle, disks: p.disks };
      s.ok = true; s.lastSeen = now;
      s.last = { p, sample: sm };
      if (sm.cpu != null) {
        s.history.push(sm);
        while (s.history.length && now - s.history[0].t > HISTORY_MS) s.history.shift();
      }
    } finally { s.busy = false; }
  }

  // one timer; machines nobody viewed in the last 30 s are not touched
  setInterval(() => {
    for (const m of listMachines()) {
      const s = get(m.id);
      if (Date.now() - s.viewedAt < VIEW_WINDOW_MS && Date.now() - s.startedAt >= EVERY_MS - 500) sample(m);
    }
  }, 2000).unref?.();

  const sustained = (s, key, limit) => {
    const w = s.history.filter((h) => h.t >= Date.now() - SUSTAIN_MS);
    return w.length >= 3 && w.every((h) => h[key] != null && h[key] >= limit);
  };

  function answer(m, machines) {
    const s = get(m.id);
    s.viewedAt = Date.now();
    // first look: read now, and once more shortly so the CPU / disk deltas exist without waiting 10 s
    if (!s.last && !s.busy && Date.now() - s.startedAt > 3000) sample(m).then(() => { if (s.ok && s.history.length === 0) setTimeout(() => sample(m), 2500).unref?.(); });
    const base = { machine: m.id, machines, kind: "remote", label: m.label, thresholds: THRESHOLDS, reachable: s.ok, lastSeen: s.lastSeen || null, now: Date.now() };
    if (!s.last) return { ...base, ready: false };
    const { p, sample: cur } = s.last;
    const a = [];
    if (cur.ram >= THRESHOLDS.ram) a.push(`RAM ${cur.ram}%`);
    if (sustained(s, "cpu", THRESHOLDS.cpu)) a.push(`CPU ${cur.cpu}%`);
    if (sustained(s, "disk", THRESHOLDS.disk)) a.push(`Disk ${cur.disk}%`);
    const job = p.workers.length > 0;
    const runnerC = p.containers.filter((c) => c.project === "runner" || /runner/i.test(c.name));
    const classify = (c) => (c.project === "runner" || /runner/i.test(c.name) ? "runner" : job && !c.project ? "job" : c.project ? "project" : "other");
    return {
      ...base, ready: true, current: { ...cur, cpu: cur.cpu ?? 0, disk: cur.disk ?? 0 }, cpuKnown: cur.cpu != null,
      history: s.history.map((h) => [h.t, h.cpu, h.ram, h.disk ?? 0]),
      alert: { high: a.length > 0, reasons: a },
      load: p.load ?? null, root: p.rootTotal ? { usedB: p.rootUsed, totalB: p.rootTotal, pct: Math.round((p.rootUsed / p.rootTotal) * 100) } : null,
      procs: p.procs.map((x) => ({ ...x, group: procGroup(x) })),
      containers: p.containers.map((c) => ({ ...c, group: classify(c) })),
      ci: { running: runnerC.length > 0, job, busyFor: job ? Math.min(...p.workers) : null },
    };
  }

  return {
    list: () => listMachines().map(({ id, label }) => ({ id, label })),
    async handle(req, res, url) {
      if (req.method !== "GET" || url.pathname !== "/api/load") return false;
      const id = url.searchParams.get("machine");
      if (!id || id === "local") return false;
      const list = listMachines();
      const m = list.find((x) => x.id === id);
      res.writeHead(m ? 200 : 404, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.end(JSON.stringify(m ? answer(m, list.map(({ id: i, label }) => ({ id: i, label }))) : { error: "unknown machine" }));
      return true;
    },
  };
}
