// Run after `next build` (npm run prepublishOnly): the build embeds the absolute path of the folder it was built in
// (module ids, manifests) and the user name inside it. Replace it with a neutral placeholder in every file under .next,
// drop build logs, then fail if the machine's own path or user name is still anywhere in what will be published.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BS = String.fromCharCode(92);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const NEXT = path.join(ROOT, ".next");
if (!fs.existsSync(path.join(NEXT, "BUILD_ID"))) { console.error("scrub-build: .next is missing, run `npm run build` first"); process.exit(1); }

for (const d of ["trace", "types", "diagnostics", "cache"]) fs.rmSync(path.join(NEXT, d), { recursive: true, force: true });

// every spelling the root path takes inside generated files (raw, JSON-escaped, double-escaped, forward slashes, URL-encoded),
// each paired with the same spelling of a neutral folder. The drive letter stays (Windows file URLs must remain absolute).
const spellings = (p, to) => {
  const parts = p.split(BS).join("/").split("/");
  const dst = to.split("/");
  const out = new Map();
  for (const sep of [BS, BS + BS, BS + BS + BS + BS, "/", BS + "/"]) {
    const s = parts.join(sep);
    const d = dst.join(sep);
    out.set(s, d);
    out.set(s.replace(/^([A-Za-z]):/, (_, l) => `${l.toLowerCase()}:`), d);
  }
  out.set(encodeURIComponent(parts.join("/")), encodeURIComponent(dst.join("/")));
  return out;
};
const trim = (r) => r.split(BS).join("/").replace(/\/+$/, "");
const neutral = (r) => (/^[A-Za-z]:/.test(r) ? `${r.slice(0, 2)}/lanedeck` : "/lanedeck");
const pairs = new Map();
for (const r of [ROOT, fs.realpathSync(ROOT)]) for (const [k, v] of spellings(trim(r), neutral(trim(r)))) pairs.set(k, v);
const uniq = [...pairs.keys()].sort((a, b) => b.length - a.length);

const BIN = /\.(png|jpe?g|gif|ico|woff2?|ttf|webp|avif)$/i;
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
let changed = 0;
for (const f of walk(NEXT)) {
  if (BIN.test(f)) continue;
  const before = fs.readFileSync(f, "utf8");
  let after = before;
  for (const v of uniq) if (after.includes(v)) after = after.split(v).join(pairs.get(v));
  if (after !== before) { fs.writeFileSync(f, after); changed++; }
}

const needles = [...new Set([...uniq, ...spellings(trim(os.homedir()), "/x").keys()])].filter(Boolean);
const bad = [];
for (const f of walk(NEXT)) {
  if (BIN.test(f)) continue;
  const s = fs.readFileSync(f, "utf8");
  const hit = needles.find((n) => s.includes(n));
  if (hit) bad.push(`${path.relative(ROOT, f)} (${hit})`);
}
if (bad.length) { console.error("scrub-build: machine-specific text is still in the build:\n  " + bad.slice(0, 20).join("\n  ")); process.exit(1); }
console.log(`scrub-build: ${changed} files rewritten, nothing machine-specific left in .next`);
