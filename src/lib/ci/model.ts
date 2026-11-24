// Types and pure helpers of the /ci page (the CI runners panel). English only by design.
export type Person = { login: string; avatar?: string | null };
export type Step = { name: string; status: string; conclusion?: string | null; startedAt?: string | null; completedAt?: string | null };
/** One job row as the server sends it (server/ci/org.mjs slim()): only what the UI renders. `repo` is the short name. */
export type Job = {
  id: number;
  repo?: string;
  workflow?: string;
  job?: string;
  runner?: string | null;
  status: string;
  conclusion?: string | null;
  createdAt?: string;
  startedAt?: string | null;
  completedAt?: string | null;
  branch?: string;
  sha?: string;
  pr?: number | null;
  prTitle?: string | null;
  trigger?: Person | null;
  actor?: Person | null;
  prAuthor?: Person | null;
  labels?: string[];
  event?: string;
  url?: string;
  mine?: boolean;
  seq?: number;
  gone?: boolean;
  local?: { result: string; at: string } | null;
};
export type RunnerJob = { id: number | null; name: string; workflow?: string; repo?: string; pr?: number | null; prTitle?: string | null; trigger?: Person | null; actor?: Person | null; prAuthor?: Person | null; startedAt?: string };
export type LocalRunner = {
  container: string;
  /** docker's own status line ("Up 2 hours", "Restarting (1) 5 seconds ago") */
  docker?: string;
  runnerName: string;
  labels?: string;
  startedAt?: string;
  cpu?: string;
  mem?: string;
  busy: boolean;
  busyState: "busy" | "idle" | "unknown";
  since?: string | null;
  source?: "log" | "github";
  job: RunnerJob | null;
  lastDone: { name: string; result: string; at: string } | null;
  log: { ok: boolean; error: string | null } | null;
};
/** One of our machines: this PC (WSL) or a remote one read over ssh. */
export type MachineState = { id?: string; label?: string; installed: boolean; running: boolean; checkedAt: string | null; runners: LocalRunner[]; error: string | null; stale?: string | null; known?: string[] };
/** This PC's state, plus `machines` = the remote ones (machines.json). */
export type RunnersState = MachineState & { repoCount?: number; machines?: MachineState[] };
/** Every runner of every machine. */
export const allRunners = (st: RunnersState | null | undefined): LocalRunner[] => (st ? [...st.runners, ...(st.machines || []).flatMap((m) => m.runners)] : []);
export type Meta = {
  rate: number | null;
  rateLimit: number | null;
  requests: { lastHour: number; counted: number; countedPerHour: number; budget: number };
  pace: number;
  repoCount: number;
  paused: boolean;
  githubAt: string | null;
};
/** A self-hosted runner seen in the last 24 h (or one of this machine's), as the server lists it. */
export type RunnerEntry = {
  name: string;
  labels: string[];
  lastSeen: string | null;
  jobs: number;
  mine?: boolean;
  busy?: boolean;
  busyState?: string;
  job?: Job | null;
  jobName?: string;
  last?: { workflow?: string; job?: string; pr?: number };
};
/** The numbers the KPI tiles, the hourly chart and the Queue header show, computed by the server. */
export type Agg = {
  busy: number;
  idle: number;
  off: number;
  total: number;
  oursBusy: number;
  oursTotal: number;
  queued: number;
  ghosts: number;
  oldest: string | null;
  jobs24: number;
  bins: number[];
  binsEnd: number;
  per: Record<string, number>;
  sets: string[][];
};
export type QdPoint = [number, number];
/** One page of a list: rows, the cursor of the next page (null = last), the total; `options` with page 1 only. */
export type Page<O = never> = { jobs: Job[]; next: string | null; total: number; options?: O };
export type OrgOptions = { repos: string[]; runners: string[]; people: string[] };
export type QueueOptions = { repos: string[]; people: string[]; labels: string[] };

const LOCAL: Record<string, string> = { Succeeded: "success", Failed: "failure", Canceled: "cancelled", Cancelled: "cancelled", Abandoned: "cancelled" };
export const stKey = (j: Job) => (j.status === "completed" ? j.conclusion || "neutral" : j.local ? LOCAL[j.local.result] || "neutral" : j.status);
export type Group = "running" | "queued" | "ok" | "fail" | "other";
export function stGroup(j: Job): Group {
  const k = stKey(j);
  return k === "in_progress" ? "running" : k === "queued" || k === "pending" || k === "waiting" ? "queued" : k === "success" ? "ok" : k === "failure" || k === "timed_out" || k === "startup_failure" ? "fail" : "other";
}
export const people = (j: Job) => [j.trigger, j.actor, j.prAuthor].filter(Boolean).map((p) => (p as Person).login);
export const repoShort = (r?: string) => (r || "").split("/").pop() || "";
export const shortSha = (s?: string) => (s ? s.slice(0, 7) : "-");
export const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
export const QSTAT = new Set(["queued", "waiting", "pending", "requested"]);
/** A job still "queued" 6 h on is an orphan of a run that already finished (GitHub never hands it out). */
export const GHOST_MS = 6 * 3600e3;
export const isGhost = (j: Job, now = Date.now()) => now - Date.parse(j.createdAt || "0") > GHOST_MS;
/** A label set that needs one of our own runners (not a GitHub-hosted image). */
export const needsSelfHosted = (ls: string[]) => ls.length > 0 && !(ls.some((l) => /^(ubuntu|windows|macos)-/.test(l)) && !ls.includes("self-hosted"));
export const ANSI = /\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007]*\u0007/g;

export function fmtDur(ms: number): string {
  if (!(ms >= 0)) return "";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}
export const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
/** The sort key of the Whole org / My machine lists (newest first); the Queue sorts by createdAt, oldest first. */
export const rowKey = (j: Job) => Date.parse(j.startedAt || j.createdAt || "") || 0;
