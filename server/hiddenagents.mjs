// Agents hidden from lanedeck's Agents page. Only a list of agent ids in lanedeck's own data folder (next to the config file):
// Claude Code's transcripts are never touched. Reversible: unhide one, or all.
import fs from "node:fs";
import path from "node:path";
import { configPath } from "./config.mjs";

const ID_RE = /^[\w-]{1,64}$/;
const KEEP_MS = 90 * 86400e3; // an id not seen for 90 days is dropped when the file is next written (its transcript is long gone)
export const hiddenFile = () => path.join(path.dirname(configPath()), "hidden-agents.json");

/** { [agentId]: hiddenAtMs } from the file; {} when it is missing or unreadable. */
function load(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    const src = j && typeof j === "object" && j.hidden && typeof j.hidden === "object" ? j.hidden : {};
    return Object.fromEntries(Object.entries(src).filter(([k, v]) => ID_RE.test(k) && Number.isFinite(v)));
  } catch { return {}; }
}
function save(file, hidden) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, hidden }, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}

export const hiddenIds = (file = hiddenFile()) => Object.keys(load(file));

/** action: "hide" | "unhide" (with ids) | "unhideAll". Returns the ids now hidden. Throws a 400-status error on bad input. */
export function changeHidden(action, ids, { file = hiddenFile(), now = Date.now() } = {}) {
  const bad = (m) => Object.assign(new Error(m), { status: 400 });
  if (!["hide", "unhide", "unhideAll"].includes(action)) throw bad("action must be hide, unhide or unhideAll");
  const list = Array.isArray(ids) ? ids : [];
  if (action !== "unhideAll" && (!list.length || list.length > 500 || !list.every((x) => typeof x === "string" && ID_RE.test(x)))) throw bad("ids must be 1-500 agent ids");
  const cur = load(file);
  if (action === "unhideAll") for (const k of Object.keys(cur)) delete cur[k];
  else if (action === "unhide") for (const k of list) delete cur[k];
  else for (const k of list) cur[k] ??= now;
  for (const [k, at] of Object.entries(cur)) if (now - at > KEEP_MS) delete cur[k];
  save(file, cur);
  return Object.keys(cur);
}
