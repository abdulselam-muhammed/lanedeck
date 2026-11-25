// Fails when the agent-facing texts name different work-map states: server/protocol.mjs (what the dashboard accepts) is the reference.
// Compared: docs/PROTOCOL.md, templates/PROTOCOL.md (must be identical), templates/setup-prompt.txt, the init, map and doctor skills.
// Run: npm run check:protocol
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const STATES = JSON.parse(/const STATES = (\[.*?\]);/s.exec(read("server/protocol.mjs"))[1]);
const problems = [];

if (read("docs/PROTOCOL.md") !== read("templates/PROTOCOL.md")) problems.push("templates/PROTOCOL.md differs from docs/PROTOCOL.md");

const mentions = (text, label) => { for (const s of STATES) if (!new RegExp("(^|[^A-Za-z0-9_-])" + s + "([^A-Za-z0-9_-]|$)").test(text)) problems.push(`${label}: state "${s}" is not mentioned`); };
// PROTOCOL.md: the state table must list exactly the known states.
const table = [...read("docs/PROTOCOL.md").matchAll(/^\| `(\w+)` \| .+ \| .+ \| .+ \|$/gm)].map((m) => m[1]).filter((s) => STATES.includes(s));
if (table.join() !== STATES.join()) problems.push(`docs/PROTOCOL.md: state table is [${table}] but the dashboard knows [${STATES}]`);
mentions(read("templates/setup-prompt.txt"), "templates/setup-prompt.txt");
for (const s of ["init", "map", "doctor"]) mentions(read(`plugin/skills/${s}/SKILL.md`), `plugin/skills/${s}`);
// Nobody but the human archives; no agent-facing text may tell the agent to move files.
for (const f of ["plugin/skills/report/SKILL.md", "plugin/skills/init/SKILL.md"]) if (/move finished tasks/i.test(read(f))) problems.push(`${f}: tells the agent to archive`);
// Protocol 1.1: every agent-facing text tells the AI to write in all the project's languages.
const LANG_RULE = "ALL languages listed in `languages`";
for (const f of ["docs/PROTOCOL.md", "plugin/skills/init/SKILL.md", "plugin/skills/map/SKILL.md", "plugin/skills/report/SKILL.md", "plugin/skills/answers/SKILL.md"]) if (!read(f).includes(LANG_RULE)) problems.push(`${f}: does not tell the AI to write in all the project's languages`);
if (!/ALL of these languages/.test(read("templates/setup-prompt.txt"))) problems.push("templates/setup-prompt.txt: does not tell the AI to write in all the project's languages");
if (!/translation line/.test(read("plugin/skills/doctor/SKILL.md"))) problems.push("plugin/skills/doctor: does not check for missing translations");
// A skill the model cannot invoke must not say "Use when".
for (const s of fs.readdirSync(path.join(ROOT, "plugin/skills"))) {
  const t = read(`plugin/skills/${s}/SKILL.md`);
  if (/^disable-model-invocation:\s*true/m.test(t) && /Use when/i.test(/^description:.*$/m.exec(t)?.[0] ?? "")) problems.push(`plugin/skills/${s}: description says "Use when" but the model cannot invoke it`);
}
if (problems.length) { console.error(problems.join("\n") + `\n${problems.length} protocol problem(s)`); process.exit(1); }
console.log(`protocol ok: ${STATES.length} states agree across the dashboard, protocol, prompt and skills`);
