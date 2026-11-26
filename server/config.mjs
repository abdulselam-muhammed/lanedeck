// lanedeck configuration: ONE module every other part of the server (and, through /api/config and the root layout,
// the client) reads. No project, person or machine is named in code; the defaults below are generic.
//
// Load order: built-in defaults <- JSON file. The file is $LANEDECK_CONFIG, else the per-user path
// (Windows %APPDATA%/lanedeck/config.json, else $XDG_CONFIG_HOME/lanedeck/config.json or ~/.config/lanedeck/config.json).
// Objects are merged deeply, arrays and scalars are replaced. A bad value stops the server with a message naming the key.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isWin } from "./platform.mjs";
import { protocolDirName } from "./protocol.mjs";
import { SECTIONS as NOTIFY_SECTIONS } from "./notify/logic.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(HERE, "..");

const DEFAULTS = {
  // accessToken: required for every request that does not come straight from this machine (server/guard.mjs); generated and
  // rotated from Settings -> General. allowUnauthenticatedRemote: true accepts remote access with no token (not recommended).
  server: { port: 4280, host: "127.0.0.1", allowedHosts: [], accessToken: null, allowUnauthenticatedRemote: false },
  tools: { gh: null, git: null },
  machine: {
    wslDistro: null, // null = the first distro `wsl -l -q` lists (Windows only)
    ciContainer: null, // docker container of the local CI runner, watched on /load
    runnerImage: "myoung34/github-runner", // regex source: a container with this image is a runner
    runnerName: null, // regex source: ... or with this name (null: detect by image only)
    teamName: null, // regex source: runner names of remote machines
    localLabel: isWin() ? "This PC (WSL)" : "This machine",
    thresholds: { ram: 90, cpu: 85, disk: 95, pagedPoolGB: 4 },
    remoteThresholds: { ram: 90, cpu: 85, disk: 95 },
    machines: [], // [{ id, label, sshAlias }]; server/ci/machines.json ([{id,label,ssh}]) is still read too
  },
  github: { org: null, rateBudgetPerHour: 600 },
  // The Inbox's GitHub tab (server/notify/): your GitHub notifications for the linked repos. pollSeconds is a floor; GitHub's
  // X-Poll-Interval wins when it asks for more. browser: also show a desktop notification for new items (off by default).
  notifications: { github: { enabled: true, sections: [...NOTIFY_SECTIONS], pollSeconds: 60 }, browser: false },
  projects: [],
  ui: { lang: "en", dir: null, title: "lanedeck", brand: null, runnerPrefix: null }, // runnerPrefix: stripped from runner names in the queue pills
};
const PROJECT_DEFAULTS = {
  id: "default",
  name: "Project",
  repoPath: null, // local clone, used for git (merge-tree, fetch)
  repo: null, // "owner/name" on GitHub
  defaultBranch: "main",
  gateCheck: null, // name of the required CI check
  inboxDir: null, // folder of agent result files; default <home>/lanedeck/inbox
  claudeProjectDir: null, // ~/.claude/projects/<dir>; default derived from repoPath
  me: null, // your GitHub login
  reviewers: [], // [{ login, role }]
  boardFiles: [], // files whose conflicts are resolved by the reviewer, not by you
  holds: {}, // { "123": "why this PR is frozen" } (seed of data/prs/holds.json)
  languages: null, // content languages, e.g. ["en", "ar"]: the AI writes every human-facing text in all of them (project.md front matter wins)
  profile: null, // name of a profile folder (<configDir>/profiles/<name>/ or the built-in profiles/<name>/) with project-specific text
  // How the reviewer's comments are read (regex sources, case-insensitive): fail/ask = "needs work from us", pass = "approved, not a request".
  reviewMarkers: { fail: ["CHANGES REQUESTED", "NOT PASS"], ask: ["what is missing", "\\bFIX\\b"], pass: ["^\\W*(APPROVE[DS]?|LGTM)"] },
};

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
function merge(base, over) {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = k in base && isObj(base[k]) && isObj(v) ? merge(base[k], v) : v;
  return out;
}
function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
}

/** The config file location of this OS, ignoring LANEDECK_CONFIG. Legacy: an existing pre-rename "selam-deck" folder is used while no "lanedeck" one exists. */
export function defaultConfigPath() {
  const base = process.platform === "win32" && process.env.APPDATA ? process.env.APPDATA : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  const dir = path.join(base, "lanedeck");
  return path.join(!fs.existsSync(dir) && fs.existsSync(path.join(base, "selam-deck")) ? path.join(base, "selam-deck") : dir, "config.json");
}
export function configPath() {
  if (process.env.LANEDECK_CONFIG) return path.resolve(process.env.LANEDECK_CONFIG);
  return defaultConfigPath();
}

function fail(key, msg) {
  const e = new Error(`lanedeck config: "${key}" ${msg} (file: ${configPath()})`);
  e.key = key; e.detail = msg;
  throw e;
}
const need = (cond, key, msg) => { if (!cond) fail(key, msg); };
const isStr = (v) => typeof v === "string" && v.length > 0;
const strOrNull = (v) => v === null || isStr(v);
const num = (v) => typeof v === "number" && Number.isFinite(v);
function regexSource(key, v) { if (v == null) return; try { new RegExp(v); } catch { fail(key, "is not a valid regular expression"); } }

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
/** The server can be reached from outside this machine: a tunnel / extra Host names, or a non-loopback bind address. */
export const remoteExposed = (s) => (s.allowedHosts?.length ?? 0) > 0 || !LOOPBACK_HOSTS.has(String(s.host).toLowerCase());
/**
 * null, or why the server must not start with these server settings: reachable from outside (allowedHosts / a non-loopback
 * host) with no access token, and allowUnauthenticatedRemote not set. Checked at start (server/index.mjs) and on every save
 * (server/settings.mjs), not in validate(), so the build and the settings page still load a config that has the problem.
 */
export function remoteAuthProblem(s) {
  if (!remoteExposed(s) || s.accessToken || s.allowUnauthenticatedRemote) return null;
  return "server.accessToken is required when server.allowedHosts is set or server.host is not a loopback address: without it every page " +
    "and API is open to anyone who can reach that host. Fix one of: (1) add \"accessToken\" to \"server\" in the config file, a random " +
    "string of 32+ characters, e.g. the output of: node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\" " +
    "(later you can rotate it in Settings -> General); (2) remove server.allowedHosts and bind server.host to 127.0.0.1; " +
    "(3) set server.allowUnauthenticatedRemote to true to accept open remote access (not recommended).";
}

function validate(c) {
  need(Number.isInteger(c.server.port) && c.server.port > 0 && c.server.port < 65536, "server.port", "must be an integer 1-65535");
  need(isStr(c.server.host), "server.host", "must be a non-empty string");
  need(Array.isArray(c.server.allowedHosts) && c.server.allowedHosts.every(isStr), "server.allowedHosts", "must be an array of host strings");
  need(c.server.accessToken === null || (typeof c.server.accessToken === "string" && /^[\w-]{32,256}$/.test(c.server.accessToken)), "server.accessToken", "must be null or a random string of 32-256 characters [A-Za-z0-9_-]");
  need(typeof c.server.allowUnauthenticatedRemote === "boolean", "server.allowUnauthenticatedRemote", "must be true or false");

  need(strOrNull(c.tools.gh) && strOrNull(c.tools.git), "tools", "gh and git must be a path string or null");
  const m = c.machine;
  need(strOrNull(m.wslDistro) && strOrNull(m.ciContainer) && strOrNull(m.teamName), "machine", "wslDistro, ciContainer and teamName must be a string or null");
  need(m.ciContainer == null || /^[\w.-]+$/.test(m.ciContainer), "machine.ciContainer", "must be a docker container name ([\\w.-]+)");
  need(m.wslDistro == null || /^[\w.-]+$/.test(m.wslDistro), "machine.wslDistro", "must be a distro name ([\\w.-]+)");
  regexSource("machine.runnerImage", m.runnerImage); regexSource("machine.runnerName", m.runnerName); regexSource("machine.teamName", m.teamName);
  need(isStr(m.localLabel), "machine.localLabel", "must be a non-empty string");
  for (const k of ["thresholds", "remoteThresholds"]) for (const [n, v] of Object.entries(m[k])) need(num(v) && v > 0, `machine.${k}.${n}`, "must be a positive number");
  need(Array.isArray(m.machines), "machine.machines", "must be an array");
  m.machines.forEach((x, i) => {
    need(isObj(x) && /^[\w-]{1,24}$/.test(String(x.id || "")) && x.id !== "local", `machine.machines[${i}].id`, 'must match [\\w-]{1,24} and not be "local"');
    need(/^[\w][\w.@-]{0,63}$/.test(String(x.sshAlias || x.ssh || "")), `machine.machines[${i}].sshAlias`, "must be an ssh config alias");
  });
  need(strOrNull(c.github.org) && (c.github.org == null || /^[\w.-]+$/.test(c.github.org)), "github.org", "must be an organisation login or null");
  need(num(c.github.rateBudgetPerHour) && c.github.rateBudgetPerHour > 0, "github.rateBudgetPerHour", "must be a positive number");
  const nt = c.notifications;
  need(isObj(nt) && isObj(nt.github), "notifications", "must be { github: { enabled, sections, pollSeconds }, browser }");
  need(typeof nt.github.enabled === "boolean", "notifications.github.enabled", "must be true or false");
  need(Array.isArray(nt.github.sections) && nt.github.sections.every((x) => NOTIFY_SECTIONS.includes(x)) && new Set(nt.github.sections).size === nt.github.sections.length,
    "notifications.github.sections", `must be a list of distinct sections: ${NOTIFY_SECTIONS.join(", ")}`);
  need(Number.isInteger(nt.github.pollSeconds) && nt.github.pollSeconds >= 30 && nt.github.pollSeconds <= 3600, "notifications.github.pollSeconds", "must be a whole number of seconds, 30-3600");
  need(typeof nt.browser === "boolean", "notifications.browser", "must be true or false");
  need(Array.isArray(c.projects), "projects", "must be an array");
  need(new Set(c.projects.map((p) => p.id)).size === c.projects.length, "projects", "ids must be unique");
  c.projects.forEach((p, i) => {
    const k = `projects[${i}]`;
    need(isStr(p.id) && isStr(p.name), `${k}.id/name`, "must be non-empty strings");
    need(/^[\w-]{1,40}$/.test(p.id), `${k}.id`, "must match [\\w-]{1,40} (it is used in the URL)");
    need(p.repo == null || /^[\w.-]+\/[\w.-]+$/.test(p.repo), `${k}.repo`, 'must look like "owner/name"');
    need(strOrNull(p.repoPath) && strOrNull(p.inboxDir) && strOrNull(p.claudeProjectDir) && strOrNull(p.me) && strOrNull(p.gateCheck) && strOrNull(p.profile), k, "path, login, gateCheck and profile fields must be a string or null");
    need(isStr(p.defaultBranch) && /^[\w./-]+$/.test(p.defaultBranch), `${k}.defaultBranch`, "must be a branch name");
    need(p.profile == null || /^[\w-]+$/.test(p.profile), `${k}.profile`, "must be a profile folder name (letters, digits, dashes)");
    need(p.languages == null || (Array.isArray(p.languages) && p.languages.length > 0 && p.languages.every((l) => l === "en" || l === "ar")), `${k}.languages`, 'must be null or a list of "en" / "ar"');
    need(Array.isArray(p.reviewers) && p.reviewers.every((r) => isObj(r) && isStr(r.login)), `${k}.reviewers`, "must be an array of { login, role }");
    need(Array.isArray(p.boardFiles) && p.boardFiles.every(isStr), `${k}.boardFiles`, "must be an array of paths");
    need(isObj(p.reviewMarkers) && ["fail", "ask", "pass"].every((n) => Array.isArray(p.reviewMarkers[n]) && p.reviewMarkers[n].every(isStr)), `${k}.reviewMarkers`, "must be { fail: [...], ask: [...], pass: [...] } with regular-expression strings");
    for (const n of ["fail", "ask", "pass"]) p.reviewMarkers[n].forEach((r, j) => regexSource(`${k}.reviewMarkers.${n}[${j}]`, r));
    need(isObj(p.holds) && Object.values(p.holds).every(isStr), `${k}.holds`, 'must be an object { "123": "reason" }');
  });
  need(c.ui.lang === "ar" || c.ui.lang === "en", "ui.lang", 'must be "ar" or "en"');
  need(c.ui.dir === "rtl" || c.ui.dir === "ltr", "ui.dir", 'must be "rtl" or "ltr"');
  need(isStr(c.ui.title), "ui.title", "must be a non-empty string");
  need(strOrNull(c.ui.brand), "ui.brand", "must be an image path prefix under public/ or null");
  need(strOrNull(c.ui.runnerPrefix), "ui.runnerPrefix", "must be a string or null");
}

function which(name) {
  try {
    const out = execFileSync(process.platform === "win32" ? "where" : "which", [name], { encoding: "utf8", timeout: 5000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    return out.split(/\r?\n/).map((s) => s.trim()).find((s) => s && fs.existsSync(s)) || null;
  } catch { return null; }
}
const WIN_FALLBACK = { gh: "C:/Program Files/GitHub CLI/gh.exe", git: "C:/Program Files/Git/cmd/git.exe" };
function resolveTool(name, configured) {
  if (configured) return configured;
  return which(name) || (process.platform === "win32" && fs.existsSync(WIN_FALLBACK[name]) ? WIN_FALLBACK[name] : name);
}
function detectDistro() {
  if (!isWin()) return null;
  try {
    const buf = execFileSync("wsl.exe", ["-l", "-q"], { timeout: 8000, windowsHide: true, env: { ...process.env, WSL_UTF8: "1" }, stdio: ["ignore", "pipe", "ignore"] });
    const s = (buf.length > 1 && buf[1] === 0 ? buf.toString("utf16le") : buf.toString("utf8")).replace(/\u0000/g, "");
    return s.split(/\r?\n/).map((l) => l.trim()).find((l) => /^[\w.-]+$/.test(l) && !/^docker-desktop/.test(l)) || null;
  } catch { return null; }
}

/** The user's object over the defaults (every project over PROJECT_DEFAULTS), validated. Throws an Error with .key and .detail. */
function withDefaults(user) {
  const c = merge(DEFAULTS, user);
  c.projects = (Array.isArray(c.projects) ? c.projects : []).map((p) => merge(PROJECT_DEFAULTS, p));
  if (!c.projects.length) c.projects = [{ ...PROJECT_DEFAULTS }];
  if (c.ui.dir == null) c.ui.dir = c.ui.lang === "ar" ? "rtl" : "ltr"; // dir follows lang unless the file sets it
  validate(c);
  return c;
}
/** Settings page: check a whole config object. Returns { ok: true, settings } (defaults filled in, nothing derived) or { ok: false, key, message }. */
export function checkSettings(user) {
  if (!isObj(user)) return { ok: false, key: "(root)", message: "must be a JSON object" };
  try { return { ok: true, settings: JSON.parse(JSON.stringify(withDefaults(user))) }; }
  catch (e) { return { ok: false, key: e.key || "(root)", message: e.detail || e.message }; }
}
/** The config file as the user wrote it (or {}), for the settings page. */
export function readUserFile() {
  const file = configPath();
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function build() {
  const file = configPath();
  let user = {};
  if (fs.existsSync(file)) {
    try { user = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); }
    catch (e) { throw new Error(`lanedeck config: ${file} is not valid JSON (${e.message})`); }
    if (!isObj(user)) throw new Error(`lanedeck config: ${file} must contain a JSON object`);
  } else if (process.env.LANEDECK_CONFIG) throw new Error(`lanedeck config: LANEDECK_CONFIG points to ${file}, which does not exist`);
  const c = withDefaults(user);

  // Deprecated env overrides, kept so old launch scripts still work.
  const p0 = c.projects[0];
  if (process.env.PORT) { const n = Number(process.env.PORT); need(Number.isInteger(n) && n > 0 && n < 65536, "PORT (env)", "must be a port number"); c.server.port = n; }
  if (process.env.LANEDECK_HOST) { need(process.env.LANEDECK_HOST.trim() !== "", "LANEDECK_HOST (env)", "must be a non-empty host"); c.server.host = process.env.LANEDECK_HOST.trim(); }
  if (process.env.INBOX_DIR) p0.inboxDir = process.env.INBOX_DIR;
  if (process.env.CLAUDE_PROJECT_DIR) p0.claudeProjectDir = process.env.CLAUDE_PROJECT_DIR;

  // Derived values.
  c.projects.forEach((p, i) => {
    p.inboxExplicit = !!p.inboxDir; // an explicit inboxDir beats the project's .lanedeck/inbox
    p.inboxDir ||= i === 0 ? path.join(os.homedir(), "lanedeck", "inbox") : path.join(os.homedir(), "lanedeck", "inbox", p.id);
    if (!p.claudeProjectDir && p.repoPath) p.claudeProjectDir = path.join(os.homedir(), ".claude", "projects", path.resolve(p.repoPath).replace(/[^A-Za-z0-9]/g, "-"));
    if (i === 0) p.claudeProjectDir ||= path.join(os.homedir(), ".claude", "projects");
  });
  c.tools.gh = resolveTool("gh", c.tools.gh);
  c.tools.git = resolveTool("git", c.tools.git);
  c.machine.wslDistro ||= detectDistro();
  // Machines: config entries, then the legacy server/ci/machines.json; normalised to { id, label, ssh }.
  let legacy = [];
  try { legacy = JSON.parse(fs.readFileSync(path.join(HERE, "ci", "machines.json"), "utf8").replace(/^\uFEFF/, "")); } catch { /* none */ }
  const seen = new Set();
  c.machine.machines = [...c.machine.machines, ...(Array.isArray(legacy) ? legacy : [])]
    .filter((x) => isObj(x) && /^[\w-]{1,24}$/.test(String(x.id || "")) && x.id !== "local" && /^[\w][\w.@-]{0,63}$/.test(String(x.sshAlias || x.ssh || "")) && !seen.has(x.id) && seen.add(x.id))
    .map((x) => ({ id: x.id, label: String(x.label || x.id).slice(0, 40), ssh: String(x.sshAlias || x.ssh) }));
  return deepFreeze(c);
}

/** The loaded config (frozen). Memoised on globalThis so bundled copies (Next) and the custom server share one. */
export function getConfig() { return (globalThis.__laneDeckConfig ??= build()); }
/** Re-read the file into the shared slot. Modules that copied values at start-up (the PR board, the inbox watcher) keep the old ones until a restart. */
export function reloadConfig() { globalThis.__laneDeckConfig = build(); return globalThis.__laneDeckConfig; }
const config = getConfig();
export default config;

/** The first project (the default one: old routes and the first data directory). */
export const project = () => getConfig().projects[0];
/** A configured project by id, or undefined. */
export const projectById = (id) => getConfig().projects.find((p) => p.id === id);

/** Folders searched for `<name>/profile.json`: next to the config file in use, then next to the default config file (when LANEDECK_CONFIG points elsewhere), then the profiles shipped with the deck. */
export const profileDirs = () => [...new Set([path.join(path.dirname(configPath()), "profiles"), path.join(path.dirname(defaultConfigPath()), "profiles"), path.join(ROOT, "profiles")])];
/** Project-specific text (glossary, labels) from <configDir>/profiles/<name>/profile.json or the built-in profiles/<name>/profile.json, or null. */
export function loadProfile(p = project()) {
  const name = p.profile;
  if (!name) return null;
  for (const dir of profileDirs()) {
    try { return JSON.parse(fs.readFileSync(path.join(dir, name, "profile.json"), "utf8").replace(/^﻿/, "")); } catch { /* try the next folder */ }
  }
  return null;
}
/**
 * A profile's text in one language. Any value in a profile may be a plain string or a pair { "en": "...", "ar": "..." }; the pair
 * is resolved to `lang`, else to the other language. Everything else (arrays, objects, numbers) is walked as is.
 */
const LANGS = ["en", "ar"];
const isPair = (v) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 0 && Object.keys(v).every((k) => LANGS.includes(k)) && Object.values(v).every((x) => typeof x === "string");
export function localize(v, lang) {
  if (Array.isArray(v)) return v.map((x) => localize(x, lang));
  if (isPair(v)) return v[lang] ?? v[LANGS.find((l) => l !== lang && v[l] != null)];
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, localize(x, lang)]));
  return v;
}
const publicProject = (p) => ({ id: p.id, name: p.name, repo: p.repo, defaultBranch: p.defaultBranch, me: p.me, reviewers: p.reviewers, boardFiles: p.boardFiles, profile: p.profile, languages: p.languages ?? null });
/** What the client may know: no filesystem paths, hosts or tool paths. */
export function publicConfig() {
  const c = getConfig();
  const p = c.projects[0];
  return {
    project: publicProject(p),
    projects: c.projects.map((x) => { const pr = localize(loadProfile(x), c.ui.lang); return { ...publicProject(x), profileData: pr, hasGlossary: !!(pr && pr.glossary) || !!(x.repoPath && fs.existsSync(path.join(x.repoPath, protocolDirName(x.repoPath), "glossary.md"))) }; }),
    github: { org: c.github.org },
    machine: { wslDistro: c.machine.wslDistro, ciContainer: c.machine.ciContainer, localLabel: c.machine.localLabel },
    ui: c.ui,
    profile: localize(loadProfile(), c.ui.lang),
  };
}
