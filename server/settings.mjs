// The settings API (the /settings page): read and write the config file, list this machine and the configured SSH
// machines, test an SSH alias, detect a project folder. Local-only by construction:
//   * the connection must come from loopback and carry no proxy header (so a tunnel in front of the deck is refused);
//   * the Host header must be 127.0.0.1:<port> / localhost:<port> / [::1]:<port> (DNS-rebinding guard);
//   * every POST/PUT needs an Origin equal to that host, and a CSRF token (served by GET /api/settings) in `x-csrf-token`.
//   GET  /api/settings          { settings, csrf, path, hasFile, backups }
//   PUT  /api/settings          body = the whole config object; validated, written atomically, backed up, reloaded, broadcast
//   PUT  /api/settings/token    a new remote-access token (server.accessToken), written like a save; applies at once
//   GET /api/settings also returns `accessToken` (the real one: these routes are local-only), for Settings -> General.
//   GET  /api/devices           this machine (detected) + the configured SSH machines
//   POST /api/devices/test      { sshAlias } -> capabilities read over ssh (read-only command)
//   POST /api/projects/detect   { path } -> repo, default branch, Claude project dir, CI check names
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { bin, isWin, killTree, safeSpawn } from "./platform.mjs";
import { checkSettings, configPath, getConfig, projectById, readUserFile, reloadConfig, publicConfig, remoteAuthProblem } from "./config.mjs";
import { addInstructions, doSetup, finishSetup, setupStatus } from "./setup.mjs";

const MAX_BODY = 512 * 1024;
const MAX_BACKUPS = 20;
const SECRET_KEY = /token|secret|password|passwd|api[-_]?key|credential/i;
const MASK = "***";
const ALIAS_RE = /^[\w][\w.@-]{0,63}$/;
const BRANCH_RE = /^[\w./-]+$/;

const send = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" });
  res.end(JSON.stringify(body));
};

/** Secrets never leave the server: any key that looks like one is masked; a masked value written back keeps the stored one. */
function redact(v) {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET_KEY.test(k) && typeof x === "string" && x ? MASK : redact(x)]));
  return v;
}
function unmask(next, prev) {
  if (Array.isArray(next)) return next.map((x, i) => unmask(x, Array.isArray(prev) ? prev[i] : undefined));
  if (next && typeof next === "object") {
    const out = {};
    for (const [k, x] of Object.entries(next)) out[k] = x === MASK && SECRET_KEY.test(k) ? prev?.[k] : unmask(x, prev?.[k]);
    return out;
  }
  return next;
}

/** Run a command, never through a shell; resolves { code, out, err } and never throws. */
function run(file, args, { timeout = 8000, env } = {}) {
  return new Promise((resolve) => {
    try {
      const child = execFile(file, args, { timeout, windowsHide: true, encoding: "buffer", maxBuffer: 2 * 1024 * 1024, env: env ? { ...process.env, ...env } : process.env }, (e, out, err) => {
        const dec = (b) => (b && b.length > 1 && b[1] === 0 ? b.toString("utf16le") : (b || Buffer.alloc(0)).toString("utf8")).replace(/\u0000/g, "");
        resolve({ code: e ? (typeof e.code === "number" ? e.code : -1) : 0, out: dec(out), err: dec(err) });
      });
      child.on("error", () => { /* ENOENT also reaches the callback above */ });
    } catch { resolve({ code: -1, out: "", err: "" }); }
  });
}

const lines = (t) => t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

async function wslDistros() {
  if (!isWin()) return [];
  const r = await run(bin.wsl(), ["-l", "-q"], { env: { WSL_UTF8: "1" } });
  return r.code === 0 ? lines(r.out).filter((l) => /^[\w.-]+$/.test(l)) : [];
}

/** docker through the configured WSL distro (Windows) or natively; returns { available, via, version, containers } */
async function dockerInfo(distro) {
  const fmt = ["ps", "--format", "{{.Names}}|{{.Image}}|{{.Status}}"];
  const attempts = [];
  if (isWin()) { if (distro) attempts.push([bin.wsl(), ["-d", distro, "docker", ...fmt], `wsl:${distro}`]); }
  attempts.push([bin.docker(), fmt, "native"]);
  for (const [file, args, via] of attempts) {
    const r = await run(file, args, { timeout: 10000, env: { WSL_UTF8: "1" } });
    if (r.code === 0) {
      const containers = lines(r.out).map((l) => { const [name, image, status] = l.split("|"); return { name, image, status }; });
      return { available: true, via, containers };
    }
  }
  return { available: false, via: null, containers: [] };
}

async function ghInfo() {
  const r = await run(getConfig().tools.gh, ["auth", "status"], { timeout: 8000 });
  const text = `${r.out}\n${r.err}`;
  const m = /Logged in to [\w.-]+ (?:account|as) ([\w.-]+)/i.exec(text);
  return { loggedIn: r.code === 0, user: m ? m[1] : null };
}

let localCache = null;
async function localDevice(force) {
  if (!force && localCache && Date.now() - localCache.at < 30000) return localCache.v;
  const c = getConfig();
  const distros = await wslDistros();
  const distro = c.machine.wslDistro || distros.find((d) => !/^docker-desktop/.test(d)) || null;
  const [docker, gh] = await Promise.all([dockerInfo(distro), ghInfo()]);
  const image = c.machine.runnerImage ? new RegExp(c.machine.runnerImage) : null;
  const name = c.machine.runnerName ? new RegExp(c.machine.runnerName) : null;
  const runners = docker.containers.filter((x) => x.name === c.machine.ciContainer || (image && image.test(x.image || "")) || (name && name.test(x.name || "")));
  const cpus = os.cpus();
  const v = {
    id: "local",
    label: c.machine.localLabel,
    os: `${os.type()} ${os.release()} (${os.platform()}/${os.arch()})`,
    hostname: os.hostname(),
    cpu: { model: cpus[0]?.model?.trim() || null, threads: cpus.length },
    ramGB: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    wslDistros: distros,
    wslDistro: distro,
    docker: { available: docker.available, via: docker.via, containers: docker.containers.length },
    gh,
    services: { ciRunner: { detected: runners.length > 0, containers: runners.map((x) => x.name) }, monitoring: { on: true }, docker: { on: docker.available } },
  };
  localCache = { at: Date.now(), v };
  return v;
}

const REMOTE_PROBE = "uname -a; nproc; free -m; docker --version";

/** ssh <alias> <probe>: read-only, BatchMode (never prompts), 5 s connect timeout, 15 s overall. */
function probeSsh(alias) {
  return new Promise((resolve) => {
    let done = false, timer, c;
    const finish = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
    try { c = safeSpawn("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", alias, REMOTE_PROBE], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }, (e) => finish({ ok: false, error: `cannot start ssh: ${e.message}` })); }
    catch (e) { return finish({ ok: false, error: `cannot start ssh: ${e.message}` }); }
    const out = [], err = [];
    c.stdout.on("data", (d) => out.push(d));
    c.stderr.on("data", (d) => err.push(d));
    c.on("error", (e) => finish({ ok: false, error: `cannot start ssh: ${e.message}` }));
    c.on("close", (code) => {
      const text = Buffer.concat(out).toString("utf8");
      if (code !== 0 && !text.trim()) return finish({ ok: false, error: Buffer.concat(err).toString("utf8").trim().slice(0, 300) || `ssh exited with ${code}` });
      const ls = lines(text);
      const mem = /^Mem:\s+(\d+)/m.exec(text);
      const dockerLine = ls.find((l) => /^Docker version/i.test(l));
      finish({
        ok: true,
        uname: ls[0] || null,
        cpus: /^\d+$/.test(ls[1] || "") ? Number(ls[1]) : null,
        ramMB: mem ? Number(mem[1]) : null,
        docker: dockerLine ? dockerLine.replace(/^Docker version\s*/i, "").split(",")[0] : null,
      });
    });
    timer = setTimeout(() => { killTree(c); finish({ ok: false, error: "timed out after 15 s" }); }, 15000);
  });
}

const parseRemote = (url) => {
  const m = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(url.trim());
  return m ? { owner: m[1], name: m[2] } : null;
};

/** The folder Claude Code keeps its transcripts in for a project path: ~/.claude/projects/<path, every non-alphanumeric char -> "-">. */
const claudeDirFor = (p) => path.join(os.homedir(), ".claude", "projects", path.resolve(p).replace(/[^A-Za-z0-9]/g, "-")).replace(/\\/g, "/");

async function detectProject(raw) {
  if (typeof raw !== "string" || !raw.trim()) return { status: 400, body: { error: "path is required" } };
  const p = raw.trim();
  if (!path.isAbsolute(p)) return { status: 400, body: { error: "path must be absolute" } };
  let st;
  try { st = fs.statSync(p); } catch { return { status: 400, body: { error: "folder does not exist" } }; }
  if (!st.isDirectory()) return { status: 400, body: { error: "not a folder" } };
  const git = getConfig().tools.git, gh = getConfig().tools.gh;
  const top = await run(git, ["-C", p, "rev-parse", "--show-toplevel"]);
  if (top.code !== 0) return { status: 400, body: { error: "not a git repository" } };
  const remoteUrl = await run(git, ["-C", p, "remote", "get-url", "origin"]);
  const remote = remoteUrl.code === 0 ? parseRemote(remoteUrl.out) : null;
  const repo = remote ? `${remote.owner}/${remote.name}` : null;
  let branch = null, branchFrom = null;
  const sym = await run(git, ["-C", p, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (sym.code === 0 && /^origin\/[\w./-]+$/.test(sym.out.trim())) { branch = sym.out.trim().slice(7); branchFrom = "git origin/HEAD"; }
  if (!branch && repo) {
    const r = await run(gh, ["repo", "view", repo, "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"], { timeout: 15000 });
    if (r.code === 0 && BRANCH_RE.test(r.out.trim())) { branch = r.out.trim(); branchFrom = "gh repo view"; }
  }
  if (!branch) {
    const cur = await run(git, ["-C", p, "branch", "--show-current"]);
    if (cur.code === 0 && BRANCH_RE.test(cur.out.trim())) { branch = cur.out.trim(); branchFrom = "current branch"; }
  }
  let checks = [], checksError = null;
  if (repo && branch) {
    const r = await run(gh, ["api", `repos/${repo}/commits/${branch}/check-runs?per_page=100`, "--jq", "[.check_runs[].name] | unique | .[]"], { timeout: 20000 });
    if (r.code === 0) checks = lines(r.out); else checksError = (r.err || "gh api failed").trim().slice(0, 200);
  }
  const dir = claudeDirFor(top.out.trim() || p);
  return {
    status: 200,
    body: {
      repoPath: p.replace(/\\/g, "/"),
      topLevel: top.out.trim().replace(/\\/g, "/"),
      repo, defaultBranch: branch, defaultBranchFrom: branchFrom,
      name: repo ? repo.split("/")[1] : path.basename(p),
      claudeProjectDir: dir, claudeProjectDirExists: fs.existsSync(dir),
      checks, checksError,
    },
  };
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const PROXY_HEADERS = ["x-forwarded-for", "x-forwarded-host", "x-real-ip", "forwarded", "cf-connecting-ip", "cf-ray", "via"];

/** @param {{ port: number, broadcast: (type: string, data: unknown) => void }} o */
export function createSettings({ port, broadcast, refresh = async () => {}, reloaded = () => {} }) {
  const csrf = crypto.randomBytes(24).toString("hex");
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);

  /** null when the request may proceed, else the refusal [code, message]. */
  function guard(req, write) {
    if (!LOOPBACK.has(req.socket.remoteAddress || "")) return [403, "settings are local-only"];
    if (PROXY_HEADERS.some((h) => req.headers[h] !== undefined)) return [403, "settings are not available through a proxy or tunnel"];
    const host = String(req.headers.host || "");
    if (!hosts.has(host)) return [403, "wrong host"];
    if (!write) return null;
    const origin = req.headers.origin;
    if (!origin || ![`http://${host}`].includes(String(origin))) return [403, "same-origin requests only"];
    const sent = Buffer.from(String(req.headers["x-csrf-token"] || ""));
    const want = Buffer.from(csrf);
    if (sent.length !== want.length || !crypto.timingSafeEqual(sent, want)) return [403, "missing or wrong CSRF token"];
    return null;
  }

  const readBody = (req) => new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on("data", (d) => { n += d.length; if (n > MAX_BODY) { reject(Object.assign(new Error("body too large"), { status: 413 })); req.destroy(); } else chunks.push(d); });
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "null")); } catch { reject(Object.assign(new Error("body is not valid JSON"), { status: 400 })); } });
    req.on("error", reject);
  });

  function backups() {
    const file = configPath(), dir = path.dirname(file), base = path.basename(file);
    try { return fs.readdirSync(dir).filter((f) => f.startsWith(`${base}.bak-`)).sort().reverse(); } catch { return []; }
  }

  function writeConfig(obj) {
    const file = configPath(), dir = path.dirname(file);
    fs.mkdirSync(dir, { recursive: true });
    let backup = null;
    if (fs.existsSync(file)) {
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      backup = `${path.basename(file)}.bak-${ts}`;
      fs.copyFileSync(file, path.join(dir, backup));
    }
    const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", "utf8");
    fs.renameSync(tmp, file);
    for (const old of backups().slice(MAX_BACKUPS)) { try { fs.unlinkSync(path.join(dir, old)); } catch { /* ignore */ } }
    return backup;
  }

  async function handle(req, res, url, pid) {
    const p = url.pathname;
    const route = p === "/api/settings" ? "settings" : p === "/api/settings/token" ? "token" : p === "/api/setup" ? "setup" : p === "/api/setup/instructions" ? "instructions" : p === "/api/setup/done" ? "done" : p === "/api/devices" ? "devices" : p === "/api/devices/test" ? "test" : p === "/api/projects/detect" ? "detect" : null;
    if (!route) return false;
    const method = req.method || "GET";
    const allowed = { settings: ["GET", "PUT"], token: ["PUT"], devices: ["GET"], test: ["POST"], detect: ["POST"], setup: ["GET", "POST"], instructions: ["POST"], done: ["POST"] }[route];
    if (!allowed.includes(method)) return send(res, 405, { error: "method not allowed" }), true;
    const refused = guard(req, method !== "GET");
    if (refused) return send(res, refused[0], { error: refused[1] }), true;
    try {
      if (route === "settings" && method === "GET") {
        const check = checkSettings(readUserFile());
        const settings = check.ok ? check.settings : readUserFile();
        return send(res, 200, { settings: redact(settings), csrf, path: configPath().replace(/\\/g, "/"), hasFile: fs.existsSync(configPath()), backups: backups(), invalid: check.ok ? null : check.message, accessToken: getConfig().server.accessToken }), true;
      }
      if (route === "token") {
        // Rotate (or create) the remote-access token. Every browser that signed in with the old one has to use the new link.
        let user = {};
        try { user = readUserFile(); } catch { return send(res, 400, { error: "the config file is not valid JSON: fix it in Advanced first" }), true; }
        const next = { ...user, server: { ...(user.server || {}), accessToken: crypto.randomBytes(32).toString("base64url") } };
        const check = checkSettings(next);
        if (!check.ok) return send(res, 400, { error: `${check.key}: ${check.message}`, key: check.key, message: check.message }), true;
        const backup = writeConfig(next);
        try { reloadConfig(); } catch (e) { return send(res, 500, { error: `saved, but reloading failed: ${e.message}`, backup }), true; }
        return send(res, 200, { ok: true, accessToken: getConfig().server.accessToken, backup, backups: backups() }), true;
      }
      if (route === "settings") {
        const body = await readBody(req);
        let prev = {};
        try { prev = readUserFile(); } catch { /* a broken file is replaced */ }
        const next = unmask(body, prev);
        const check = checkSettings(next);
        if (!check.ok) return send(res, 400, { error: `${check.key}: ${check.message}`, key: check.key, message: check.message }), true;
        const remote = remoteAuthProblem(check.settings.server);
        if (remote) return send(res, 400, { error: remote, key: "server.accessToken", message: remote }), true;
        const before = JSON.stringify(getConfig().ui);
        const backup = writeConfig(next);
        let restartRequired = false;
        try {
          const old = getConfig();
          const fresh = reloadConfig();
          try { reloaded(); } catch { /* best effort: removed projects stop polling */ }
          // Everything but the UI strings was read once at start-up by the data side (watchers, board, ci).
          const strip = (c) => JSON.stringify({ server: c.server, tools: c.tools, machine: c.machine, github: c.github, projects: c.projects });
          restartRequired = strip(old) !== strip(fresh);
        } catch (e) { return send(res, 500, { error: `saved, but reloading failed: ${e.message}`, backup }), true; }
        broadcast("config", { at: Date.now(), uiChanged: before !== JSON.stringify(getConfig().ui), ui: publicConfig().ui });
        localCache = null;
        return send(res, 200, { ok: true, backup, restartRequired, backups: backups() }), true;
      }
      if (route === "devices") {
        const c = getConfig();
        return send(res, 200, { local: await localDevice(url.searchParams.has("refresh")), machines: c.machine.machines.map((m) => ({ id: m.id, label: m.label, sshAlias: m.ssh })) }), true;
      }
      if (route === "test") {
        const body = await readBody(req);
        const alias = body && typeof body.sshAlias === "string" ? body.sshAlias : "";
        if (!ALIAS_RE.test(alias)) return send(res, 400, { error: "sshAlias must be an ssh config alias ([\\w][\\w.@-]{0,63})" }), true;
        return send(res, 200, await probeSsh(alias)), true;
      }
      if (route === "setup" || route === "instructions" || route === "done") {
        // "Set up selam-deck in this project" (server/setup.mjs): the project is the /api/p/<id>/ one, its folder comes from the config.
        const proj = projectById(pid);
        if (!proj) return send(res, 404, { error: "unknown project" }), true;
        const lang = getConfig().ui.lang;
        if (route === "setup" && method === "GET") return send(res, 200, setupStatus(proj.repoPath, lang)), true;
        const body = (await readBody(req)) || {};
        const out = route === "done" ? finishSetup(proj.repoPath) : route === "setup"
          ? doSetup(proj.repoPath, lang, { gitignore: body.gitignore !== false })
          : addInstructions(proj.repoPath, Array.isArray(body.files) ? body.files.map(String) : [], { create: body.create === true });
        await refresh(pid).catch(() => {});
        return send(res, 200, { ok: true, ...out, status: setupStatus(proj.repoPath, lang) }), true;
      }
      if (route === "detect") {
        const body = await readBody(req);
        const r = await detectProject(body?.path);
        return send(res, r.status, r.body), true;
      }
    } catch (e) {
      return send(res, e.status || 500, { error: e.message || "error" }), true;
    }
    return false;
  }
  return { handle };
}
