// The plugin's skills, read at runtime from plugin/skills/*/SKILL.md so the /skills page never drifts from the plugin.
// Frontmatter is the small `key: value` block between the two `---` lines; the body is everything after it.
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills");
const NAMESPACE = "lanedeck";

export function parseSkill(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const k = /^([\w-]+):\s*(.*)$/.exec(line);
    if (k) fm[k[1]] = k[2].trim();
  }
  if (!fm.name) return null;
  return {
    name: fm.name,
    command: `/${NAMESPACE}:${fm.name}`,
    description: fm.description ?? "",
    byYou: fm["disable-model-invocation"] === "true",
    body: m[2].trim(),
  };
}

export async function listSkills() {
  let dirs = [];
  try { dirs = (await readdir(DIR, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort(); } catch { return []; }
  const out = [];
  for (const d of dirs) {
    try {
      const s = parseSkill(await readFile(join(DIR, d, "SKILL.md"), "utf8"));
      if (s) out.push(s);
    } catch { /* a folder without SKILL.md is skipped */ }
  }
  // init first (the one you type), then the rest by name.
  return out.sort((a, b) => Number(b.byYou) - Number(a.byYou) || a.name.localeCompare(b.name));
}
