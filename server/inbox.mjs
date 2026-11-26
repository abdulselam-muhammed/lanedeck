// The agents inbox — the data side of the viewer (moved unchanged from the old server.mjs).
// Imported once by server/index.mjs, which binds the configured host:port and serves the Next.js app beside it.
//
// Two sources:
// - the inbox: every .md file, with its text (the messages written for you);
// - the live agents: Claude Code's subagent records for this project — metadata
//   (name, model, parent agent) and the TAIL of each transcript, read only to
//   tell running from finished and to show the agent's latest step. Nothing is
//   written there, and no transcript content is sent beyond that one line.
import { lstat, readFile, readdir, stat } from "node:fs/promises";
import { watch, openSync, readSync, fstatSync, closeSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import config, { getConfig, projectById } from "./config.mjs";
import { refund, spend } from "./budget.mjs";
import { ts } from "./i18n/server.mjs";
import { protocolDirName, protocolDir, readProtocol, questionsOf } from "./protocol.mjs";
import { archiveSetup } from "./setup.mjs";
import { readPlainAsync, realRoot, unsafeReason } from "./safepath.mjs";

/** Agents touched within this window are listed. */
const WINDOW_MS = 12 * 3600e3;
/** An agent that has not handed back and wrote within this time counts as running. */
const RUNNING_MS = 10 * 60e3;

/**
 * Every .md file in the inbox, with its text and modification time.
 * Protocol mode (the inbox lives in an untrusted project folder): symlinks and junctions are never followed. A symlinked inbox
 * folder (or .lanedeck/) is not read at all, and a symlinked entry is skipped and listed in `skipped` (shown as a protocol
 * warning). `repoPath`: given when INBOX is the project's own .lanedeck/inbox, so every component from the repo down is checked.
 */
async function inboxFiles(INBOX, proto = false, repoPath = null) {
  let names = [];
  if (proto && repoPath) {
    let why = null;
    try { why = unsafeReason(realRoot(repoPath), [protocolDirName(repoPath), "inbox"]); } catch { /* the folder is gone: readdir says so */ }
    if (why) return { files: [], error: `inbox folder not read: ${why}`, skipped: [] };
  }
  try {
    // Protocol mode: files starting with "_" are ignored (inbox/_archive/ is a folder, never listed).
    names = (await readdir(INBOX)).filter((n) => n.toLowerCase().endsWith(".md") && !(proto && n.startsWith("_")));
  } catch {
    return { files: [], error: "inbox folder not found" };
  }
  const skipped = [];
  const files = await Promise.all(
    names.map(async (name) => {
      const path = join(INBOX, name);
      try {
        if (proto) {
          if ((await lstat(path)).isSymbolicLink()) { skipped.push(name); return null; }
          const f = await readPlainAsync(path);
          return f ? { name, text: f.text, mtime: f.mtime, proto: true } : null;
        }
        const [text, info] = await Promise.all([readFile(path, "utf8"), stat(path)]);
        return { name, text, mtime: info.mtimeMs };
      } catch {
        return null; // deleted between readdir and read
      }
    }),
  );
  return { files: files.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name)), ...(proto ? { skipped: skipped.sort() } : {}) };
}

// ---------- live agents ----------
const parsed = new Map(); // transcript path -> { mtimeMs, size, info }

function tailRows(path, bytes = 262144) {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const len = Math.min(bytes, size);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString("utf8").split("\n");
    if (len < size) lines.shift(); // the first line is cut
    return lines.filter(Boolean).flatMap((l) => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });
  } finally {
    closeSync(fd);
  }
}

const oneLine = (s, max = 240) => {
  const line = String(s).split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
  return line.length > max ? line.slice(0, max - 1) + "…" : line;
};

/** How many of an agent's latest tool calls the snapshot carries. */
const RECENT = 5;
const baseName = (p) => String(p ?? "").split(/[\\/]/).filter(Boolean).pop() ?? "";
/**
 * A short, safe line for one tool call: the call's own `description` when it has one,
 * otherwise only what names the target (a file's basename, a search pattern, a host).
 * Never a command, a file's content, a message body or a full URL.
 */
function actionLine(name, input = {}) {
  const pick = (v) => (typeof v === "string" ? oneLine(v, 140) : "");
  if (typeof input.description === "string" && input.description.trim()) return pick(input.description);
  switch (name) {
    case "Read": case "Edit": case "Write": case "MultiEdit": return pick(baseName(input.file_path));
    case "NotebookEdit": return pick(baseName(input.notebook_path));
    case "Grep": case "Glob": return pick(input.pattern);
    case "SendMessage": return pick(input.summary);
    case "WebSearch": case "ToolSearch": return pick(input.query);
    case "Skill": return pick(input.skill);
    case "Artifact": return pick(input.action || "publish");
    case "WebFetch": try { return new URL(input.url).hostname; } catch { return ""; }
    case "SubagentHandback": return "handed its report back";
    default: return "";
  }
}

// ---------- progress: the live work phase of each step ----------
// Every step of a plan (one PR = one commit) goes through the same phases, roughly in this order, looping
// back when a test or a check fails: orient → tests (red) → implement → green → docs & board → Linux-CI
// checks → commit. Each tool call is classified into one phase from its tool name, the Bash/PowerShell
// command text and the written file's path; nothing of that leaves the server, only the phase id.
// PHASE-CLASSIFIER-BEGIN (the unit check and the calibration extract this block)
const PHASES = ["orient", "tests", "impl", "green", "docs", "checks", "commit"];
const GIT_COMMIT = /\bgit(?:\s+(?:-[cC]\s+(?:"[^"]*"|'[^']*'|\S+)|--[\w-]+(?:=\S+)?))*\s+commit\b/;
const isCommitCall = (name, input) => (name === "Bash" || name === "PowerShell") && typeof input?.command === "string"
  && GIT_COMMIT.test(input.command) && !/--dry-run/.test(input.command);
const TEST_PATH = /(\.spec\.|\.test\.|e2e-spec|(^|[\\/])tests?[\\/]|__tests__|_test\.(dart|py|go)\b|[\\/]fixtures[\\/])/i;
const DOCS_PATH = /((^|[\\/])docs[\\/]|\.md\b|postman|changelog|readme|(^|[\\/])INDEX\b|tasks\.json|openapi)/i;
const SCRATCH = /(scratchpad|(^|[\\/])tmp[\\/]|AppData[\\/]Local[\\/]Temp)/i;
const RANK = Object.fromEntries(PHASES.map((p, i) => [p, i]));
const maxPhase = (a, b) => (a == null ? b ?? null : b == null ? a : RANK[b] > RANK[a] ? b : a);
const fileName = (p) => String(p ?? "").split(/[\\/]/).filter(Boolean).pop() ?? "";
/** A scratch helper's role, from its own name (agents edit through small scripts they name for the job). */
function byName(name) {
  const b = name.toLowerCase();
  if (/msg|commit|pr-?body/.test(b)) return "commit";
  if (/^(e2e|run|jest|green|verify|env)\b|runner/.test(b)) return null; // a test runner: setting it up is not progress
  if (/check|lint|knip|prettier|conform|tsc|shim/.test(b)) return "checks";
  if (/spec|test|^red\b|^red[_-]/.test(b)) return "tests";
  if (/doc|board|changelog|postman|readme|index|endpoint|defect/.test(b)) return "docs";
  if (/report|hand|probe|measure|dump|inspect|list|find|show|look|read|census|count|diff/.test(b)) return "orient";
  return "impl";
}
/** The phase a write to this path belongs to. */
function writePhase(path) {
  const p = String(path ?? "").replace(/^["']|["']$/g, "");
  if (SCRATCH.test(p)) return byName(fileName(p));
  if (TEST_PATH.test(p)) return "tests";
  if (DOCS_PATH.test(p)) return "docs";
  return "impl";
}
/** An inline script (a heredoc body): the phase of what it edits, or "orient" when it only reads. */
function inlineScript(body) {
  if (!/\.write\(|write_text|writeFileSync|['"]w['"]|\bresolve\(|\.replace\(|\bsub\(/.test(body)) return "orient";
  const kinds = [...body.matchAll(/['"]([^'"\n]*\.(?:ts|tsx|js|mjs|cjs|json|md|dart|php|py|sql|ya?ml|css|html))['"]/g)]
    .map((m) => writePhase(m[1])).filter(Boolean);
  if (!kinds.length) return "impl";
  return kinds.includes("impl") ? "impl" : kinds.includes("tests") ? "tests" : kinds[0];
}
const READS_FIRST = /^(cat|sed\s+-n|grep|rg|head|tail|ls|wc|git\s+(show|log|diff|grep))\b/i;
/** One sub-command (no `&&`, `;`, `|`) → its phase. */
function subPhase(s, reachedImpl) {
  s = s.trim().replace(/^(?:(?:export\s+)?[A-Z_][A-Z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+)+/, "");
  if (!s || /^(cd|set-location|pushd|popd|\$[\w:]+\s*=|export|set|source)\b/i.test(s)) return null;
  const testRun = reachedImpl ? "green" : "tests"; // before any source change a test run is the red run
  if (/\b(jest|vitest|pytest|playwright\s+test|flutter\s+test|dart\s+test)\b|jest\.js|\b(pnpm|npm|yarn)\b.*\btest\b|e2e[\w-]*\.sh/i.test(s) && !READS_FIRST.test(s)) return testRun;
  if (/\b(createdb|dropdb)\b|\b(create|drop)\s+database\b/i.test(s)) return testRun;
  if (/\b(prettier|eslint|tsc|knip|depcruise|typecheck)\b|\b(pnpm|npm|yarn)\b.*\b(lint|format|knip|typecheck)\b|posix|check-[\w-]+\.(mjs|js|py|sh)|spec-(coverage|per-file)|\b(dart|flutter)\s+(analyze|format)\b/i.test(s)
    && !READS_FIRST.test(s)) return "checks";
  if (/\b(endpoint-index|sync-board|defect-index)\b/i.test(s) && !READS_FIRST.test(s)) return "docs";
  const git = s.match(/^git\s+(?:-[cC]\s+\S+\s+)*([\w-]+)/i);
  if (git) {
    const v = git[1].toLowerCase();
    if (v === "commit" || v === "add") return "commit";
    if (/^(apply|mv|rm|restore)$/.test(v) || (v === "checkout" && /\s--\s/.test(s))) {
      const t = s.split(/\s+/).filter((w) => /[\\/.]/.test(w) && !w.startsWith("-")).pop();
      return t ? writePhase(t) : "impl";
    }
    return "orient"; // show, log, diff, status, grep, fetch, branch, checkout -b, rebase…
  }
  if (/^sed\s+(-\w*i|--in-place)|^perl\s+-\w*i/i.test(s)) return writePhase(s.split(/\s+/).pop());
  const run = s.match(/^(?:python3?|py|node|bash|sh|pwsh|powershell|&)\s+(?:-\w+\s+)*["']?([^\s"';|&]+\.(?:py|mjs|js|cjs|sh|ps1))/i);
  if (run) return /node_modules/.test(run[1]) ? "orient" : byName(fileName(run[1]));
  const redirect = s.match(/(?:^|\s)>>?\s*["']?([^\s"';&|]+)/);
  const sink = redirect && /^(\/dev\/null|\$null|nul|&\d)$/i.test(redirect[1]);
  if ((redirect && !sink && !/^(echo|printf)\b/i.test(s)) || /^(tee|cp|mv|touch|rm|new-item|set-content|out-file|copy-item|move-item|remove-item)\b/i.test(s)) {
    return writePhase(redirect && !sink ? redirect[1] : s.split(/\s+/).pop());
  }
  return "orient";
}
/**
 * One tool call → a phase id, or null (neutral: todo lists, messages, waits, task output).
 * `reachedImpl`: a source file was changed in this step, so a test run is the green run, not the red one.
 */
function classifyCall(name, input = {}, reachedImpl = false) {
  switch (name) {
    case "Read": case "Grep": case "Glob": case "WebFetch": case "WebSearch": case "LS": return "orient";
    case "Write": case "Edit": case "MultiEdit": return writePhase(input.file_path);
    case "NotebookEdit": return writePhase(input.notebook_path);
    case "Bash": case "PowerShell": break;
    default: return null;
  }
  let c = String(input.command ?? "");
  if (isCommitCall(name, input)) return "commit";
  let wrote = null; // what an inline script (a heredoc body) edits
  c = c.replace(/<<-?\s*['"]?(\w+)['"]?([^\n]*)\n([\s\S]*?)\n\s*\1\s*(?=\n|$)/g, (_, tag, rest, body) => {
    const p = inlineScript(body);
    if (p !== "orient") wrote = maxPhase(wrote, p);
    return rest;
  });
  let ran = null, check = false, other = null;
  for (const s of c.split(/&&|\|\||;|\||\n/)) {
    const p = subPhase(s, reachedImpl);
    if (p === "checks") check = true;
    else if (p === "tests" || p === "green") ran = p;
    else other = maxPhase(other, p);
  }
  // A type-check or format run in the same command as an edit or a test run verifies THAT work:
  // the edit (or the test run) is the phase, not the CI checks.
  const work = maxPhase(maxPhase(wrote, other === "orient" ? null : other), ran);
  if (work) return work;
  return check ? "checks" : other;
}
// Calibrated on 205 commit-closed steps (8+ calls) of 52 finished builder/fix agents (2026-09-29 → 10-05): where in a
// step (by tool calls) the furthest phase first reaches each phase (median), and how many calls a step
// usually spends in it (median) — the creep constant: 63% of the band after that many calls.
const BAND_START = { orient: 0, tests: 0.12, impl: 0.17, green: 0.30, docs: 0.43, checks: 0.58, commit: 0.96 };
const BAND_TAU = { orient: 8, tests: 5, impl: 6, green: 14, docs: 11, checks: 33, commit: 2 };
/** After the last step's commit: the full suites, the clean-up and the hand-back (median 7 calls). */
const VERIFY_TAU = 7, VERIFY_CEIL = 0.97;
/** A fresh step: no classified call yet. */
const newStep = () => ({ far: -1, inBand: 0, calls: 0 });
/** Feed one tool call into a step's state; the furthest phase never moves back inside a step. */
function stepAdd(st, name, input) {
  const ph = classifyCall(name, input, st.far >= RANK.impl);
  if (!ph) return st;
  st.calls++;
  const k = RANK[ph];
  if (k > st.far) { st.far = k; st.inBand = 1; } else st.inBand++;
  return st;
}
/** A step's fraction: the start of its furthest phase's band, creeping towards the next band (never reaching it). */
function stepFraction(st) {
  if (st.far < 0) return 0;
  const id = PHASES[st.far];
  const lo = BAND_START[id], hi = st.far + 1 < PHASES.length ? BAND_START[PHASES[st.far + 1]] : 1;
  return lo + (hi - lo) * (1 - Math.exp(-st.inBand / BAND_TAU[id]));
}
const verifyFraction = (st) => VERIFY_CEIL * (1 - Math.exp(-st.calls / VERIFY_TAU));
// PHASE-CLASSIFIER-END

// ---------- a transcript, read incrementally: successful commits + the live step ----------
// A commit counts when a Bash/PowerShell `git commit` (also `git -c k=v commit`, `git -C dir commit`) gets a
// tool_result that is not an error; it closes the step. Only the bytes added since last time are read.
const scanState = new Map(); // transcript path -> { offset, pending: Set<tool_use_id>, commits, step, whole }

function scanTranscript(path, size) {
  let st = scanState.get(path);
  if (!st || size < st.offset) st = { offset: 0, pending: new Set(), commits: 0, step: newStep(), whole: newStep() };
  scanState.set(path, st);
  if (size === st.offset) return st;
  const fd = openSync(path, "r");
  try {
    const len = size - st.offset;
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, st.offset);
    const cut = buf.lastIndexOf(10); // whole lines only; a half-written last line waits for the next read
    if (cut < 0) return st;
    st.offset += cut + 1;
    for (const line of buf.subarray(0, cut + 1).toString("utf8").split("\n")) {
      if (!line) continue;
      const isUse = line.includes('"tool_use"');
      const isResult = line.includes('"tool_result"') && st.pending.size > 0;
      if (!isUse && !isResult) continue;
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      const content = row.message?.content;
      if (!Array.isArray(content)) continue;
      for (const b of content) {
        if (row.type === "assistant" && b.type === "tool_use" && typeof b.name === "string") {
          stepAdd(st.step, b.name, b.input ?? {});
          stepAdd(st.whole, b.name, b.input ?? {});
          if (isCommitCall(b.name, b.input)) st.pending.add(b.id);
        } else if (row.type === "user" && b.type === "tool_result" && st.pending.has(b.tool_use_id)) {
          st.pending.delete(b.tool_use_id);
          if (!b.is_error) { st.commits++; st.step = newStep(); } // the commit closes the step
        }
      }
    }
  } finally {
    closeSync(fd);
  }
  return st;
}

async function readAgent(path, session) {
  const info = await stat(path);
  const hit = parsed.get(path);
  if (hit && hit.mtimeMs === info.mtimeMs && hit.size === info.size) return hit.info;
  const id = path.replace(/^.*agent-|\.jsonl$/g, "");
  let meta = {};
  let startedAt = info.birthtimeMs;
  try {
    const metaPath = path.replace(/\.jsonl$/, ".meta.json");
    meta = JSON.parse(await readFile(metaPath, "utf8"));
    startedAt = (await stat(metaPath)).mtimeMs; // rewritten when the agent is resumed
  } catch {}
  let rows = [];
  try {
    rows = tailRows(path);
  } catch {}
  let step = "";
  const recent = []; // the latest tool calls, oldest first: { tool, desc, at }
  let lastAssistant = null;
  let lastAssistantAt = -1;
  let lastInstructionAt = -1; // a message to the agent (not a tool result): it has work again
  rows.forEach((r, i) => {
    const content = r.message?.content;
    if (r.type === "user") {
      const text = typeof content === "string" ? content : Array.isArray(content) ? content.filter((b) => b.type === "text").map((b) => b.text).join("") : "";
      if (text.trim()) lastInstructionAt = i;
      return;
    }
    if (r.type !== "assistant" || !Array.isArray(content)) return;
    lastAssistant = r;
    lastAssistantAt = i;
    for (const b of content) {
      if (b.type === "text" && b.text?.trim()) step = oneLine(b.text);
      else if (b.type === "tool_use" && typeof b.input?.description === "string" && b.name !== "SubagentHandback") step = oneLine(b.input.description);
      if (b.type === "tool_use" && typeof b.name === "string") {
        recent.push({ tool: b.name, desc: actionLine(b.name, b.input ?? {}), at: Date.parse(r.timestamp) || null });
        if (recent.length > RECENT) recent.shift();
      }
    }
  });
  const blocks = Array.isArray(lastAssistant?.message?.content) ? lastAssistant.message.content : [];
  const pending = lastInstructionAt > lastAssistantAt;
  const handedBack = !pending && blocks.some((b) => b.type === "tool_use" && b.name === "SubagentHandback");
  // Ended its turn without handing back: it waits for a subagent, or (older agents) that was its answer.
  const endedTurn = !pending && !handedBack && lastAssistant?.message?.stop_reason === "end_turn" && !blocks.some((b) => b.type === "tool_use");
  const result = {
    id,
    session,
    name: meta.description || id,
    model: meta.model ?? null,
    type: meta.agentType ?? null,
    parent: meta.parentAgentId ?? null,
    depth: meta.spawnDepth ?? 1,
    branch: meta.worktreeBranch ?? null,
    startedAt,
    lastAt: info.mtimeMs,
    handedBack,
    endedTurn,
    step,
    recent,
  };
  try {
    const sc = scanTranscript(path, info.size);
    result.commits = sc.commits;
    // only the phase state, never what the calls were
    result.live = { step: { ...sc.step }, whole: { ...sc.whole } };
  } catch {
    result.commits = 0;
    result.live = null;
  }
  parsed.set(path, { mtimeMs: info.mtimeMs, size: info.size, info: result });
  return result;
}

// ---------- stopped agents: the parent session's task notifications ----------
// A subagent stopped from outside (TaskStop) never writes an end to its own transcript; the only record is the
// parent's <task-notification> with <status>killed</status>. Read the parent transcript incrementally (it is large)
// and keep each task id's latest status, with when it was seen.
const TASK_NOTE = /<task-id>([A-Za-z0-9_-]+)<\/task-id>[\s\S]{0,700}?<status>([a-z_]+)<\/status>/g;
const noteScan = new Map(); // session -> { offset, carry, status: Map<id, {status, at}> }
function taskStatuses(PROJECT, session) {
  const path = join(PROJECT, session + ".jsonl");
  let st = noteScan.get(path);
  if (!st) noteScan.set(path, (st = { offset: 0, carry: "", status: new Map() }));
  let fd;
  try {
    fd = openSync(path, "r");
    const size = fstatSync(fd).size;
    if (size < st.offset) Object.assign(st, { offset: 0, carry: "", status: new Map() }); // rewritten
    const CHUNK = 4 << 20;
    while (st.offset < size) {
      const len = Math.min(CHUNK, size - st.offset);
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, st.offset);
      st.offset += len;
      const text = st.carry + buf.toString("utf8");
      const cut = text.lastIndexOf("\n"); // whole lines only; the rest waits for the next read
      const whole = cut >= 0 ? text.slice(0, cut) : "";
      st.carry = cut >= 0 ? text.slice(cut + 1) : text;
      if (st.carry.length > 8 << 20) st.carry = ""; // a runaway line: drop it rather than grow forever
      for (const line of whole.split("\n")) {
        if (!line.includes("<task-notification>")) continue;
        const at = Date.parse(/"timestamp":"([^"]+)"/.exec(line)?.[1] ?? "") || Date.now();
        for (const m of line.matchAll(TASK_NOTE)) st.status.set(m[1], { status: m[2], at });
      }
    }
  } catch {
  } finally {
    if (fd !== undefined) try { closeSync(fd); } catch {}
  }
  return st.status;
}

async function liveAgents(PROJECT, { windowMs = WINDOW_MS, cap = Infinity } = {}) {
  const since = Date.now() - windowMs;
  const out = [];
  const found = []; // { path, m, session }
  let sessions = [];
  try {
    sessions = (await readdir(PROJECT, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
  for (const session of sessions) {
    const dir = join(PROJECT, session, "subagents");
    let names = [];
    try {
      names = (await readdir(dir)).filter((n) => n.startsWith("agent-") && n.endsWith(".jsonl"));
    } catch {
      continue;
    }
    const fresh = await Promise.all(names.map(async (n) => {
      const path = join(dir, n);
      try { const m = (await stat(path)).mtimeMs; return m >= since ? { path, m, session } : null; } catch { return null; }
    }));
    for (const f of fresh) if (f) found.push(f);
  }
  found.sort((a, b) => b.m - a.m);
  for (const f of found.slice(0, cap)) {
    try { out.push(await readAgent(f.path, f.session)); } catch {}
  }
  const now = Date.now();
  const notes = new Map();
  for (const a of out) {
    if (!notes.has(a.session)) notes.set(a.session, taskStatuses(PROJECT, a.session));
    const n = notes.get(a.session).get(a.id);
    // Stopped from outside, and no activity of its own since (a resumed agent writes again and is judged as usual).
    a.stopped = !a.handedBack && n?.status === "killed" && a.lastAt <= n.at + 5e3 ? n.at : null;
  }
  for (const a of out)
    a.state = a.handedBack ? "done" : a.stopped ? "stopped" : a.endedTurn ? null : now - a.lastAt < RUNNING_MS ? "run" : "idle";
  // An agent that ended its turn while a subagent of its own still works is waiting for it, not finished.
  const working = (id, seen = new Set()) =>
    out.some((c) => c.parent === id && !seen.has(c.id) && (seen.add(c.id), c.state === "run" || working(c.id, seen)));
  for (const a of out) if (a.state === null) a.state = working(a.id) ? "wait" : "done";
  return out.sort((a, b) => b.lastAt - a.lastAt);
}

// ---------- progress: the plan in the agent's inbox file + live commits (an estimate) ----------
const AGENT_LINE = /^\*\*[^*\n]*agent[^*\n]*:\*\*([^\n]*)$/gim;
const cleanItem = (t) => t.replace(/\*\*|__|`/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim();
/** The `## Steps` (or Arabic) checklist of an inbox file: [{ text, done }] ([] when it has none). */
function planOf(text, proto = false) {
  const items = [];
  let inPlan = false;
  for (const l of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^#{1,6}\s/.test(l)) { inPlan = (proto ? /^##\s+(?:\u0627\u0644\u062e\u0637\u0648\u0627\u062a|Steps)\s*$/i : /^##\s+\u0627\u0644\u062e\u0637\u0648\u0627\u062a\s*$/).test(l.trim()); continue; }
    if (!inPlan) continue;
    const m = l.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/);
    if (m) items.push({ text: cleanItem(m[2]), done: m[1] !== " " });
  }
  return items;
}
/** The plan's closing item — the full suites and the report — runs the verify & report phase, not the step phases. */
const VERIFY_ITEM = /\u0627\u0644\u0641\u062d\u0648\u0635|\u0627\u0644\u062a\u0642\u0631\u064a\u0631|\u062a\u0642\u0631\u064a\u0631|\u0627\u0644\u062a\u062d\u0642\u0642|verif|report|hand-?back/i;
const phaseOut = (id, index) => ({ id, label: ts("inbox.phase." + id), index });
/**
 * completed steps = max(checked, min(commits, total - 1)) (every step once the agent is done; a step I tick
 * after a report and the commit that made it are the same step, so they are not added).
 * pct = (completed + stepFraction) / total, where stepFraction is the live phase of the current step
 * (calls since the last successful commit). Below 100 until the agent is done.
 * No plan: the whole job is one step, phases counted since the start (no reset at commits).
 */
function progressOf(plan, agent) {
  const state = agent.state, commits = agent.commits ?? 0;
  const live = agent.live ?? { step: newStep(), whole: newStep() };
  const finished = state === "done";
  const total = plan.length;
  if (!total) {
    const st = live.whole;
    if (finished) return { done: 1, total: 1, pct: 100, pctExact: 100, stepFraction: 1, phase: null, items: [], source: "none", estimate: "none" };
    if (st.calls === 0) return { done: 0, total: 1, pct: 0, pctExact: 0, stepFraction: 0, phase: null, items: [], source: "none", estimate: "none" };
    const f = stepFraction(st);
    return { done: 0, total: 1, pct: Math.floor(f * 100), pctExact: f * 100, stepFraction: f, phase: phaseOut(PHASES[Math.max(0, st.far)], Math.max(0, st.far)),
      items: [], source: "phase", estimate: "phase" };
  }
  const checked = plan.filter((i) => i.done).length;
  const done = finished ? total : Math.max(checked, Math.min(commits, total - 1));
  let extra = done - checked; // finished by commits: the next unchecked steps, in order
  const items = plan.map((i) => (i.done || finished ? { text: i.text, done: true } : { text: i.text, done: extra-- > 0 }));
  if (finished) return { done, total, pct: 100, pctExact: 100, stepFraction: 1, phase: null, items, source: "plan", estimate: "plan" };
  const cur = items.findIndex((i) => !i.done);
  const verify = total > 1 && cur === total - 1 && VERIFY_ITEM.test(items[cur].text);
  const st = live.step;
  const f = verify ? verifyFraction(st) : stepFraction(st);
  const phase = verify ? phaseOut("verify", PHASES.length) : phaseOut(PHASES[Math.max(0, st.far)], Math.max(0, st.far));
  const exact = ((done + f) / total) * 100;
  return { done, total, pct: Math.floor(exact), pctExact: exact, stepFraction: f, phase, items, source: "plan", estimate: "plan" };
}
/** Per-agent high-water mark (in memory): the bar never goes back between snapshots; reset when the plan's size changes. */
const highWater = new Map(); // agent id -> { total, pct }
function holdHigh(id, p) {
  const hw = highWater.get(id);
  if (!hw || hw.total !== p.total || hw.source !== p.source) { highWater.set(id, { total: p.total, source: p.source, pct: p.pctExact }); return p; }
  if (p.pctExact >= hw.pct) { hw.pct = p.pctExact; return p; }
  return { ...p, pctExact: hw.pct, pct: Math.floor(hw.pct), held: true };
}
const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
function withProgress(files, agents, ns = "") {
  const plans = new Map(); // agent id -> the plan of the first file that names it first (as the page links them)
  for (const f of files) {
    const id = [...f.text.replace(/\r\n?/g, "\n").matchAll(AGENT_LINE)].flatMap((m) => m[1].match(/\ba[0-9a-f]{16}\b/g) || [])[0];
    if (id && !plans.has(id)) plans.set(id, planOf(f.text, !!f.proto));
  }
  return agents.map(({ live, ...a }) => {
    let p = holdHigh(ns + a.id, progressOf(plans.get(a.id) || [], { ...a, live }));
    if (a.state !== "done" && p.pctExact > 99.4) p = { ...p, pctExact: 99.4, pct: 99 }; // never 100 before the hand-back
    return { ...a, progress: { ...p, pctExact: round(p.pctExact, 2), stepFraction: round(p.stepFraction, 3) } };
  });
}

const hashOf = (x) => createHash("sha1").update(JSON.stringify(x)).digest("hex");

// ---------- every project's agents, for the machine pages ----------
// ~/.claude/projects/* : each directory is one Claude Code project. An agent is tagged with the configured project whose
// claudeProjectDir is that directory, or "other". Bounded: the last 48 h and at most AGENTS_CAP agents per directory.
const ALL_WINDOW_MS = 48 * 3600e3;
const AGENTS_CAP = 60;
const normDir = (p) => String(p ?? "").replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();
let allCache = null; // { at, value }
let allBusy = null;
async function computeAllAgents() {
  const root = join(homedir(), ".claude", "projects");
  let dirs = [];
  try { dirs = (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return { agents: [], projects: [] }; }
  const cfg = getConfig().projects;
  const byDir = new Map(cfg.map((p) => [normDir(p.claudeProjectDir), p.id]));
  const out = [];
  for (const d of dirs) {
    const full = join(root, d);
    const id = byDir.get(normDir(full)) ?? null;
    const list = await liveAgents(full, { windowMs: ALL_WINDOW_MS, cap: AGENTS_CAP });
    if (!list.length) continue;
    // A configured project with a running inbox gives its plans (checklists), so the bar matches that project's page.
    const files = id && instances.has(id) ? instances.get(id).files() : [];
    for (const a of withProgress(files, list, "g:")) out.push({ ...a, project: id ?? "other", dir: d });
  }
  out.sort((a, b) => b.lastAt - a.lastAt);
  return { agents: out, projects: [...cfg.map((p) => p.id), "other"] };
}
/** GET /api/agents: every project's agents (cached 3 s so several pages polling share one scan). */
export async function allAgents() {
  if (allCache && Date.now() - allCache.at < 3000) return allCache.value;
  allBusy ??= computeAllAgents().then((value) => { allCache = { at: Date.now(), value: { ...value, now: Date.now() } }; return allCache.value; }).finally(() => { allBusy = null; });
  return allBusy;
}

const QID = /^##\s+[A-Z]{1,8}\d{1,3}\b/;
/** Open "## ID — ..." questions in the inbox files (README excluded), the same rule the page applies. */
const countQuestions = (files) => files.filter((f) => !/^00-README/i.test(f.name)).reduce((n, f) => n + (f.proto ? questionsOf(f.text).filter((q) => !q.answered).length : 0) + (f.proto ? 0 : f.text.replace(/\r\n?/g, "\n").split("\n").filter((l) => QID.test(l)).length), 0);

// ---------- one inbox per project ----------
// Each project has: its inbox folder watcher, its live agents (12 h), its SSE clients and its default-branch check. The first
// project starts with the server; the others start the first time a request names them (getInbox).
const instances = new Map();
const globalSticky = new Map(); // topic -> last JSON text (ci.runners ...): the same for every project, replayed to a new inbox

function createInbox(P) {
  // Protocol mode: the repo has a .lanedeck/ folder (docs/PROTOCOL.md). Its inbox/ is the inbox unless the config sets inboxDir.
  // Re-evaluated on every read, so a project that gets its .lanedeck/ folder (the setup dialog, or by hand) switches to
  // protocol mode without a restart.
  let PDIR = null, INBOX = P.inboxDir;
  const watchers = [];
  function syncMode() {
    const d = protocolDir(P.repoPath);
    const inbox = d && !P.inboxExplicit ? join(d, "inbox") : P.inboxDir;
    if (d === PDIR && inbox === INBOX && watchers.length) return;
    PDIR = d; INBOX = inbox;
    for (const w of watchers.splice(0)) try { w.close(); } catch {}
    try { watchers.push(watch(INBOX, { persistent: true }, () => broadcast())); } catch (error) { if (error?.code !== "ENOENT") console.error("cannot watch", INBOX, error.message); } // a folder that does not exist yet (new config) is not an error: the page already says so
    if (PDIR) try { watchers.push(watch(PDIR, { persistent: true }, () => broadcast())); } catch (error) { console.error("cannot watch", PDIR, error.message); }
  }
  const PROJECT = P.claudeProjectDir;
  const BRANCH = P.defaultBranch;
  let lastSnapshot = null;
  const clients = new Set();
  const sticky = new Map(); // topic -> last JSON text, replayed to a new client
  for (const [k, v] of globalSticky) sticky.set(k, v);

  async function computeSnapshot() {
    syncMode();
    const own = PDIR && !P.inboxExplicit ? P.repoPath : null; // the inbox is the project's .lanedeck/inbox: check it from the repo down
    let [inbox, agents] = await Promise.all([inboxFiles(INBOX, !!PDIR, own), PROJECT ? liveAgents(PROJECT) : []]);
    let protocol = PDIR ? await readProtocol(PDIR, inbox.files ?? [], inbox.skipped, P.languages) : undefined; // undefined: legacy mode, the snapshot is unchanged
    // The finished setup file archives itself (only that file; see server/setup.mjs).
    const setup = PDIR && (inbox.files ?? []).find((f) => f.name === "00-setup.md");
    if (setup && archiveSetup(INBOX, setup, P.repoPath)) {
      inbox = await inboxFiles(INBOX, true, own);
      protocol = await readProtocol(PDIR, inbox.files ?? [], inbox.skipped, P.languages);
    }
    delete inbox.skipped;
    return { inbox: INBOX, ...inbox, agents: withProgress(inbox.files ?? [], agents), protocol, now: Date.now() };
  }
  // ---------- live events (ONE transport: SSE on /api/p/<id>/events) ----------
  // Typed events, each naming the slice that changed; the client patches only that slice:
  //   snapshot   the whole state ({inbox,files,agents,error}); on connect/reconnect, and as the 15 s safety net ONLY when
  //              something changed since the last snapshot was sent
  //   protocol   the .lanedeck/ data (project.md, map.md, glossary, warnings) when it changed; protocol-mode projects only
  //   inbox      {changed:[file], removed:[name], error}   the files that differ from what the clients have
  //   agents     {changed:[agent], removed:[id]}            the live agents that differ
  //   ci.runners the runners summary (busy/total/queued/ours) -- published by server/index.mjs from the CI reader
  //   branch         the default-branch check of THIS project
  //   ping       every 20 s, so a silent (half-open) connection is noticed by the client
  const write = (res, type, text) => { try { res.write(`event: ${type}\ndata: ${text}\n\n`); } catch {} };
  const sendAll = (type, data) => { const t = JSON.stringify(data); for (const res of clients) write(res, type, t); };
  function publish(type, data) {
    const t = JSON.stringify(data);
    if (sticky.get(type) === t) return false;
    sticky.set(type, t);
    for (const res of clients) write(res, type, t);
    return true;
  }

  let sentSnapHash = "";
  let current = null; // what the clients have: { files: Map(name -> file json), agents: Map(id -> agent json) }
  let busy = false, again = false;
  /** Re-read the inbox + the live agents, diff against `current`, emit one typed event per changed slice. Never overlaps itself:
   *  a change that arrives while a read is running triggers one more read after it (a stale in-flight result is never final). */
  async function refresh() {
    if (busy) { again = true; return; }
    busy = true;
    try {
      do {
        again = false;
        let s;
        try { s = await computeSnapshot(); } catch (e) { console.error(e); continue; }
        lastSnapshot = s;
        const files = new Map((s.files ?? []).map((f) => [f.name, JSON.stringify(f)]));
        const agents = new Map(s.agents.map((a) => [a.id, JSON.stringify(a)]));
        if (current) {
          const changed = [], removed = [];
          for (const [n, j] of files) if (current.files.get(n) !== j) changed.push(JSON.parse(j));
          for (const n of current.files.keys()) if (!files.has(n)) removed.push(n);
          if (changed.length || removed.length || current.error !== (s.error ?? null)) sendAll("inbox", { changed, removed, error: s.error ?? null });
          const ac = [], ar = [];
          for (const [i, j] of agents) if (current.agents.get(i) !== j) ac.push(JSON.parse(j));
          for (const i of current.agents.keys()) if (!agents.has(i)) ar.push(i);
          if (ac.length || ar.length) sendAll("agents", { changed: ac, removed: ar });
        }
        const pj = JSON.stringify(s.protocol ?? null);
        if (current && current.protocol !== pj) sendAll("protocol", s.protocol ?? null);
        current = { files, agents, error: s.error ?? null, protocol: pj };
      } while (again);
    } finally { busy = false; }
  }
  const quickSnapshot = async () => {
    if (!lastSnapshot) await refresh();
    return { ...lastSnapshot, now: Date.now() };
  };

  let pending = null;
  function broadcast() {
    clearTimeout(pending);
    pending = setTimeout(refresh, 150);
  }
  syncMode();
  // Agents change every few seconds while they work (transcripts are outside the inbox, so no watcher sees them).
  const timers = [];
  timers.push(setInterval(refresh, 4000));
  // Safety net (editors whose saves fs.watch misses; a missed event): every 15 s a full snapshot, sent only if its hash changed
  // since the last snapshot was sent. (The typed diff above already covers real changes; this resyncs a client that lost one.)
  timers.push(setInterval(() => {
    if (!clients.size || !lastSnapshot) return;
    const { now, ...rest } = lastSnapshot; void now;
    const h = hashOf(rest);
    if (h === sentSnapHash) return;
    sentSnapHash = h;
    sendAll("snapshot", { ...rest, now: Date.now() });
  }, 15000));
  refresh().catch(() => {});
  timers.push(setInterval(() => sendAll("ping", { t: Date.now() }), 20000));

  // ---------- default-branch watch: our last pull of origin/<branch> vs the branch on GitHub now ----------
  // No repoPath = no local clone: the local side (fetch, reflog, git log) is skipped, never run in the dashboard's own folder.
  const REPO = P.repoPath || null;
  const GIT = config.tools.git;
  const GH = config.tools.gh;
  const GH_REPO = P.repo;
  const WHO = `branch:${P.id}`;
  const run = (bin, args) => new Promise((ok) => {
    try {
      const c = execFile(bin, args, { cwd: REPO || undefined, windowsHide: true, maxBuffer: 8 << 20, timeout: 30000 }, (e, out) => ok(e ? null : String(out).trim()));
      c.on("error", () => ok(null));
    } catch { ok(null); }
  });
  /** A GitHub GET that counts against the shared hourly budget and is ETag-cached: { body } | { denied } | { failed }. A 304 costs nothing. */
  const etags = new Map(); // url -> { etag, body }
  const ghGet = (url) => new Promise((resolve) => {
    if (!spend(1, WHO)) return resolve({ denied: true });
    const prev = etags.get(url);
    const args = ["api", "-i", url, ...(prev ? ["-H", `If-None-Match: ${prev.etag}`] : [])];
    run(GH, args).then((out) => {
      if (out == null) { refund(1, WHO); return resolve({ failed: true }); }
      const i = out.search(/\r?\n\r?\n/);
      const head = i < 0 ? out : out.slice(0, i);
      const status = Number((/^HTTP\/[\d.]+\s+(\d+)/m.exec(head) || [])[1] || 0);
      if (status === 304 && prev) { refund(1, WHO); return resolve({ body: prev.body }); }
      if (status !== 200) return resolve({ failed: true });
      try {
        const body = JSON.parse(out.slice(i).trim());
        const etag = (/^etag:\s*(.+?)\s*$/im.exec(head) || [])[1];
        if (etag) etags.set(url, { etag, body });
        resolve({ body });
      } catch { resolve({ failed: true }); }
    });
  });
  /** A plain (uncached) GitHub call, for the paginated per-day list; null when denied or failed. */
  const gh = (args) => (spend(1, WHO) ? run(GH, args) : Promise.resolve(null));
  const commitOf = (c) => ({ sha: c.sha, subject: (c.commit.message || "").split("\n")[0], author: c.commit.author.name, at: c.commit.committer.date, pr: (((c.commit.message || "").split("\n")[0].match(/\(#(\d+)\)\s*$/)) || [])[1] || null });
  // Commit dates of the last 15 days on both sides, for the per-day chart. GitHub's list is cached for 30
  // minutes (a refresh through the pull button always re-reads it); ours is a local read-only git log.
  const lines = (t) => t.split(/\r?\n/).filter(Boolean);
  let branchDaysGh = null;
  async function branchDays(pull, ourSha) {
    const since = new Date(Date.now() - 15 * 864e5).toISOString();
    if (pull || !branchDaysGh || Date.now() - branchDaysGh.at > 1800e3) {
      const out = await gh(["api", "--paginate", "--jq", ".[].commit.committer.date", `repos/${GH_REPO}/commits?sha=${BRANCH}&since=${since}&per_page=100`]);
      if (out != null) branchDaysGh = { at: Date.now(), dates: lines(out) };
    }
    const ours = REPO && ourSha ? lines((await run(GIT, ["log", `origin/${BRANCH}`, `--since=${since}`, "--format=%cI"])) || "") : [];
    return { since, ours, github: branchDaysGh ? branchDaysGh.dates : null };
  }
  const BUDGET_MSG = ts("inbox.branch.budgetUsed");
  const cmpCache = new Map(); // "our...tip" -> { behind, newer }: the same pair is never compared twice
  async function branchStatus(pull) {
    if (pull && REPO) await run(GIT, ["fetch", "--quiet", "origin", BRANCH]);
    // Ours: the last pull of origin/<branch> in the local repo (sha + when it was taken). No local repo: nothing local.
    let ourSha = null, pulledAt = null;
    if (REPO) {
      const r = (await run(GIT, ["reflog", "show", "-1", "--date=iso-strict", "--format=%gd|%H", `refs/remotes/origin/${BRANCH}`])) || "";
      ourSha = r.split("|")[1] || (await run(GIT, ["rev-parse", `origin/${BRANCH}`]));
      pulledAt = (r.match(/@\{([^}]+)\}/) || [])[1] || null;
    }
    // GitHub: the branch as it is now, and every commit pushed after our sha.
    let latest = null, behind = null, newer = [], error = null, errorKind = null;
    const tip = await ghGet(`repos/${GH_REPO}/commits/${BRANCH}`);
    if (tip.body) latest = commitOf(tip.body);
    else if (tip.denied) { error = BUDGET_MSG; errorKind = "budget"; }
    else { error = ts("inbox.branch.ghUnreachable"); errorKind = "unreachable"; }
    if (latest && ourSha) {
      if (latest.sha === ourSha) behind = 0;
      else {
        const key = `${ourSha}...${latest.sha}`;
        let c = cmpCache.get(key);
        if (!c) {
          const cmp = await ghGet(`repos/${GH_REPO}/compare/${ourSha}...${BRANCH}`);
          if (cmp.body) { c = { behind: cmp.body.ahead_by, newer: (cmp.body.commits || []).map(commitOf).reverse() }; cmpCache.set(key, c); if (cmpCache.size > 20) cmpCache.delete(cmpCache.keys().next().value); }
          else if (cmp.denied) { error = BUDGET_MSG; errorKind = "budget"; }
        }
        if (c) { behind = c.behind; newer = c.newer; }
      }
    }
    // A little history before our sha, for the chart: the last commits we already have.
    const lg = REPO && ourSha ? ((await run(GIT, ["log", "-5", "--format=%H%x1f%s%x1f%an%x1f%cI", ourSha])) || "") : "";
    const before = lg.split("\n").filter(Boolean).map((l) => {
      const [sha, subject, author, at] = l.split("\x1f");
      return { sha, subject, author, at, pr: (subject.match(/\(#(\d+)\)\s*$/) || [])[1] || null };
    }).reverse();
    const days = await branchDays(pull, ourSha);
    return { checkedAt: new Date().toISOString(), ourSha, pulledAt, latest, behind, newer, before, days, error, errorKind, noLocalRepo: !REPO };
  }

  // Measured in the background, so the page answers at once. The pace scales with the number of projects (5 min for up to
  // two projects, then +2.5 min per extra project) and the tip is an ETag request, so an unchanged branch costs nothing.
  let branchLast = null, branchTimer = null, disposed = false;
  const branchTick = async () => {
    if (!GH_REPO || disposed) return;
    try { branchLast = await branchStatus(false); publish("branch", branchLast); } catch (e) { /* keep the last reading */ }
    if (!disposed) { branchTimer = setTimeout(branchTick, Math.max(300e3, getConfig().projects.length * 150e3)); branchTimer.unref?.(); }
  };
  // Start-up staggered by project, so several projects do not all hit GitHub in the same second.
  branchTimer = setTimeout(branchTick, 1000 + Math.max(0, getConfig().projects.findIndex((x) => x.id === P.id)) * 7000);
  branchTimer.unref?.();

  return {
    id: P.id,
    /** Stop every timer and watcher (the project was removed from the config). */
    dispose() {
      disposed = true;
      clearTimeout(branchTimer); clearTimeout(pending);
      for (const t of timers) clearInterval(t);
      for (const w of watchers.splice(0)) try { w.close(); } catch {}
      for (const c of clients) try { c.end(); } catch {}
      clients.clear();
    },
    INBOX,
    PROJECT,
    publish,
    sendEvent: sendAll,
    quickSnapshot,
    /** Read the project folder again now (after the setup wrote into it). */
    refresh,
    files: () => lastSnapshot?.files ?? [],
    summary: () => ({ questions: countQuestions(lastSnapshot?.files ?? []), files: (lastSnapshot?.files ?? []).length, behind: branchLast?.behind ?? null, branch: BRANCH }),
    /** GET /api/p/<id>/branch: the cached measurement, or a fresh one (`pull`: `git fetch origin <branch>` first). */
    async branchAnswer(pull) {
      if (!GH_REPO) return { checkedAt: new Date().toISOString(), ourSha: null, pulledAt: null, latest: null, behind: null, newer: [], before: [], days: null, error: "no project repo in the config", errorKind: null, noLocalRepo: !REPO };
      if (pull || !branchLast) { branchLast = await branchStatus(pull); publish("branch", branchLast); }
      return branchLast;
    },
    /** GET /api/p/<id>/events: an SSE client: the current snapshot at once, then every change. */
    async addSseClient(req, res) {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      const snap = await quickSnapshot();
      res.write(`retry: 2000\n\n`);
      write(res, "snapshot", JSON.stringify(snap));
      for (const [type, t] of sticky) write(res, type, t);
      clients.add(res);
      req.on("close", () => clients.delete(res));
    },
  };
}

/** The inbox of a configured project, started on first use; null for an unknown id. */
export function getInbox(id) {
  let i = instances.get(id);
  if (!i) {
    const P = projectById(id);
    if (!P) return null;
    i = createInbox(P);
    instances.set(id, i);
  }
  return i;
}
/** Dispose the inboxes whose project id is gone from the (reloaded) config: their watchers, timers and GitHub spending stop. */
export function pruneInstances() {
  for (const [id, i] of instances) if (!projectById(id)) { try { i.dispose(); } catch {} instances.delete(id); }
}
/** Start the first project's inbox now (as the single-project server always did). */
export function startFirst() { return getInbox(getConfig().projects[0].id); }
/** A topic that is the same for every project (the runners summary): kept for inboxes created later, sent to the running ones. */
export function publish(type, data) {
  globalSticky.set(type, JSON.stringify(data));
  for (const i of instances.values()) i.publish(type, data);
}
/** An event for every connected client of every project (the settings page tells open tabs the config changed). */
export function sendEvent(type, data) { for (const i of instances.values()) i.sendEvent(type, data); }
/** Per-project numbers for the machine overview. Starts every configured project (lazy start). */
export function summaries() {
  return getConfig().projects.map((p) => ({ id: p.id, name: p.name, ...getInbox(p.id).summary() }));
}
