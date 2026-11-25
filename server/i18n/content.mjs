// Bilingual project content (protocol 1.1): the human-facing text the AI writes into map.md, glossary.md, project.md and the
// inbox files may carry one translation per language. Pure functions, used by the server (glossary) and the client (inbox,
// map, project), so a language switch re-renders without a new read.
//
//   Line translations: a line written right under the line it translates, with the same marker plus @<lang>:
//     > now: Billing webhooks            ==  Auth | done | Login and reset     - Login form | done | PR #8 | merged
//     > now@ar: ...                      ==@ar ... | | ...                     -@ar ... | | | ...
//     # Title  /  #@ar ...               ## Q1 — text  /  ##@ar Q1 — ...       - **term** — meaning  /  -@ar **...** — ...
//   The state field is never translated (left empty, and ignored if filled); an empty field keeps the original; a checklist keeps its box.
//   Longer text: consecutive fenced blocks ```lang-en / ```lang-ar; only the block of the chosen language is shown.
//
// The chosen text is the translation for the interface language, else the original line (which is written in the project's
// first language). Content without translations is shown as it is, in any interface language.

/** The content languages of a project: project.md front matter, else the config, else English. */
export function contentLanguages(...sources) {
  for (const s of sources) if (Array.isArray(s) && s.length) return [...new Set(s.map(String))];
  return ["en"];
}

/** `languages: [en, ar]` (or `languages: en, ar`) in a leading `---` front-matter block; the text without that block. */
export function frontMatter(text) {
  const m = /^﻿?(?:<!--[^\n]*-->\s*\n)?---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(String(text ?? ""));
  if (!m) return { languages: null, body: text };
  const line = /^languages\s*:\s*\[?([^\]\n]*)\]?\s*$/m.exec(m[1]);
  const languages = line ? line[1].split(",").map((x) => x.trim().toLowerCase()).filter((x) => /^[a-z]{2,3}$/.test(x)) : null;
  const body = String(text).slice(0, m.index) + String(text).slice(m.index + m[0].length);
  return { languages: languages && languages.length ? languages : null, body };
}

// A translation line: indent, a marker (call-out, stage, step/bullet, heading), @lang, then the text.
const TR = /^(\s*)(>\s*(?:now|you|wait)|={2,}|[-*]|#{1,6})@([a-z]{2,3})(:)?(?:\s+|$)(.*)$/;
const QID = /^##\s+([A-Z]{1,8}\d{1,3})\b/;

function merge(orig, tr) {
  const text = tr[5].trim();
  if (!text) return orig;
  const call = orig.match(/^(\s*>\s*(?:now|you|wait)\s*:\s*)/);
  if (call) return call[1] + text;
  const head = orig.match(/^(#{1,6}\s+)/);
  if (head) {
    const q = orig.match(QID);
    return head[1] + (q && !text.startsWith(q[1]) ? `${q[1]} — ${text}` : text);
  }
  const stage = orig.match(/^(\s*={2,}\s*)(.*)$/);
  const step = orig.match(/^(\s*[-*]\s+)(\[[ xX]\]\s+)?(.*)$/);
  const m = stage || step;
  if (!m) return orig;
  const body = stage ? m[2] : m[3];
  const prefix = stage ? m[1] : m[1] + (m[2] || "");
  const t = text.replace(/^\[[ xX]\]\s+/, "");
  if (!body.includes("|")) return prefix + t;
  const a = body.split("|"), b = t.split("|");
  const keep = [1]; // the state
  return prefix + a.map((x, i) => (keep.includes(i) || !(b[i] ?? "").trim() ? x : ` ${b[i].trim()} `)).join("|").trim();
}

/** The text with every translated line and fenced language block resolved to `lang`. */
export function localizeText(text, lang, languages = ["en"]) {
  if (text == null) return text;
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    // fenced language blocks: a run of ```lang-xx blocks separated only by blank lines
    if (/^```lang-[a-z]{2,3}\s*$/.test(lines[i])) {
      const blocks = [];
      let j = i;
      while (j < lines.length && /^```lang-[a-z]{2,3}\s*$/.test(lines[j])) {
        const l = lines[j].trim().slice(8);
        let k = j + 1;
        const body = [];
        while (k < lines.length && !/^```\s*$/.test(lines[k])) body.push(lines[k++]);
        blocks.push({ lang: l, body });
        j = k + 1;
        let n = j;
        while (n < lines.length && !lines[n].trim()) n++;
        if (n < lines.length && /^```lang-[a-z]{2,3}\s*$/.test(lines[n])) j = n;
        else break;
      }
      const pick = blocks.find((b) => b.lang === lang) || blocks.find((b) => b.lang === languages[0]) || blocks[0];
      out.push(...pick.body);
      i = j - 1;
      continue;
    }
    if (TR.test(lines[i])) continue; // a translation line, consumed with the line above it
    let line = lines[i];
    for (let j = i + 1; j < lines.length && TR.test(lines[j]); j++) {
      const tr = lines[j].match(TR);
      if (tr[3] === lang) { line = merge(lines[i], tr); break; }
    }
    out.push(line);
  }
  return out.join("\n");
}

/** Text lines that lack a translation into one of the project's languages (what the doctor skill reports). `missing` lists the
 *  languages without a translation line; one of them is the original's own language. */
export function missingTranslations(text, languages) {
  if (!languages || languages.length < 2) return [];
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let inFlow = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^```/.test(l)) { inFlow = /^```flow\s*$/.test(l) ? !inFlow : false; continue; }
    if (TR.test(l)) continue;
    const textual = /^#{1,6}\s+\S/.test(l) || (inFlow && /^(\s*>\s*(now|you|wait)\s*:|\s*={2,}|\s*-\s)/.test(l)) || /^\s*-\s+\*\*.+\*\*\s*(—|–|-|:)/.test(l);
    if (!textual || /^<!--/.test(l)) continue;
    const have = new Set();
    for (let j = i + 1; j < lines.length && TR.test(lines[j]); j++) have.add(lines[j].match(TR)[3]);
    // the original line is in one of the languages: every other one needs a translation line
    const lack = languages.filter((x) => !have.has(x));
    if (lack.length > 1) out.push({ line: i + 1, text: l.trim().slice(0, 80), missing: lack });
  }
  return out;
}
