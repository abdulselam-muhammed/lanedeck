import { lsRead, lsWrite } from "@/lib/storage";
import type { TFn } from "@/context/ConfigContext";

// Words for the strings built outside React (state chips, relative times, node titles). The provider calls setModelT on every render.
let mt: TFn = (k) => k;
let mlang = "en";
export function setModelT(t: TFn, lang: string) {
  mt = t;
  mlang = lang;
  for (const k of Object.keys(CHIP_LABEL) as (keyof typeof CHIP_LABEL)[]) CHIP_LABEL[k] = t("inbox.state." + k);
}
// The inbox model (moved from the old index.html): file parsing, the files + live agents tree,
// states, and the small helpers every view uses.

export type Recent = { tool: string; desc: string; at: number | null };
export type Phase = { id: string; label: string; index: number };
export type Progress = {
  done: number;
  total: number;
  pct: number;
  pctExact: number;
  stepFraction: number;
  phase: Phase | null;
  items: { text: string; done: boolean }[];
  source: "plan" | "phase" | "none";
  estimate?: string;
  held?: boolean;
};
export type AgentState = "run" | "wait" | "done" | "idle" | "stopped"; // stopped: ended from outside (TaskStop), see server taskStatuses
export type Agent = {
  id: string;
  session: string;
  name: string;
  model: string | null;
  type: string | null;
  parent: string | null;
  depth: number;
  branch: string | null;
  startedAt: number;
  lastAt: number;
  handedBack: boolean;
  endedTurn: boolean;
  step: string;
  recent: Recent[];
  commits?: number;
  state: AgentState;
  stopped?: number | null; // when it was stopped from outside
  progress?: Progress;
};
/** `proto`: the file belongs to a project that follows the .lanedeck protocol (docs/PROTOCOL.md). */
/** `text` may be the localized text (translation lines resolved); `rawText` is then the file as written (its hash marks it read). */
export type RawFile = { name: string; text: string; mtime: number; proto?: boolean; rawText?: string };
/** The .lanedeck/ data of a protocol project (server/protocol.mjs). */
export type Protocol = {
  version: number;
  project: string | null;
  map: string | null;
  glossary: { title: string; desc: string; entries: { terms: { term: string; meaning: string }[] }[] }[];
  /** the glossary parsed for each content language (protocol 1.1) */
  glossaryByLang?: Record<string, Protocol["glossary"]>;
  /** the project's content languages: project.md front matter, else the config, else ["en"] */
  languages?: string[];
  warnings: string[];
};
export type Snapshot = { inbox: string; files?: RawFile[]; error?: string; agents?: Agent[]; protocol?: Protocol | null; now: number };
export type Question = { id: string; lines: string[]; text: string; title: string; answered?: boolean };
export type FileStatus = "run" | "done" | "blocked" | "info";
export type InboxFile = RawFile & {
  title: string;
  general: boolean;
  agentIds: string[];
  parent: string | null;
  status: FileStatus;
  statusText: string;
  questions: Question[];
  /** Protocol files: questions with an **Answer:** line, waiting for the AI (not in `questions`). */
  answeredQs: Question[];
  /** Protocol files: the ## Steps checklist, or null. */
  plan: { done: number; total: number } | null;
  hash: number;
};
export type TreeNode = {
  key: string;
  kind: "file" | "agent";
  file?: InboxFile;
  agent: Agent | null;
  children: TreeNode[];
};
export type Tree = {
  nodes: Map<string, TreeNode>;
  parentOf: Map<string, TreeNode>;
  general: TreeNode[];
  work: TreeNode[];
  others: TreeNode[];
};
export type Filter = "all" | "active" | "waiting";

// One file per agent: "<agent>.md"; "<agent>__<sub>.md" is shown under "<agent>.md".
// "**Agent:** `a…`" (Arabic label too) links a file to its live agent (the first id; more ids nest under it).
// The status is the FIRST word after the Arabic "Status" label: running / resumed / in progress / started → running ·
// finished / ready / final / done → done · stopped / suspended / waiting → stopped (the words are matched in Arabic, as \u escapes).
// A linked agent's live state wins over the written status. Open questions ("## ID — …") wait for you.
export const QID = /^##\s+([A-Z]{1,8}\d{1,3})\b/;
const AGENT_LINE = /^\*\*[^*\n]*agent[^*\n]*:\*\*([^\n]*)$/gim;

export function statusOf(line: string): FileStatus {
  const text = (line || "").replace(/\*/g, "").trim();
  const first = text.split(/[\s.\u060c:—–\-(]+/)[0] || "";
  if (/^(\u064a\u0639\u0645\u0644|\u0627\u0633\u062a\u0624\u0646\u0641|\u0642\u064a\u062f|\u0628\u062f\u0623|\u064a\u0628\u0646\u064a|\u064a\u0642\u064a\u0633|\u062c\u0627\u0631\u064d|\u062c\u0627\u0631)/.test(first)) return "run";
  if (/^(\u0627\u0646\u062a\u0647\u0649|\u062c\u0627\u0647\u0632|\u0646\u0647\u0627\u0626\u064a|\u062a\u0645\u0651|\u062a\u0645|\u0627\u0643\u062a\u0645\u0644)/.test(first)) return "done";
  if (/^(\u0645\u062a\u0648\u0642\u0641|\u0645\u0639\u0644\u0651\u0642|\u0645\u0639\u0644\u0642|\u064a\u0646\u062a\u0638\u0631|\u0645\u062d\u062c\u0648\u0628)/.test(first)) return "blocked";
  return "done"; // only the FIRST word decides: a later "CI is running" in the line is not the agent running
}

export function hashOf(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

export function parseFile(file: RawFile): InboxFile {
  const text = file.text;
  const base = file.name.replace(/\.md$/i, "");
  const title = (text.match(/^#\s+(.+)$/m)?.[1] ?? base).trim();
  const statusLine = text.match(/\*\*\u0627\u0644\u062d\u0627\u0644\u0629:\*\*\s*([^\n]+)/)?.[1] ?? "";
  const questions: Question[] = [];
  let cur: { id: string; lines: string[] } | null = null;
  for (const l of text.replace(/\r\n?/g, "\n").split("\n")) {
    const m = l.match(QID);
    if (m) {
      cur = { id: m[1], lines: [l] };
      questions.push(cur as Question);
      continue;
    }
    if (/^#{1,2}\s/.test(l)) {
      cur = null;
      continue;
    }
    if (cur) cur.lines.push(l);
  }
  questions.forEach((q) => {
    q.text = q.lines.join("\n").trim();
    q.title = q.lines[0].replace(/^##\s+/, "");
  });
  // Protocol files: a question with an **Answer:** / Arabic-label line is answered, waiting for the AI.
  let open = questions, answeredQs: Question[] = [];
  let plan: InboxFile["plan"] = null;
  if (file.proto) {
    const isAns = (q: Question) => q.lines.some((l) => /^\s*\*\*(?:Answer|\u0627\u0644\u062c\u0648\u0627\u0628)\s*:\*\*\s*\S/i.test(l));
    questions.forEach((q) => (q.answered = isAns(q)));
    open = questions.filter((q) => !q.answered);
    answeredQs = questions.filter((q) => q.answered);
    let inPlan = false, total = 0, done = 0;
    for (const l of text.replace(/\r\n?/g, "\n").split("\n")) {
      if (/^#{1,6}\s/.test(l)) { inPlan = /^##\s+(?:\u0627\u0644\u062e\u0637\u0648\u0627\u062a|Steps)\s*$/i.test(l.trim()); continue; }
      const c = inPlan && l.match(/^\s*[-*]\s+\[([ xX])\]\s+/);
      if (c) { total++; if (c[1] !== " ") done++; }
    }
    if (total) plan = { done, total };
  }
  const agentIds: string[] = [];
  for (const m of text.matchAll(AGENT_LINE))
    for (const id of m[1].match(/\ba[0-9a-f]{16}\b/g) || []) if (!agentIds.includes(id)) agentIds.push(id);
  const sep = base.indexOf("__");
  const general = /^00-/.test(file.name);
  return {
    ...file,
    title,
    general,
    agentIds,
    parent: sep > 0 ? base.slice(0, sep) + ".md" : null,
    status: general ? "info" : statusOf(statusLine),
    statusText: (statusLine.replace(/\*/g, "").split(/[.\u060c]/)[0] || "").trim(),
    questions: open,
    answeredQs,
    plan,
    hash: hashOf(file.rawText ?? text),
  };
}

export const isReadme = (f: { name: string }) => /^00-README/i.test(f.name);

export function stateOf(n: TreeNode): string {
  if (n.agent) return n.agent.state; // run | wait (for its subagent) | done | idle
  if (n.kind !== "file" || !n.file) return "done";
  // A file that still SAYS "running" but has no live agent and was not touched for 6 h is a stale note,
  // not work in progress: show it as idle so "Active" and the Overview count the same thing.
  if (n.file.status === "run" && Date.now() - n.file.mtime > STALE_RUN_MS) return "idle";
  return n.file.status; // run | done | blocked | info
}
export const STALE_RUN_MS = 6 * 3600 * 1000;
export const isRun = (n: TreeNode) => stateOf(n) === "run";
export const activeDeep = (n: TreeNode): boolean => isRun(n) || n.children.some(activeDeep);
export const waitingSelf = (n: TreeNode) => n.kind === "file" && !!n.file && !isReadme(n.file) && n.file.questions.length > 0;
export const waitingDeep = (n: TreeNode): boolean => waitingSelf(n) || n.children.some(waitingDeep);
export const whenOf = (n: TreeNode) =>
  n.agent ? Math.max(n.agent.lastAt, n.file ? n.file.mtime : 0) : (n.file?.mtime ?? 0);
const rank = (n: TreeNode) => (isRun(n) ? 0 : activeDeep(n) ? 1 : stateOf(n) === "idle" ? 2 : 3);
export function byActivity(a: TreeNode, b: TreeNode) {
  return rank(a) - rank(b) || whenOf(b) - whenOf(a);
}
export const titleOf = (n: TreeNode) =>
  n.file ? (isReadme(n.file) ? mt("inbox.model.howWeWork") : n.file.title) : (n.agent?.name ?? n.key);

/** The tree: files and live agents together. */
export function buildTree(files: InboxFile[], agents: Agent[]): Tree {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const nodes = new Map<string, TreeNode>(),
    parentOf = new Map<string, TreeNode>();
  const primaryOf = new Map<string, TreeNode>(); // agent id -> the file node that stands for it
  for (const f of files) {
    const n: TreeNode = { key: f.name, kind: "file", file: f, agent: byId.get(f.agentIds[0]) || null, children: [] };
    nodes.set(n.key, n);
    if (n.agent && !primaryOf.has(n.agent.id)) primaryOf.set(n.agent.id, n);
  }
  for (const a of agents)
    if (!primaryOf.has(a.id)) nodes.set("agent:" + a.id, { key: "agent:" + a.id, kind: "agent", agent: a, children: [] });
  const repOf = (id: string) => primaryOf.get(id) || nodes.get("agent:" + id) || null;
  const attach = (child: TreeNode, parent: TreeNode | null | undefined) => {
    if (!parent || parent === child || parentOf.has(child.key)) return false;
    for (let p: TreeNode | undefined = parent; p; p = parentOf.get(p.key)) if (p === child) return false; // no cycles
    parent.children.push(child);
    parentOf.set(child.key, parent);
    return true;
  };
  // 1. "<agent>__<sub>.md" under "<agent>.md"
  for (const n of nodes.values()) if (n.kind === "file" && n.file?.parent) attach(n, nodes.get(n.file.parent));
  // 2. a file's further agent ids under that file
  for (const n of nodes.values())
    if (n.kind === "file" && n.file)
      for (const id of n.file.agentIds.slice(1)) {
        const r = nodes.get("agent:" + id);
        if (r) attach(r, n);
      }
  // 3. every other agent under the one that started it
  for (const n of nodes.values()) if (n.agent && n.agent.parent) attach(n, repOf(n.agent.parent));
  const tops = [...nodes.values()].filter((n) => !parentOf.has(n.key));
  return {
    nodes,
    parentOf,
    general: tops.filter((n) => n.kind === "file" && n.file?.general),
    work: tops.filter((n) => n.kind === "file" && !n.file?.general),
    others: tops.filter((n) => n.kind === "agent").sort(byActivity),
  };
}

export const emptyTree = (): Tree => ({ nodes: new Map(), parentOf: new Map(), general: [], work: [], others: [] });

// One state key per node, in the order the chips have always been chosen.
export type StateKey = "info" | "run" | "wait" | "subrun" | "idle" | "blocked" | "done";
export function stateKey(n: TreeNode): StateKey {
  if (n.file && n.file.general) return "info";
  const st = stateOf(n);
  if (st === "run") return "run";
  if (st === "wait") return "wait";
  if (n.children.some(activeDeep)) return "subrun";
  if (st === "idle") return "idle";
  if (st === "blocked" || st === "stopped") return "blocked";
  return "done";
}
/** The chip texts, filled by setModelT (from inbox.state.*). */
export const CHIP_LABEL: Record<Exclude<StateKey, "info">, string> = { run: "", wait: "", subrun: "", idle: "", blocked: "", done: "" };

export function ago(ms: number | null | undefined) {
  if (!ms) return "";
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 10) return mt("inbox.ago.now");
  if (s < 60) return mt("inbox.ago.s", { n: Math.floor(s) });
  if (s < 3600) return mt("inbox.ago.m", { n: Math.floor(s / 60) });
  if (s < 86400) return mt("inbox.ago.h", { n: Math.floor(s / 3600) });
  return new Date(ms).toLocaleDateString(mlang === "ar" ? "ar-u-nu-latn" : "en-GB");
}

export const openQuestions = (files: InboxFile[]) =>
  files.filter((f) => !isReadme(f)).flatMap((f) => f.questions.map((q) => ({ f, q })));

// ---------- per-viewer storage: localStorage["laneDeck.<key>"], JSON, every access guarded ----------
export const store = {
  get<T>(k: string, d: T): T {
    try {
      const v = lsRead("laneDeck." + k);
      return v === null ? d : (JSON.parse(v) as T);
    } catch {
      return d;
    }
  },
  set(k: string, v: unknown) {
    lsWrite("laneDeck." + k, JSON.stringify(v));
  },
};
export const objOf = (v: unknown): Record<string, any> => // eslint-disable-line @typescript-eslint/no-explicit-any
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {}; // eslint-disable-line @typescript-eslint/no-explicit-any

// ---------- routes (the redesign: one page per kind of information) ----------
// A node's key is its file name ("x.md") or "agent:<id>"; "__questions" and "__branch" are the two fixed views.
/** The page of a node or fixed view, under the project's base ("/p/<id>"). The branch page is `/branch`. */
export const hrefOf = (key: string, base: string) =>
  base + (key === "__questions" ? "/questions" : key === "__branch" ? "/branch" : key === "__mine" ? "/mine?tab=needs" : "/inbox/" + encodeURIComponent(key));
const dec = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
/** The node (or fixed view) a path shows: "/inbox/x.md" → "x.md"; "" when the path shows none. */
export function keyOfPath(path: string | null): string {
  const p = (path || "/").replace(/^\/p\/[\w-]+(?=\/|$)/, "").replace(/\/+$/, "") || "/";
  if (p.startsWith("/inbox/")) return dec(p.slice(7));
  if (p.startsWith("/flow/")) return dec(p.slice(6));
  if (p === "/questions") return "__questions";
  if (p === "/branch") return "__branch";
  if (p === "/mine") return "__mine";
  return "";
}
export const hasFlow = (f: InboxFile) => /```flow\r?\n/.test(f.text);

// ---------- the ONE definition of every number shown in more than one place (2026-11-12) ----------
// Every card, panel, ring, badge and the tab title read these; nothing else counts. Two sources, never mixed in one number:
//  * agents  = live Claude Code agents (transcripts, last 12 h): `agentsRunning`, the ring, the "agents" panel;
//  * inbox   = the .md files: `fileOnlyRunning` (files whose written status says running but that no live agent backs),
//              `waitingFiles` / `questions` (open "## ID —" questions).
// An agent is counted ONCE by its id, however many files or nodes show it.
export type RingKey = "run" | "wait" | "done" | "idle" | "blocked";
export type Metrics = {
  agentsRunning: number; // live agents (incl. subagents) writing now (state "run")
  subagentsRunning: number; // of those, depth > 1
  agentsTotal: number; // live agents in the last 12 h
  ring: Record<RingKey, number>; // the same agents by state; ring.run === agentsRunning always
  fileOnlyRunning: number; // inbox files that say "running" with no live agent behind them
  activeNodes: number; // rows (files + unlinked agents) in the running state: the count of the list/tab filter "Active", not "agents running"
  waitingFiles: number; // files with at least one open question (README excluded)
  questions: number; // open questions in them
  files: number; // non-general inbox files
  nodes: number; // non-general rows of the tree (the "all" tab)
};
export function computeMetrics(files: InboxFile[], agents: Agent[], tree: Tree): Metrics {
  const uniq = [...new Map(agents.map((a) => [a.id, a])).values()];
  const nodeOf = new Map<string, TreeNode>();
  for (const n of tree.nodes.values()) if (n.agent && !nodeOf.has(n.agent.id)) nodeOf.set(n.agent.id, n);
  const ring: Record<RingKey, number> = { run: 0, wait: 0, done: 0, idle: 0, blocked: 0 };
  for (const a of uniq) {
    const n = nodeOf.get(a.id);
    const k: RingKey =
      a.state === "run" ? "run" : a.state === "wait" ? "wait" : n && n.children.some(activeDeep) ? "wait" : a.state === "idle" ? "idle" : a.state === "stopped" ? "blocked" : "done";
    ring[k] += 1;
  }
  const plain = [...tree.nodes.values()].filter((n) => !(n.file && n.file.general));
  const withQ = files.filter((f) => !isReadme(f) && f.questions.length > 0);
  return {
    agentsRunning: ring.run,
    subagentsRunning: uniq.filter((a) => a.state === "run" && a.depth > 1).length,
    agentsTotal: uniq.length,
    ring,
    fileOnlyRunning: plain.filter((n) => !n.agent && isRun(n)).length,
    activeNodes: plain.filter(isRun).length,
    waitingFiles: withQ.length,
    questions: withQ.reduce((s, f) => s + f.questions.length, 0),
    files: plain.filter((n) => n.file).length,
    nodes: plain.length,
  };
}
export const emptyMetrics = (): Metrics => ({ agentsRunning: 0, subagentsRunning: 0, agentsTotal: 0, ring: { run: 0, wait: 0, done: 0, idle: 0, blocked: 0 }, fileOnlyRunning: 0, activeNodes: 0, waitingFiles: 0, questions: 0, files: 0, nodes: 0 });
