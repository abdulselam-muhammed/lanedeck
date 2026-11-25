// The project folder protocol (docs/PROTOCOL.md, version 1): `<repo>/.lanedeck/` holds project.md, map.md, glossary.md and inbox/.
// This module only READS it, and every problem it finds is a soft warning, never an error. The few things the dashboard writes into a
// project (PROTOCOL.md, inbox/00-setup.md, a .gitignore line, the AGENTS.md/CLAUDE.md block, and the archiving of the finished setup file)
// are all in server/setup.mjs.
// The folder is untrusted (a cloned repo): a symlinked or junctioned `.lanedeck/`, inbox/ or file is never read, only warned about.
import { existsSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { readPlainAsync } from "./safepath.mjs";
import { contentLanguages, frontMatter, localizeText } from "./i18n/content.mjs";

export const PROTOCOL_VERSION = 1;
export const PROTOCOL_DIR = ".lanedeck";
const STATES = ["done", "now", "you", "wait", "next", "later", "deferred", "blocked"];
const MARKER = /^\s*<!--\s*lanedeck protocol:\s*(\d+)\s*-->\s*\r?\n?/;
export const QUESTION_ID = /^##\s+([A-Z]{1,8}\d{1,3})\b/;
const ANSWER_LINE = /^\s*\*\*(?:Answer|\u0627\u0644\u062c\u0648\u0627\u0628)\s*:\*\*\s*\S/i;

/** The folder of a project that follows the protocol, or null. */
/** Legacy: a project that still has the pre-rename ".selam-deck" folder and no ".lanedeck" keeps using it. */
export const protocolDirName = (repoPath) => (repoPath && !existsSync(join(repoPath, PROTOCOL_DIR)) && existsSync(join(repoPath, ".selam-deck")) ? ".selam-deck" : PROTOCOL_DIR);
export const protocolDir = (repoPath) => (repoPath && existsSync(join(repoPath, protocolDirName(repoPath))) ? join(repoPath, protocolDirName(repoPath)) : null);

/** Text without the marker line, and the version the marker names (1 when missing). */
export function stripMarker(text) {
  const m = String(text).match(MARKER);
  return { text: m ? String(text).slice(m[0].length) : String(text), version: m ? Number(m[1]) : 1 };
}

/** The "## ID — ..." questions of a task file: [{ id, answered }] (answered: an **Answer:** / **(Arabic):** line under it). */
export function questionsOf(text) {
  const out = [];
  let cur = null;
  for (const l of String(text).replace(/\r\n?/g, "\n").split("\n")) {
    const m = l.match(QUESTION_ID);
    if (m) { cur = { id: m[1], answered: false }; out.push(cur); continue; }
    if (/^#{1,2}\s/.test(l)) { cur = null; continue; }
    if (cur && ANSWER_LINE.test(l)) cur.answered = true;
  }
  return out;
}

/** `## Group` headings and `- **term** — meaning` lines -> the glossary page's groups. */
export function parseGlossary(text, warn) {
  const groups = [];
  let g = null;
  for (const raw of String(text).replace(/\r\n?/g, "\n").split("\n")) {
    const l = raw.trim();
    if (!l || /^<!--/.test(l) || /^#\s/.test(l) || /^scope\s*:/i.test(l)) continue;
    const h = l.match(/^##\s+(.+)$/);
    if (h) { g = { title: h[1].trim(), desc: "", entries: [] }; groups.push(g); continue; }
    const t = l.match(/^[-*]\s+\*\*(.+?)\*\*\s*(?:—|–|-|:)\s*(.+)$/);
    if (t) {
      if (!g) { g = { title: "Terms", desc: "", entries: [] }; groups.push(g); }
      g.entries.push({ terms: [{ term: t[1].trim(), meaning: t[2].trim() }] });
    } else warn(`glossary.md: line not understood: "${l.slice(0, 50)}"`);
  }
  return groups.filter((x) => x.entries.length);
}

const isLink = (p) => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };
/** The text of a plain file, null when missing; a symlink / junction is not read (warned, undefined). */
async function read(path, name, warn) {
  if (isLink(path)) { warn(`${name} is a symlink or junction: not read`); return undefined; }
  try { return (await readPlainAsync(path))?.text ?? null; } catch { return null; }
}

/**
 * Everything the dashboard reads from `.lanedeck/`, plus the soft warnings.
 * `files`: the inbox files [{ name, text }], for the question checks. `skipped`: inbox entries that were not read (symlinks).
 */
export async function readProtocol(dir, files, skipped = [], configLanguages = null) {
  const warnings = [];
  const warn = (w) => { if (!warnings.includes(w)) warnings.push(w); };
  for (const name of skipped) warn(`inbox/${name} is a symlink or junction: not read`);
  if (isLink(dir)) {
    warn(".lanedeck is a symlink or junction: not read");
    return { version: PROTOCOL_VERSION, languages: contentLanguages(configLanguages), project: null, map: null, glossary: [], glossaryByLang: {}, warnings: warnings.slice(0, 20) };
  }
  if (isLink(join(dir, "inbox"))) warn("inbox is a symlink or junction: not read");
  const [proj, map, gloss] = await Promise.all(["project.md", "map.md", "glossary.md"].map((n) => read(join(dir, n), n, warn)));
  const seeVersion = (name, v) => { if (v > PROTOCOL_VERSION) warn(`${name}: protocol version ${v} is newer than this dashboard's (${PROTOCOL_VERSION})`); };

  let project = null;
  let languages = null;
  if (proj === null) warn("project.md is missing");
  else if (proj !== undefined) {
    const s = stripMarker(proj);
    seeVersion("project.md", s.version);
    const fm = frontMatter(s.text);
    languages = fm.languages;
    project = String(fm.body).trim() || null;
    if (!project) warn("project.md is empty");
  }
  languages = contentLanguages(languages, configLanguages);

  let mapText = null;
  if (map === null) warn("map.md is missing");
  else if (map !== undefined) {
    const s = stripMarker(map);
    seeVersion("map.md", s.version);
    const blocks = [...s.text.matchAll(/```flow\r?\n([\s\S]*?)```/g)];
    if (!blocks.length) warn("map.md has no ```flow block");
    else {
      if (blocks.length > 1) warn("map.md has more than one ```flow block (only the first is drawn)");
      mapText = s.text;
      for (const raw of blocks[0][1].split(/\r?\n/)) {
        const st = raw.match(/^==\s*(.+)$/), it = raw.match(/^(\s*)-\s*(.+)$/);
        const state = st ? st[1].split("|")[1] : it ? it[2].split("|")[1] : undefined;
        if ((st || it) && state != null && state.trim() && !STATES.includes(state.trim())) warn(`map.md: unknown state "${state.trim()}" (use ${STATES.join(", ")})`);
      }
    }
  }

  // The glossary is parsed once per content language (protocol 1.1 translation lines), so the page can switch language at once.
  let glossary = [];
  const glossaryByLang = {};
  if (gloss != null) {
    const s = stripMarker(gloss);
    seeVersion("glossary.md", s.version);
    glossary = parseGlossary(localizeText(s.text, languages[0], languages), warn);
    for (const l of new Set([...languages, "en", "ar"])) glossaryByLang[l] = parseGlossary(localizeText(s.text, l, languages), () => {});
  }

  for (const f of files || []) {
    if (f.name.startsWith("_")) continue;
    const v = stripMarker(f.text).version;
    if (v > PROTOCOL_VERSION) warn(`inbox/${f.name}: protocol version ${v} is newer than this dashboard's (${PROTOCOL_VERSION})`);
    const seen = new Set();
    for (const q of questionsOf(f.text)) { if (seen.has(q.id)) warn(`inbox/${f.name}: duplicate question ID ${q.id}`); seen.add(q.id); }
  }
  return { version: PROTOCOL_VERSION, languages, project, map: mapText, glossary, glossaryByLang, warnings: warnings.slice(0, 20) };
}
