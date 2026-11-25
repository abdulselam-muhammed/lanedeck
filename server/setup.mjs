// "Set up lanedeck in this project": the only code that WRITES into a project repo. Everything it may write is listed here:
//   .lanedeck/PROTOCOL.md, .lanedeck/inbox/00-setup.md, one line in .gitignore, the marker block in AGENTS.md / CLAUDE.md,
// and the move of the finished 00-setup.md into inbox/_archive/. Nothing is ever overwritten; every path is built from a fixed
// name under the project's repoPath (taken from the config, never from the request). The folder itself is untrusted (a cloned
// repo can ship symlinks and junctions): every read and write goes through server/safepath.mjs, which refuses a symlinked
// component and a real path outside the real repoPath.
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./config.mjs";
import { PROTOCOL_DIR } from "./protocol.mjs";
import { appendPlain, createPlain, lexists as exists, mkdirSafe, readPlain, realRoot, safePath, unsafeReason } from "./safepath.mjs";

const TEMPLATES = path.join(ROOT, "templates");
export const IGNORE_LINE = `${PROTOCOL_DIR}/inbox/`;
export const BLOCK_START = "<!-- lanedeck:start -->";
export const BLOCK_END = "<!-- lanedeck:end -->";
export const INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md"];

const tpl = (name) => fs.readFileSync(path.join(TEMPLATES, name), "utf8").replace(/\r\n?/g, "\n");
const langName = (lang) => (lang === "ar" ? "Arabic" : "English");

/** The full English prompt for "any AI", with the language filled in. */
export const anyPrompt = (lang) => tpl("setup-prompt.txt").trim().replace("{{LANG}}", langName(lang));
export const pluginPrompt = "/lanedeck:init";
export const setupFile = (lang) => tpl(lang === "ar" ? "00-setup.ar.md" : "00-setup.en.md").replace("{{PROMPT}}", () => anyPrompt(lang));
export const instructionBlock = () => tpl("AGENTS-block.md");

/** The REAL path of the project folder, or throws. */
function repoRoot(repoPath) {
  if (!repoPath) throw Object.assign(new Error("this project has no local folder"), { status: 400 });
  const root = path.resolve(repoPath);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw Object.assign(new Error("the project folder does not exist"), { status: 400 });
  return realRoot(root);
}
const IGNORE_FORMS = [IGNORE_LINE, IGNORE_LINE.replace(/\/$/, "")].flatMap((l) => [l, "/" + l]);
const hasIgnoreLine = (text) => text.split(/\r?\n/).some((l) => IGNORE_FORMS.includes(l.trim()));
const notPlain = (name) => Object.assign(new Error(`${name} is not a regular file`), { status: 400 });

/** What setup would do, without writing anything. A symlinked target is reported (`symlink` / `unsafe`) and never read. */
export function setupStatus(repoPath, lang) {
  const root = repoRoot(repoPath);
  const at = (...rel) => { const why = unsafeReason(root, rel); return { p: why ? null : safePath(root, rel), why }; };
  const has = (x) => !!x.p && exists(x.p);
  const dir = at(PROTOCOL_DIR);
  const gi = at(".gitignore");
  const giText = gi.p ? readPlain(gi.p) : null;
  return {
    exists: exists(path.join(root, PROTOCOL_DIR)),
    unsafe: dir.why || at(PROTOCOL_DIR, "inbox").why || at(PROTOCOL_DIR, "inbox", "_archive").why,
    files: {
      protocol: has(at(PROTOCOL_DIR, "PROTOCOL.md")),
      setup: has(at(PROTOCOL_DIR, "inbox", "00-setup.md")) || has(at(PROTOCOL_DIR, "inbox", "_archive", "00-setup.md")),
    },
    gitignore: { exists: giText != null, hasLine: giText != null && hasIgnoreLine(giText), line: IGNORE_LINE, symlink: !!gi.why },
    instructions: INSTRUCTION_FILES.map((name) => {
      const x = at(name);
      const t = x.p ? readPlain(x.p) : null;
      return { name, exists: t != null, hasBlock: t != null && t.includes(BLOCK_START), symlink: !!x.why };
    }),
    block: instructionBlock(),
    prompts: { plugin: pluginPrompt, any: anyPrompt(lang) },
  };
}

/** Write the starting files. Idempotent: an existing file is reported, never replaced. Refuses a symlink or junction anywhere on the way. */
export function doSetup(repoPath, lang, { gitignore = true } = {}) {
  const root = repoRoot(repoPath);
  const created = [], existed = [];
  mkdirSafe(root, [PROTOCOL_DIR, "inbox"]);
  const put = (rel, text) => {
    const p = safePath(root, [PROTOCOL_DIR, ...rel]);
    const shown = [PROTOCOL_DIR, ...rel].join("/");
    if (exists(p)) return existed.push(shown);
    createPlain(p, text);
    created.push(shown);
  };
  put(["PROTOCOL.md"], tpl("PROTOCOL.md"));
  // a setup file that was already archived is not recreated
  if (exists(safePath(root, [PROTOCOL_DIR, "inbox", "_archive", "00-setup.md"]))) existed.push(`${PROTOCOL_DIR}/inbox/_archive/00-setup.md`);
  else put(["inbox", "00-setup.md"], setupFile(lang));
  let ignore = "skipped";
  if (gitignore) {
    const gi = safePath(root, [".gitignore"]);
    if (!exists(gi)) { createPlain(gi, IGNORE_LINE + "\n"); ignore = "added"; }
    else {
      const text = readPlain(gi);
      if (text == null) throw notPlain(".gitignore");
      if (hasIgnoreLine(text)) ignore = "present";
      else { appendPlain(gi, (text && !text.endsWith("\n") ? "\n" : "") + IGNORE_LINE + "\n"); ignore = "added"; }
    }
  }
  return { created, existed, gitignore: ignore };
}

/** Append the marker block to the chosen files (AGENTS.md / CLAUDE.md). A file that already has it is left alone. */
export function addInstructions(repoPath, files, { create = false } = {}) {
  const root = repoRoot(repoPath);
  const block = instructionBlock();
  const out = { written: [], already: [], created: [], missing: [] };
  for (const name of [...new Set(files)]) {
    if (!INSTRUCTION_FILES.includes(name)) throw Object.assign(new Error(`not an instruction file: ${name}`), { status: 400 });
    const p = safePath(root, [name]);
    if (exists(p)) {
      const t = readPlain(p);
      if (t == null) throw notPlain(name);
      if (t.includes(BLOCK_START)) { out.already.push(name); continue; }
      appendPlain(p, (t && !t.endsWith("\n") ? "\n" : "") + (t ? "\n" : "") + block);
      out.written.push(name);
    } else if (create && name === "AGENTS.md") {
      createPlain(p, block);
      out.created.push(name);
    } else out.missing.push(name);
  }
  return out;
}

/** The `## Steps` checklist of a setup file: { total, done }. */
function stepCounts(text) {
  let inSteps = false, total = 0, done = 0;
  for (const l of String(text).replace(/\r\n?/g, "\n").split("\n")) {
    if (/^#{1,6}\s/.test(l)) { inSteps = /^##\s+(?:\u0627\u0644\u062e\u0637\u0648\u0627\u062a|Steps)\s*$/i.test(l.trim()); continue; }
    const m = inSteps && l.match(/^\s*[-*]\s+\[([ xX])\]\s+/);
    if (m) { total++; if (m[1] !== " ") done++; }
  }
  return { total, done };
}

/**
 * Move inbox/00-setup.md to inbox/_archive/ with its steps ticked. Only this one file is ever moved. Returns true when it moved.
 * `repoPath`: when the inbox is the project's own `.lanedeck/inbox`, every component from the repo down is checked. Any other
 * inbox (an explicit inboxDir from the config) is trusted as a folder, and only what lies below it is checked.
 */
export function archiveSetupFile(inboxDir, repoPath) {
  try {
    let root, pre;
    if (repoPath && path.resolve(inboxDir) === path.resolve(repoPath, PROTOCOL_DIR, "inbox")) { root = repoRoot(repoPath); pre = [PROTOCOL_DIR, "inbox"]; }
    else { root = realRoot(inboxDir); pre = []; }
    const src = safePath(root, [...pre, "00-setup.md"]);
    const text = readPlain(src);
    if (text == null) return false;
    mkdirSafe(root, [...pre, "_archive"]);
    let dest = safePath(root, [...pre, "_archive", "00-setup.md"]);
    if (exists(dest)) dest = safePath(root, [...pre, "_archive", `00-setup-${Date.now()}.md`]);
    let inSteps = false;
    const ticked = text.split(/(\r?\n)/).map((l) => {
      if (/^#{1,6}\s/.test(l)) inSteps = /^##\s+(?:\u0627\u0644\u062e\u0637\u0648\u0627\u062a|Steps)\s*$/i.test(l.trim());
      return inSteps ? l.replace(/^(\s*[-*]\s+)\[ \]/, "$1[x]") : l;
    }).join("");
    createPlain(dest, ticked);
    fs.unlinkSync(src);
    return true;
  } catch { return false; }
}

/**
 * The setup file archives itself ONLY when the human has ticked its last step (every step of `## Steps` is checked; the AI ticks
 * its own steps and leaves the human review step open). It never archives while the AI may still be working.
 * The "Setup done" button does the same through finishSetup().
 */
export function archiveSetup(inboxDir, file, repoPath) {
  if (!file) return false;
  const c = stepCounts(file.text);
  return c.total > 0 && c.done === c.total ? archiveSetupFile(inboxDir, repoPath) : false;
}

/** POST /api/p/:id/setup/done: the human says the setup is finished. */
export function finishSetup(repoPath) {
  repoRoot(repoPath);
  return { archived: archiveSetupFile(path.join(repoPath, PROTOCOL_DIR, "inbox"), repoPath) };
}
