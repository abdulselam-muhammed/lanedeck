// The REAL org runners on OUR machines and every job of the org - READ-ONLY. "Our machines" = this PC (the WSL2
// the configured WSL distro, myoung34/github-runner containers) plus every remote machine listed in
// the config (read over SSH, see below). Each machine has its own reader, state and status line: a dead SSH never
// touches the local group, and the other way round.
//
// Nothing here starts, stops or changes a runner, a container, WSL or Docker, and it never boots the
// distro: it only looks inside when `wsl -l -v` already reports it Running. Every one-shot wsl.exe / ssh.exe / gh
// call has a timeout (wsl.exe can hang). A machine is read through a "transport": local = `wsl.exe -d <distro> -u root --
// docker ...`, remote = `ssh -o BatchMode=yes -o ConnectTimeout=8 -o ServerAliveInterval=15 <alias> docker ...`. Over
// either one ONLY `docker ps`, `docker inspect` (RUNNER_NAME / LABELS from env), `docker stats --no-stream` and
// `docker logs` are ever run - never a write. Remote machines come from the config (machine.machines). GitHub is read with `gh api` (GET only) and ETags, so unchanged
// answers (304) cost no rate limit.
//
// Two sources, one truth (the JobStore in store.mjs):
//  - The runner itself: ONE long-lived `docker logs -f` per runner container (restart with backoff).
//    Its own lines "Running job: <name>" / "Job <name> completed with result: <r>" flip busy/idle
//    within a second; the GitHub job record is attached after.
//  - GitHub: run lists (in_progress/queued every 30 s, completed every 2 min) feed the store; every
//    queued/in_progress job in the store is re-checked by id (GET /actions/jobs/<id>, ETag) every
//    10 s, and a run that leaves the active lists is fetched once to settle its jobs. A run's
//    `updated_at` is NOT used as a gate: GitHub does not bump it while the run's jobs start and finish.
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { scrub } from './scrub.mjs';
import { JobStore, readJson, writeJson, lean } from './store.mjs';

import config from '../config.mjs';
import { spend, refund } from '../budget.mjs';
import { bin, hasWsl, killTree, platformName, safeSpawn } from '../platform.mjs';

export const GH = config.tools.gh;

const DISTRO = config.machine.wslDistro;
const LOCAL_ID = 'local';
const LOCAL_LABEL = config.machine.localLabel;
const MACHINE_ID = /^[\w-]{1,24}$/;
const SSH_ALIAS = /^[\w][\w.@-]{0,63}$/;   // an OpenSSH config alias / host: never starts with "-", so it cannot become an ssh option
const SSH_OPTS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'ServerAliveInterval=15'];
const shq = (a) => "'" + String(a).replace(/'/g, "'\\''") + "'"; // ssh joins its arguments into ONE remote shell line, so each one is quoted
const ORG = config.github.org;
const REPOS_TTL_MS = 6 * 3600 * 1000;
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
const RUNNER_IMAGE = new RegExp(config.machine.runnerImage, 'i');
const TEAM_NAME = config.machine.teamName ? new RegExp(config.machine.teamName, 'i') : /$^/;   // the team runners of the remote machines (the image test already matches them; the name is the fallback)
const RUNNER_NAME = config.machine.runnerName ? new RegExp(config.machine.runnerName, 'i') : /$^/; // optional: runners recognised by container name (the image test is the default)
const CONTAINER_RE = /^[\w.-]+$/;
const BUDGET = config.github.rateBudgetPerHour;                 // billed (non-304) GitHub requests per hour we aim to stay under
const MIN_RATE = 400;               // below this remaining rate limit only this machine's jobs are followed
const CPU_BUSY = 80;                // % CPU of the runner container that means "something is running"
const GH_PARALLEL = 4;
// Pace levels 0..4 by billed requests per hour (4 = rate limit low).
const PACE = {
  jobStride: [1, 2, 3, 6, Infinity],              // other machines' active jobs: every N x 10 s
  activeMs: [30e3, 30e3, 60e3, 90e3, 120e3],      // in_progress / queued run lists
  completedMs: [120e3, 120e3, 240e3, 480e3, Infinity],
  runJobsMs: [60e3, 120e3, 180e3, 300e3, 600e3],  // re-list the jobs of an active run (jobs waiting on `needs` appear later)
};

function run(cmd, args, { timeout = 20000 } = {}) {
  return new Promise((resolve) => {
    let done = false, timer = null;
    const finish = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
    let c;
    try { c = safeSpawn(cmd, args, { windowsHide: true, env: { ...process.env, WSL_UTF8: '1' } }, (e) => finish({ code: -1, out: '', err: String(e), missing: e.code === 'ENOENT' })); } catch (e) { finish({ code: -1, out: '', err: String(e) }); return; }
    const out = [], err = [];
    c.stdout.on('data', (d) => out.push(d));
    c.stderr.on('data', (d) => err.push(d));
    c.on('close', (code) => {
      const o = Buffer.concat(out);
      // wsl.exe -l prints UTF-16LE on some builds even with WSL_UTF8.
      const s = o.length > 1 && o[1] === 0 ? o.toString('utf16le') : o.toString('utf8');
      finish({ code, out: s.replace(/\u0000/g, ''), err: Buffer.concat(err).toString('utf8') });
    });
    // A hung call is killed AND answered: the caller never waits past the timeout.
    timer = setTimeout(() => { killTree(c); finish({ code: -2, out: '', err: `timeout after ${timeout} ms` }); }, timeout);
  });
}

/** The machines of "Our machines": this PC first, then every valid entry of machines.json ({id, label?, ssh}). */
function loadMachines() {
  const out = [{ id: LOCAL_ID, label: LOCAL_LABEL, kind: 'local', ssh: null }];
  for (const x of config.machine.machines) {
    if (out.some((m) => m.id === x.id)) continue;
    out.push({ id: x.id, label: x.label, kind: 'ssh', ssh: x.ssh });
    if (out.length >= 9) break;
  }
  return out;
}

/** How a docker command is run on a machine: the command + argv to spawn (one-shot or long-lived). */
function transport(m) {
  if (m.kind === 'local') {
    // Windows: docker inside WSL. Linux / macOS: the native docker CLI (args[0] is 'docker').
    if (hasWsl()) return (args) => [bin.wsl(), ['-d', DISTRO, '-u', 'root', '--', ...args]];
    return (args) => [args[0] === 'docker' ? bin.docker() : args[0], args.slice(1)];
  }
  return (args) => ['ssh', [...SSH_OPTS, m.ssh, ...args.map(shq)]];
}

class Limiter {
  constructor(n) { this.n = n; this.q = []; this.busy = 0; }
  run(fn) { return new Promise((res, rej) => { this.q.push([fn, res, rej]); this.next(); }); }
  next() {
    while (this.busy < this.n && this.q.length) {
      const [fn, res, rej] = this.q.shift();
      this.busy++;
      Promise.resolve().then(fn).then(res, rej).finally(() => { this.busy--; this.next(); });
    }
  }
}

/** One long-lived `docker logs -f -t` of a runner container: parses the runner's own job lines. */
class LogWatch {
  constructor(panel, runner) {
    this.panel = panel; this.m = panel.machines.find((x) => x.id === runner.mid); this.key = runner.key; this.container = runner.container; this.startedAt = runner.startedAt;
    this.ring = []; this.subs = new Set(); this.lastTs = null; this.child = null; this.stopped = false;
    this.backoff = 1000; this.ok = false; this.rest = ''; this.job = null; this.lastDone = null; this.error = null;
    this.start();
  }

  start() {
    if (this.stopped) return;
    const floor = Date.now() - 12 * 3600 * 1000;
    const since = this.lastTs || new Date(Math.max(Date.parse(this.startedAt) || floor, floor)).toISOString();
    let child;
    try {
      const [cmd, args] = this.m.cmd(['docker', 'logs', '-f', '-t', '--since', since, this.container]);
      child = safeSpawn(cmd, args, { windowsHide: true, env: { ...process.env, WSL_UTF8: '1' } }, (e) => { this.error = String(e.message || e); });
    } catch (e) { this.error = String(e.message || e); setTimeout(() => this.start(), this.backoff); this.backoff = Math.min(this.backoff * 2, 60000); return; }
    this.child = child; this.startT = Date.now(); this.ok = true; this.error = null; this.rest = '';
    this.panel.savePids();
    const feed = (d) => {
      const parts = (this.rest + String(d)).split(/\r?\n/);
      this.rest = parts.pop();
      for (const l of parts) if (l) this.line(l);
    };
    child.stdout.on('data', feed); child.stderr.on('data', feed);
    child.on('close', (code) => {
      this.ok = false; this.child = null;
      this.panel.savePids();
      if (this.stopped) return;
      if (Date.now() - this.startT > 60000) this.backoff = 1000;
      this.error = this.error || `docker logs${this.m.kind === 'ssh' ? ` over ssh (${this.m.ssh})` : ''} exited (${code}); restarting in ${Math.round(this.backoff / 1000)} s`;
      this.panel.recompute();
      setTimeout(() => this.start(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 60000);
    });
  }

  line(raw) {
    const m = /^(\d{4}-\d\d-\d\dT[\d:.]+Z)\s(.*)$/.exec(raw);
    const ts = m ? m[1] : null;
    if (ts && this.lastTs && ts <= this.lastTs) return; // replayed after a restart
    if (ts) this.lastTs = ts;
    const text = scrub(m ? m[2] : raw);
    const at = ts ? Date.parse(ts) : Date.now();
    const out = ts && !/^\d{4}-\d\d-\d\d /.test(text) ? `${ts.slice(0, 19).replace('T', ' ')}Z ${text}` : text;
    this.ring.push(out); if (this.ring.length > 500) this.ring.splice(0, this.ring.length - 500);
    for (const s of this.subs) s(out);
    const live = Date.now() - at < 120000;
    let r;
    if ((r = /Running job:\s*(.+?)\s*$/.exec(text))) { this.job = { name: r[1], at }; this.panel.onLog(this, 'start', live); }
    else if ((r = /Job (.+?) completed with result:\s*(\w+)/.exec(text))) { this.lastDone = { name: r[1], result: r[2], at }; this.job = null; this.panel.onLog(this, 'done', live); }
    else if (/Listening for Jobs/i.test(text) && this.job) { this.job = null; this.panel.onLog(this, 'idle', live); }
  }

  stop() { this.stopped = true; killTree(this.child); }
}

export class RealRunners extends EventEmitter {
  constructor({ root, gh = GH }) {
    super();
    this.gh = gh;
    this.dir = path.join(root, 'data', 'real');
    fs.mkdirSync(path.join(this.dir, 'logs'), { recursive: true });
    this.reposFile = path.join(this.dir, 'repos.json');
    this.prsFile = path.join(this.dir, 'prs.json');
    this.prs = readJson(this.prsFile) || {};         // "repo#n" -> {title, author:{login,avatar}}
    this.repos = readJson(this.reposFile) || { at: 0, names: [] };
    this.store = new JobStore(this.dir);
    // Runner names seen on this machine, kept on disk: when WSL cannot be read (busy runners), GitHub's runner_name
    // still tells which jobs are ours. Names only - never a token or an env value.
    this.knownFile = path.join(this.dir, 'known-runners.json');
    this.known = new Set((readJson(this.knownFile) || []).filter((x) => typeof x === 'string').slice(0, 40));
    // The same names per machine (the local fallback card must not list a remote runner). Older installs have only the flat file: it was all local.
    this.knownByFile = path.join(this.dir, 'known-by-machine.json');
    const kb = readJson(this.knownByFile);
    this.knownBy = kb && typeof kb === 'object' && !Array.isArray(kb) ? kb : { [LOCAL_ID]: [...this.known] };
    // The machines: this PC (its state IS this.state, kept as before) and one state per remote machine (this.state.machines).
    this.machines = loadMachines();
    for (const m of this.machines) m.cmd = transport(m);
    this.state = { id: LOCAL_ID, label: LOCAL_LABEL, installed: false, running: false, checkedAt: null, runners: [], error: null, repoCount: this.repos.names.length, known: [...(this.knownBy[LOCAL_ID] || [])], machines: [] };
    for (const m of this.machines) {
      if (m.kind === 'local') { m.state = this.state; continue; }
      m.state = { id: m.id, label: m.label, installed: true, running: false, checkedAt: null, runners: [], error: null, stale: null };
      this.state.machines.push(m.state);
    }
    this.etags = new Map();                          // url -> {etag, body}
    this.watch = new Map();                          // container -> LogWatch
    this.inspect = new Map();                        // container id -> {runnerName, labels, startedAt}
    this.stats = { calls: [] };                      // [ts, status] of every gh request, for the footer
    this.limiter = new Limiter(GH_PARALLEL);
    this.activeRuns = new Map();                     // runId -> repo, as of the last active scan
    this.cycle = 0; this.pauseUntil = 0; this.lastActive = 0; this.lastCompleted = 0;
    this.lastStateJson = '';
    this.rl = { rate: null, limit: null, reset: null, githubAt: null }; // rate limit + last GitHub scan: kept out of `state` so they do not re-send it
    this.store.on('diff', (jobs) => { this.emit('event', { type: 'jobs', jobs }); this.recompute(); });
  }

  start() {
    const every = (name, fn, ms) => {
      const loop = async () => {
        let r;
        try { r = await fn(); } catch (e) { const ms = this.machines.find((x) => name.endsWith(` ${x.id}`)); (ms ? ms.state : this.state).error = `${name}: ${String(e.message || e).slice(0, 200)}`; r = false; }
        setTimeout(loop, typeof ms === 'function' ? ms(r) : ms);
      };
      loop();
    };
    // One discovery loop (60 s) and one stats loop (10 s) PER machine, so a slow or dead one never delays another.
    for (const m of this.machines) {
      every(`discover ${m.id}`, () => this.discover(m), (ok) => (ok === false ? (m.kind === 'ssh' ? 15000 : 5000) : 60000)); // a hung wsl.exe / ssh is retried soon
      every(`stats ${m.id}`, () => this.dockerStats(m), 10000);
    }
    every('jobs', () => this.checkJobs(), 10000);
    every('runs', () => this.scanRuns(), 5000); // decides itself whether a list is due
    setInterval(() => this.emit('event', { type: 'meta', meta: this.meta() }), 10000);
    process.on('exit', () => { for (const w of this.watch.values()) w.stop(); try { this.store.saveSync(); } catch { /* best effort */ } });
  }

  // ------------------------------------------------------------ the machine
  /** The long-lived wsl.exe children, so stop-ci-local.ps1 can end them too (a forced stop does not reach children on Windows). */
  savePids() {
    const pids = [...this.watch.values()].map((w) => w.child && w.child.pid).filter(Boolean);
    try { fs.writeFileSync(path.join(this.dir, 'watch.pids'), pids.join('\n')); } catch { /* best effort */ }
  }

  /** One docker command on a machine (over its transport), with a timeout. */
  async dk(m, args, timeout = 20000) { const [cmd, a] = m.cmd(args); return run(cmd, a, { timeout }); }

  async discover(m = this.machines[0]) {
    if (m.kind === 'ssh') return this.discoverRemote(m);
    if (!hasWsl()) return this.discoverNative(m);
    const l = await run(bin.wsl(), ['-l', '-v'], { timeout: 10000 });
    if (l.missing) { this.state.installed = false; this.state.running = false; this.state.error = `${bin.wsl()} not found: WSL is not available, so the local CI runner cannot be read (use a remote machine in Settings)`; this.recompute(); return; }
    if (l.code !== 0 && !l.out) return false; // hung or failed: keep the last picture, retry in a few seconds
    const line = l.out.split(/\r?\n/).map((s) => s.replace(/^\s*\*?\s*/, '').trim()).find((s) => s.split(/\s+/)[0] === DISTRO);
    this.state.installed = !!line;
    this.state.running = !!line && /\bRunning\b/i.test(line);
    this.state.checkedAt = new Date().toISOString();
    if (!this.state.running) { this.setRunners(m, []); return; }
    // 45 s: with both runners in heavy e2e jobs the WSL service can answer slowly. A timeout keeps the last
    // good picture (marked stale) instead of showing an error; a real docker failure is still shown.
    const ps = await this.dk(m, ['docker', 'ps', '--format', '{{json .}}'], 45000);
    if (ps.code === -2) { this.state.stale = `docker ps in ${DISTRO} slow (WSL busy); showing the last reading`; this.recompute(); return false; }
    if (ps.code !== 0) {
      // wsl.exe writes its own failures (E_UNEXPECTED, service timeouts) to stdout in UTF-16, so stderr is often empty.
      const why = `${ps.err || ''} ${ps.out || ''}`.replace(/\u0000/g, '').replace(/\s+/g, ' ').trim().slice(-200);
      if (!why || /Wsl\/|E_UNEXPECTED|0x8007/i.test(why)) { this.state.stale = `docker ps in ${DISTRO}: WSL did not answer${why ? ` (${why})` : ''}; showing the last reading`; this.recompute(); return false; }
      this.state.error = `docker ps in ${DISTRO}: ${why}`; this.recompute(); return false;
    }
    // Under heavy load wsl.exe can exit 0 with nothing on stdout. An empty answer while we last saw runners is not
    // "no runners": keep the last picture (marked stale) until docker answers with real lines.
    if (!ps.out.trim() && this.state.runners.length) {
      this.state.stale = `docker ps in ${DISTRO} returned nothing (WSL busy?); showing the last reading`;
      this.recompute(); return false;
    }
    return this.readContainers(m, ps.out);
  }

  /** Linux / macOS: the local machine is read through the native docker CLI (no WSL). A missing docker disables the panel with a clear message. */
  async discoverNative(m) {
    const st = this.state;
    st.checkedAt = new Date().toISOString();
    const ps = await this.dk(m, ['docker', 'ps', '--format', '{{json .}}'], 30000);
    if (ps.missing) { st.installed = false; st.running = false; st.stale = null; st.error = `docker CLI not found on this ${platformName()} machine: the local CI panel is off (install docker, or add a remote machine in Settings)`; this.setRunners(m, []); return; }
    st.installed = true;
    if (ps.code === -2) { st.stale = 'docker ps slow; showing the last reading'; this.recompute(); return false; }
    if (ps.code !== 0) { st.running = false; st.stale = null; st.error = `docker is installed but not answering: ${scrub(`${ps.err || ''}`).replace(/\s+/g, ' ').trim().slice(-160) || `exit ${ps.code}`}`; this.recompute(); return false; }
    st.running = true;
    return this.readContainers(m, ps.out);
  }

  /** A remote machine over ssh: only `docker ps` / inspect / stats / logs. Unreachable ssh keeps the last reading (stale) or shows the error; the local group is never touched. */
  async discoverRemote(m) {
    const st = m.state;
    st.checkedAt = new Date().toISOString();
    const ps = await this.dk(m, ['docker', 'ps', '--format', '{{json .}}'], 30000);
    if (ps.code !== 0) {
      const why = scrub(`${ps.err || ''} ${ps.out || ''}`).replace(/\u0000/g, '').replace(/\s+/g, ' ').trim().slice(-200);
      const unreachable = ps.code === -2 || ps.code === -1 || ps.code === 255; // timeout / spawn failed / ssh itself failed
      if (unreachable && st.runners.length) { st.stale = `ssh ${m.ssh}: ${ps.code === -2 ? 'no answer in time' : why || 'unreachable'}; showing the last reading`; st.error = null; }
      else { st.error = `ssh ${m.ssh}: ${ps.code === -2 ? 'no answer in time' : why || `exit ${ps.code}`}`; st.stale = null; if (unreachable) st.running = false; }
      this.recompute(); return false;
    }
    st.running = true; // reachable
    return this.readContainers(m, ps.out);
  }

  /** The runner containers of one machine from its `docker ps` lines (same image / name filter everywhere); identity from docker inspect env, tokens never kept. */
  async readContainers(m, psOut) {
    const st = m.state;
    st.stale = null;
    st.error = null;
    const cs = psOut.split(/\r?\n/).filter(Boolean).map((x) => { try { return JSON.parse(x); } catch { return null; } })
      .filter((c) => c && CONTAINER_RE.test(c.Names) && (RUNNER_IMAGE.test(c.Image) || RUNNER_NAME.test(c.Names) || (m.kind === 'ssh' && TEAM_NAME.test(c.Names))));
    const runners = [];
    for (const c of cs) {
      const key = m.kind === 'local' ? c.Names : `${m.id}.${c.Names}`;
      const iid = `${m.id}:${c.ID}`;
      let info = this.inspect.get(iid);
      if (!info) {
        const ins = await this.dk(m, ['docker', 'inspect', '--format', '{{json .Config.Env}}|{{.State.StartedAt}}', c.Names], 15000);
        const [envJson, startedAt] = ins.out.trim().split('|');
        let env = [];
        try { env = JSON.parse(envJson); } catch { /* none */ }
        const get = (k) => (env.find((e) => e.startsWith(`${k}=`)) || '').slice(k.length + 1);
        // Only the runner's identity is read from its env; tokens are never kept.
        info = { runnerName: get('RUNNER_NAME') || c.Names, labels: get('LABELS'), startedAt };
        if (ins.code === 0) this.inspect.set(iid, info);
      }
      const prev = st.runners.find((r) => r.key === key) || {};
      runners.push({ ...prev, mid: m.id, key, container: c.Names, image: c.Image, status: c.Status, ...info });
    }
    this.setRunners(m, runners);
  }

  /** Runners of every machine, this PC first. */
  allRunners() { return this.machines.flatMap((m) => m.state.runners); }

  /** The runner names of all our machines: the ones docker shows now plus the ones seen before (kept on disk). */
  myNames() { return new Set([...this.allRunners().map((r) => r.runnerName), ...this.known]); }

  setRunners(m, runners) {
    m.state.runners = runners;
    let grew = false;
    const kb = this.knownBy[m.id] || (this.knownBy[m.id] = []);
    for (const r of runners) {
      if (!r.runnerName) continue;
      if (!this.known.has(r.runnerName)) { this.known.add(r.runnerName); grew = true; }
      if (!kb.includes(r.runnerName)) { kb.push(r.runnerName); grew = true; }
    }
    if (grew) {
      try { fs.writeFileSync(this.knownFile, JSON.stringify([...this.known])); } catch { /* best effort */ }
      try { fs.writeFileSync(this.knownByFile, JSON.stringify(this.knownBy)); } catch { /* best effort */ }
    }
    if (m.kind === 'local') this.state.known = [...kb];
    const names = this.myNames();
    for (const [k, w] of this.watch) if (w.m === m && !runners.some((r) => r.key === k)) { w.stop(); this.watch.delete(k); }
    for (const r of runners) if (!this.watch.has(r.key)) this.watch.set(r.key, new LogWatch(this, r));
    this.savePids();
    // Jobs that ran on one of these runners belong to "Our machines".
    for (const j of this.store.all()) if (!j.mine && j.runner && names.has(j.runner)) this.store.upsert(j.id, { mine: true });
    this.recompute();
  }

  async dockerStats(m = this.machines[0]) {
    const cs = m.state.runners;
    if (!m.state.running || !cs.length) return;
    const st = await this.dk(m, ['docker', 'stats', '--no-stream', '--format', '{{json .}}', ...cs.map((c) => c.container)], 15000);
    for (const x of st.out.split(/\r?\n/).filter(Boolean)) {
      let j; try { j = JSON.parse(x); } catch { continue; }
      const r = cs.find((c) => c.container === j.Name);
      if (r) { r.cpu = j.CPUPerc; r.mem = j.MemUsage; }
    }
    this.recompute();
  }

  /** A runner log event: flip the card now, then attach / settle the GitHub job record. */
  onLog(w, kind, live) {
    this.recompute();
    if (!live) return;
    const r = this.allRunners().find((x) => x.key === w.key);
    if (!r) return;
    if (kind === 'start') {
      // Which GitHub job is it? Re-check the candidates now and list the runs early.
      const c = this.candidates(r.runnerName, w.job.name);
      for (const j of c.slice(0, 5)) this.recheckSoon(j.id, 0);
      // Not in the store yet (a job waiting on `needs` is listed only once it is queued): list every active run's jobs now.
      if (!c.length) this.forceRunJobs = true;
      this.lastActive = 0;
    } else if (kind === 'done') {
      const j = this.store.active().filter((x) => x.runner === r.runnerName && x.job === w.lastDone.name)
        .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))[0];
      if (j) {
        this.store.upsert(j.id, { local: { result: w.lastDone.result, at: new Date(w.lastDone.at).toISOString() } });
        for (const ms of [0, 3000, 8000, 20000]) this.recheckSoon(j.id, ms);
      }
    }
  }

  candidates(runnerName, name) {
    const act = this.store.active().filter((j) => j.job === name && (j.runner === runnerName || !j.runner));
    return act.sort((a, b) => (b.runner === runnerName) - (a.runner === runnerName) || String(b.startedAt || b.createdAt).localeCompare(String(a.startedAt || a.createdAt)));
  }

  /** Coalesced (50 ms): a log replay of hundreds of lines sends one state, a live line flips the card at once. */
  recompute() { if (!this.recT) this.recT = setTimeout(() => { this.recT = null; this.computeNow(); }, 50); }

  /** Busy/idle of each local runner: the runner's own log first, GitHub and CPU as fallbacks. */
  computeNow() {
    const now = Date.now();
    for (const r of this.allRunners()) {
      const w = this.watch.get(r.key);
      const cpu = parseFloat(String(r.cpu || '').replace('%', '')) || 0;
      const gh = this.store.active().filter((j) => j.runner === r.runnerName && j.status === 'in_progress' && !j.local)
        .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))[0];
      const recentDone = w && w.lastDone && now - w.lastDone.at < 30000;
      const fromLog = !!(w && w.lastTs);
      let st = 'idle', rec = null, name = null;
      if (fromLog) {
        if (w.job) {
          st = 'busy'; name = w.job.name; rec = this.candidates(r.runnerName, name).find((j) => j.runner === r.runnerName) || null;
          // Still unmatched after 15 s: list the active runs' jobs again (at most every 30 s).
          if (!rec && now - w.job.at > 15000 && now - (this.lastForce || 0) > 30000) { this.lastForce = now; this.forceRunJobs = true; this.lastActive = 0; }
        }
        else if (cpu >= CPU_BUSY && !recentDone) st = 'unknown';
      } else if (gh) { st = 'busy'; rec = gh; name = gh.job; }
      else if (cpu >= CPU_BUSY) st = 'unknown';
      r.source = fromLog ? 'log' : 'github';
      r.busyState = st;
      r.busy = st !== 'idle';
      r.since = fromLog && w.job ? new Date(w.job.at).toISOString() : (rec && rec.startedAt) || null;
      r.job = rec ? { id: rec.id, name: rec.job, workflow: rec.workflow, repo: rec.repo, pr: rec.pr, prTitle: rec.prTitle, branch: rec.branch, trigger: rec.trigger, actor: rec.actor, prAuthor: rec.prAuthor, startedAt: rec.startedAt }
        : name ? { id: null, name } : null;
      r.lastDone = w && w.lastDone ? { name: w.lastDone.name, result: w.lastDone.result, at: new Date(w.lastDone.at).toISOString() } : null;
      r.log = w ? { ok: w.ok, error: w.ok ? null : w.error } : null;
    }
    const s = JSON.stringify(this.state);
    if (s !== this.lastStateJson) { this.lastStateJson = s; this.emit('event', { type: 'state', state: this.state }); }
  }

  // ------------------------------------------------------------ GitHub
  async ghReq(url) {
    if (Date.now() < this.pauseUntil) return { status: 0, body: null };
    if (!spend(1, 'ci')) return { status: 0, body: null, budget: true }; // the ONE shared budget (budget.mjs); refunded below on a 304
    return this.limiter.run(async () => {
      const cached = this.etags.get(url);
      const args = ['api', '-i', url];
      if (cached && cached.etag) args.push('-H', `If-None-Match: ${cached.etag}`);
      const r = await run(this.gh, args, { timeout: 30000 });
      const head = r.out.split(/\r?\n\r?\n/)[0] || '';
      const status = Number((/^HTTP\/[\d.]+\s+(\d+)/m.exec(head) || [])[1] || 0);
      const h = (k) => (new RegExp(`^${k}:\\s*(.+?)\\s*$`, 'im').exec(head) || [])[1];
      if (h('x-ratelimit-remaining')) this.rl.rate = Number(h('x-ratelimit-remaining'));
      if (h('x-ratelimit-limit')) this.rl.limit = Number(h('x-ratelimit-limit'));
      if (h('x-ratelimit-reset')) this.rl.reset = Number(h('x-ratelimit-reset')) * 1000;
      this.stats.calls.push([Date.now(), status]);
      if (this.stats.calls.length > 20000) this.stats.calls = this.stats.calls.slice(-10000);
      if (status === 429 || (status === 403 && (h('x-ratelimit-remaining') === '0' || h('retry-after')))) this.pauseUntil = Date.now() + (Number(h('retry-after')) || 60) * 1000;
      if (status === 304 || status === 0) refund(1, 'ci'); // a conditional hit costs no rate limit
      if (status === 304 && cached) return { status, body: cached.body };
      if (status !== 200) return { status, body: null };
      let body;
      try { body = JSON.parse(r.out.slice(head.length).trim()); } catch { return { status: 0, body: null }; }
      this.etags.set(url, { etag: h('etag'), body });
      if (this.etags.size > 4000) this.etags.delete(this.etags.keys().next().value);
      return { status, body };
    });
  }

  /** Requests of the last hour: all, and those that were not 304 (only these cost rate limit). */
  requestStats() {
    const cut = Date.now() - 3600000;
    this.stats.calls = this.stats.calls.filter((c) => c[0] > cut);
    const total = this.stats.calls.length;
    const by = {}; for (const c of this.stats.calls) by[c[1]] = (by[c[1]] || 0) + 1;
    const counted = this.stats.calls.filter((c) => c[1] !== 304).length;
    // The pace follows the larger of the real last hour and the last 10 minutes x 6, so a burst is
    // felt at once but the start-up catch-up (no ETags cached yet) does not throttle a whole hour.
    const cut10 = Date.now() - 600000;
    const recent = this.stats.calls.filter((c) => c[0] > cut10 && c[1] !== 304).length;
    return { lastHour: total, by, counted, countedPerHour: Math.max(counted, recent * 6), budget: BUDGET };
  }

  pace() {
    if (this.rl.rate != null && this.rl.rate < MIN_RATE) return 4;
    const { countedPerHour } = this.requestStats();
    return countedPerHour < BUDGET * 0.5 ? 0 : countedPerHour < BUDGET * 0.75 ? 1 : countedPerHour < BUDGET ? 2 : 3;
  }

  meta() {
    return { rate: this.rl.rate, rateLimit: this.rl.limit, rateReset: this.rl.reset, requests: this.requestStats(), pace: this.pace(),
      repoCount: this.state.repoCount, githubAt: this.rl.githubAt || null, at: new Date().toISOString(), paused: Date.now() < this.pauseUntil };
  }

  async orgRepos() {
    if (!ORG) return this.repos.names;
    if (Date.now() - this.repos.at > REPOS_TTL_MS || !this.repos.names.length) {
      const r = await run(this.gh, ['api', `orgs/${ORG}/repos?per_page=100&type=all`, '--paginate', '--jq', '.[] | select(.archived|not) | select(.disabled|not) | .full_name'], { timeout: 60000 });
      if (r.code === 0) {
        const names = r.out.split(/\r?\n/).map((x) => x.trim()).filter((x) => REPO_RE.test(x));
        if (names.length) { this.repos = { at: Date.now(), names }; writeJson(this.reposFile, this.repos); }
      } else if (!this.repos.names.length) throw new Error(`org repos: ${r.err.trim().slice(-150)}`);
    }
    this.state.repoCount = this.repos.names.length;
    return this.repos.names;
  }

  async prInfo(repo, n) {
    if (!n || !REPO_RE.test(repo || '')) return null;
    const key = `${repo}#${n}`;
    if (this.prs[key]) return this.prs[key];
    const { body: b } = await this.ghReq(`repos/${repo}/pulls/${Number(n)}`);
    if (!b) return null;
    const v = { title: String(b.title || '').slice(0, 200), author: person(b.user) };
    this.prs[key] = v; writeJson(this.prsFile, this.prs);
    return v;
  }

  /** The run's fields every job record carries (owners, PR, branch); PR info is fetched once per PR. */
  async runMeta(w, repo) {
    const n = (w.pull_requests && w.pull_requests[0] && w.pull_requests[0].number) || null;
    const trigger = person(w.triggering_actor) || person(w.actor);
    const actor = person(w.actor);
    const pr = n ? await this.prInfo(repo, n) : null;
    const meta = { repo, runId: w.id, workflow: w.name, event: w.event, branch: w.head_branch, sha: w.head_sha, pr: n,
      trigger, actor: actor && trigger && actor.login !== trigger.login ? actor : null, prAuthor: pr ? pr.author : null, prTitle: pr ? pr.title : null, ownersDone: true };
    const prev = this.store.runs[w.id] || {};
    this.store.runs[w.id] = { ...prev, repo, u: w.updated_at, status: w.status, t: Date.now() }; this.store.dirty = true;
    return meta;
  }

  ingest(j, meta) {
    const names = this.myNames();
    const before = this.store.get(j.id);
    const runner = j.runner_name || null;
    const rec = this.store.upsert(j.id, {
      ...(meta || { workflow: (before && before.workflow) || j.workflow_name, branch: (before && before.branch) || j.head_branch, sha: (before && before.sha) || j.head_sha, runId: j.run_id }),
      job: j.name, runner, labels: Array.isArray(j.labels) ? j.labels.map((x) => String(x).slice(0, 60)).slice(0, 12) : undefined, status: j.status, conclusion: j.conclusion, createdAt: j.created_at, startedAt: j.started_at, completedAt: j.completed_at, url: j.html_url,
      steps: (j.steps || []).map((s) => ({ name: s.name, status: s.status, conclusion: s.conclusion, startedAt: s.started_at, completedAt: s.completed_at })),
      mine: !!((before && before.mine) || (runner && names.has(runner))),
    });
    if (rec.mine && rec.status === 'completed' && (!before || before.status !== 'completed')) this.fetchJobLog(rec).catch(() => {});
    return rec;
  }

  async runJobs(repo, w, meta) {
    const { body } = await this.ghReq(`repos/${repo}/actions/runs/${w.id}/jobs?per_page=100`);
    if (!body) return false;
    for (const j of body.jobs || []) this.ingest(j, meta);
    if (this.store.runs[w.id]) this.store.runs[w.id].jobsAt = Date.now(); this.store.dirty = true;
    return true;
  }

  /** Run lists: active every 30 s, completed every 2 min (both slowed down by the budget). */
  async scanRuns() {
    const p = this.pace();
    if (Date.now() - this.lastActive >= PACE.activeMs[p] - 1000) { this.lastActive = Date.now(); await this.scanActive(p); }
    if (Date.now() - this.lastCompleted >= PACE.completedMs[p]) { this.lastCompleted = Date.now(); await this.scanCompleted(); }
  }

  async scanActive(p) {
    const repos = await this.orgRepos();
    const seen = new Map();
    const failed = new Set();
    await Promise.all(repos.flatMap((repo) => ['in_progress', 'queued'].map(async (st) => {
      const { body } = await this.ghReq(`repos/${repo}/actions/runs?status=${st}&per_page=50`);
      if (!body) { failed.add(repo); return; }
      for (const w of body.workflow_runs || []) seen.set(w.id, { w, repo });
    })));
    const jobsOfRun = new Set(this.store.all().map((j) => j.runId));
    const force = this.forceRunJobs; this.forceRunJobs = false;
    await Promise.all([...seen.values()].map(async ({ w, repo }) => {
      const prev = this.store.runs[w.id];
      const meta = await this.runMeta(w, repo);
      // New run, or its jobs not listed for a while (jobs that wait on `needs` appear later).
      if (force || !prev || !prev.jobsAt || !jobsOfRun.has(w.id) || Date.now() - prev.jobsAt >= PACE.runJobsMs[p]) await this.runJobs(repo, w, meta);
    }));
    // Runs that left the active lists have finished (or were cancelled): fetch each once to settle its jobs.
    const next = new Map([...seen.entries()].map(([id, x]) => [id, x.repo]));
    for (const [id, repo] of this.activeRuns) {
      if (seen.has(id)) continue;
      if (failed.has(repo)) { next.set(id, repo); continue; } // that list failed this time: ask again next scan
      const { body: w } = await this.ghReq(`repos/${repo}/actions/runs/${id}`);
      if (w) await this.runJobs(repo, w, await this.runMeta(w, repo));
    }
    this.activeRuns = next;
    this.rl.githubAt = new Date().toISOString();
  }

  async scanCompleted() {
    const since = new Date(Date.now() - 86400000).toISOString().slice(0, 10); // day granularity keeps the URL (and its ETag) stable
    let left = 20;
    for (const repo of this.repos.names) {
      const { body } = await this.ghReq(`repos/${repo}/actions/runs?status=completed&created=%3E%3D${since}&per_page=50`);
      for (const w of (body && body.workflow_runs) || []) {
        if (Date.parse(w.updated_at) < Date.now() - 86400000) continue;
        const prev = this.store.runs[w.id];
        if (prev && prev.status === 'completed' && prev.u === w.updated_at && prev.jobsAt) continue;
        if (left-- <= 0) return;
        await this.runJobs(repo, w, await this.runMeta(w, repo));
      }
    }
  }

  /** Every queued / in_progress job in the store is re-checked by id (ETag; 304 is free). */
  async checkJobs() {
    this.cycle++;
    const stride = PACE.jobStride[this.pace()];
    const mineNames = this.myNames();
    const isMine = (j) => !!(j.mine || (j.runner && mineNames.has(j.runner)) || j.local);
    const act = this.store.active().filter((j) => REPO_RE.test(j.repo || ''))
      .filter((j) => isMine(j) || (stride !== Infinity && this.cycle % stride === 0))
      .sort((a, b) => isMine(b) - isMine(a) || String(b.startedAt || b.createdAt).localeCompare(String(a.startedAt || a.createdAt)))
      .slice(0, 60);
    await Promise.all(act.map((j) => this.recheck(j.id)));
  }

  async recheck(id) {
    const j = this.store.get(id);
    if (!j || !REPO_RE.test(j.repo || '') || j.status === 'completed') return;
    const { status, body } = await this.ghReq(`repos/${j.repo}/actions/jobs/${Number(id)}`);
    if (body) this.ingest(body, null);
    else if (status === 404 || status === 410) this.store.upsert(id, { status: 'completed', conclusion: j.conclusion || null, gone: true });
  }

  recheckSoon(id, ms) { setTimeout(() => this.recheck(id).catch(() => {}), ms); }

  async fetchJobLog(rec) {
    if (!REPO_RE.test(rec.repo || '')) return;
    const file = path.join(this.dir, 'logs', `${Number(rec.id)}.log`);
    if (fs.existsSync(file)) return;
    const r = await run(this.gh, ['api', `repos/${rec.repo}/actions/jobs/${Number(rec.id)}/logs`], { timeout: 60000 });
    if (r.code === 0) fs.writeFileSync(file, scrub(r.out));
  }

  jobLog(id) { const f = path.join(this.dir, 'logs', `${Number(id)}.log`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; }

  /** Live runner log of one container (the same long-lived `docker logs -f`): recent lines, then new ones. */
  tail(container, onLine) {
    const w = this.watch.get(container);
    if (!w) throw new Error('unknown runner container');
    for (const l of w.ring.slice(-300)) onLine(l);
    w.subs.add(onLine);
    return () => w.subs.delete(onLine);
  }

  /** What a browser needs to start: runner cards, footer numbers and the jobs that are queued / running now
   *  (without steps). The lists themselves (/api/org, /api/real) are fetched per view, a page at a time. */
  snapshot() {
    return { state: this.state, meta: this.meta(), jobs: this.store.active().map(lean) };
  }
}

const LOGIN_RE = /^[\w-]{1,39}(\[bot\])?$/;
function person(u) {
  if (!u || !LOGIN_RE.test(u.login || '')) return null;
  const av = String(u.avatar_url || '');
  return { login: u.login, avatar: /^https:\/\/avatars\.githubusercontent\.com\//.test(av) ? av : null };
}
