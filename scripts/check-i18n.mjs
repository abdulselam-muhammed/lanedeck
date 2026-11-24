// Fails when the interface drifts away from the dictionary:
//  1. an Arabic-script character in src/ or server/ outside server/i18n/ and the built-in glossary data;
//  2. a key that exists in one language and not in the other;
//  3. a literal t("key") / ts("key") in the code that the dictionary does not define.
// Run: npm run check:i18n
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DICT } from "../server/i18n/index.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ALLOW = new Set(["src/lib/glossary.ts"]); // the built-in glossary: data with an en and an ar text per term
const ARABIC = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFE]/;
const problems = [];
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!["node_modules", ".next", "i18n"].includes(e.name)) walk(p); } else if (/\.(m?[jt]sx?|css|json)$/.test(e.name)) files.push(p);
  }
})(path.join(ROOT, "src")); 
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!["node_modules", "i18n"].includes(e.name)) walk(p); } else if (/\.(m?[jt]sx?|json)$/.test(e.name)) files.push(p);
  }
})(path.join(ROOT, "server"));

const used = new Set();
for (const f of files) {
  const rel = path.relative(ROOT, f).split(path.sep).join("/");
  const text = fs.readFileSync(f, "utf8");
  if (!ALLOW.has(rel)) text.split(/\r?\n/).forEach((l, i) => { if (ARABIC.test(l)) problems.push(`${rel}:${i + 1}: Arabic literal outside the dictionary`); });
  for (const m of text.matchAll(/\b(?:t|ts)\(\s*["']([\w.-]+)["']/g)) used.add(`${rel}\t${m[1]}`);
}
for (const k of Object.keys(DICT.en)) if (!(k in DICT.ar)) problems.push(`i18n: "${k}" has no ar text`);
for (const k of Object.keys(DICT.ar)) if (!(k in DICT.en)) problems.push(`i18n: "${k}" has no en text`);
for (const u of used) { const [rel, k] = u.split("\t"); if (!(k in DICT.en) && !(`settings.${k}` in DICT.en) && !(`setup.${k}` in DICT.en) && /^[a-z]+(\.[\w-]+)+$|^nav\./.test(k)) problems.push(`${rel}: t("${k}") is not in the dictionary`); }

if (problems.length) { console.error(problems.join("\n") + `\n${problems.length} i18n problem(s)`); process.exit(1); }
console.log(`i18n ok: ${Object.keys(DICT.en).length} keys in en and ar, no Arabic literal outside the dictionary`);
