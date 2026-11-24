// Types and pure helpers of the PR control board (/prs). The server computes the stage and who a PR waits for
// (server/prs/board.mjs); this file only names, colours and summarises them.
import type { TFn } from "@/context/ConfigContext";
import type { Vars } from "../../../server/i18n/index.mjs";

export type CheckState = "pass" | "fail" | "run" | "queue" | "skip" | "neutral" | "cancel";
export type Check = { n: string; s: CheckState; u: string; a: string | null; z: string | null };
export type Stage =
  | "push-now"
  | "code-conflict"
  | "ci-failed"
  | "changes"
  | "board-conflict"
  | "review"
  | "ready"
  | "ci-running"
  | "stacked"
  | "computing"
  | "measuring"
  | "local-ready"
  | "held"
  | "draft";
export type Who = "us" | "reviewer" | "ci" | "parent" | "github" | "viewer" | "owner" | "local" | "none";
export type Pr = {
  number: number;
  title: string;
  url: string;
  author: string;
  draft: boolean;
  head: string;
  headRef: string;
  base: string;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  state: string;
  review: string | null;
  created: string;
  updated: string;
  pushed: string | null;
  size: { add: number; del: number; files: number };
  ci: {
    rollup: string | null;
    gate: CheckState | null;
    total: number;
    pass: number;
    fail: number;
    run: number;
    queue: number;
    skip: number;
    failed: string[];
    failedUrls: string[];
    started: string | null;
    finished: string | null;
    checks: Check[];
  };
  batch?: { n: number; name: string; track: string; branch: string | null; ahead: number; current: boolean } | null;
  stage: Stage;
  who: Who;
  why: string;
  parent?: number;
  conflictFiles: string[];
  children: number[];
  mine: boolean;
  stale?: boolean;
  measured?: boolean;
};
export type Merged = { number: number; title: string; url: string; author: string; at: string; by: string; sha: string };
export type Board = {
  at: number;
  readAt: number;
  mergedReadAt: number;
  error: string | null;
  me: string | null;
  tip: { sha: string; at: string; msg: string } | null;
  rl: { cost: number; remaining: number; resetAt: string } | null;
  measuring: boolean;
  prs: Pr[];
  merged: Merged[];
  perDay: [string, number][];
  holds: Record<string, string>;
  loading?: boolean;
};
export type PrEvent = {
  t: number;
  k: "merged" | "opened" | "pushed" | "conflict" | "unconflict" | "green" | "red" | "check-failed" | "approved" | "changes" | "closed" | "tip" | "code-conflict";
  n?: number;
  title?: string;
  by?: string;
  author?: string;
  sha?: string;
  msg?: string;
  failed?: string[];
  files?: string[];
};

/** Stage order = how urgent it is for us (first = act now). */
export const STAGES: { s: Stage; color: string; tone: "error" | "warning" | "brand" | "success" | "gray" | "info" }[] = [
  { s: "push-now", color: "#ef4444", tone: "error" },
  { s: "code-conflict", color: "#f43f5e", tone: "error" },
  { s: "ci-failed", color: "#fb7185", tone: "error" },
  { s: "changes", color: "#f97316", tone: "warning" },
  { s: "board-conflict", color: "#f59e0b", tone: "warning" },
  { s: "review", color: "#a78bfa", tone: "info" },
  { s: "ready", color: "#2dd4bf", tone: "success" },
  { s: "ci-running", color: "#38bdf8", tone: "brand" },
  { s: "stacked", color: "#60a5fa", tone: "brand" },
  { s: "computing", color: "#94a3b8", tone: "gray" },
  { s: "measuring", color: "#94a3b8", tone: "gray" },
  { s: "local-ready", color: "#818cf8", tone: "info" },
  { s: "held", color: "#64748b", tone: "gray" },
  { s: "draft", color: "#475569", tone: "gray" },
];
/** Display name of a stage, from the dictionary. */
export const stageLabel = (t: TFn, s: Stage | string) => (s === "draft" ? "Draft" : t(`prs.stage.${s}`));
export const stageOf = (s: Stage) => STAGES.find((x) => x.s === s) ?? STAGES[STAGES.length - 1];
export const STAGE_RANK: Record<string, number> = Object.fromEntries(STAGES.map((x, i) => [x.s, i]));

/** Dictionary keys of the "who is it waiting on" labels (reviewer: wording comes from the profile, see whoLabel()). */
export const WHO_KEY: Partial<Record<Who, string>> = {
  us: "prs.who.us", ci: "prs.who.ci", parent: "prs.who.parent", viewer: "prs.who.viewer", owner: "prs.who.owner", local: "prs.who.local",
};

export const EVENT_TEXT: Record<PrEvent["k"], { icon: string; tone: "error" | "warning" | "success" | "brand" | "gray" }> = {
  merged: { icon: "check-check", tone: "success" },
  opened: { icon: "plus", tone: "brand" },
  pushed: { icon: "git-fork", tone: "gray" },
  conflict: { icon: "alert", tone: "warning" },
  unconflict: { icon: "circle-check", tone: "success" },
  green: { icon: "circle-check", tone: "success" },
  red: { icon: "x", tone: "error" },
  "check-failed": { icon: "x", tone: "error" },
  approved: { icon: "check", tone: "success" },
  changes: { icon: "pencil", tone: "warning" },
  closed: { icon: "minus", tone: "gray" },
  tip: { icon: "activity", tone: "brand" },
  "code-conflict": { icon: "alert", tone: "error" },
};

/** Display name of a board event ("approved" is a GitHub word and stays as is). */
export const eventLabel = (t: TFn, k: PrEvent["k"], vars: Vars = {}) => (k === "approved" ? "approved" : t(`prs.event.${k}`, vars));

export const whoLabel = (w: Who, t: TFn) => (w === "reviewer" ? t("who.reviewer") : w === "github" ? "GitHub" : w === "none" ? "—" : t(WHO_KEY[w] ?? ""));

/** Board files are the ones the config lists (projects[0].boardFiles): the reviewer resolves their conflicts. */
export const isBoardFile = (files: string[]) => (f: string) => files.includes(f);

export const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : 0);
export const days = (iso: string | null | undefined) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / 864e5) : 0);

/** The board's "what matters now" lines, derived from the numbers (no guessing beyond them). */
export function insights(b: Board, mineOnly: boolean, t: TFn) {
  const prs = b.prs.filter((p) => !mineOnly || p.mine);
  const by = (s: Stage) => prs.filter((p) => p.stage === s);
  const out: { tone: "error" | "warning" | "success" | "brand" | "gray"; text: string; prs?: number[] }[] = [];
  const code = by("code-conflict");
  if (code.length) out.push({ tone: "error", text: t("prs.ins.code", { n: code.length }), prs: code.map((p) => p.number) });
  const failed = by("ci-failed");
  if (failed.length) {
    const freq = new Map<string, number>();
    for (const p of failed) for (const f of p.ci.failed.length ? p.ci.failed : ["required check"]) freq.set(f, (freq.get(f) ?? 0) + 1);
    const top = [...freq.entries()].sort((a, c) => c[1] - a[1])[0];
    out.push({
      tone: "error",
      text: t("prs.ins.failed", { n: failed.length, top: top && top[1] > 1 ? t("prs.ins.failedTop", { name: top[0], count: top[1] }) : "" }),
      prs: failed.map((p) => p.number),
    });
  }
  const board = by("board-conflict");
  if (board.length) out.push({ tone: "warning", text: t("ins.board", { n: board.length }), prs: board.map((p) => p.number) });
  const ready = by("ready");
  if (ready.length) {
    const oldest = [...ready].sort((a, c) => ms(a.created) - ms(c.created))[0];
    const behind = ready.filter((p) => p.state === "BEHIND").length;
    out.push({
      tone: "success",
      text: t("ins.ready", { n: ready.length, behind: behind ? t("ins.readyBehind", { n: behind }) : "", oldest: oldest.number, days: days(oldest.created) }),
      prs: ready.map((p) => p.number),
    });
  }
  const review = by("review");
  if (review.length) out.push({ tone: "brand", text: t("prs.ins.review", { n: review.length }), prs: review.map((p) => p.number) });
  const running = by("ci-running");
  if (running.length) out.push({ tone: "brand", text: t("prs.ins.running", { n: running.length }), prs: running.map((p) => p.number) });
  const stacked = by("stacked");
  if (stacked.length) out.push({ tone: "gray", text: t("prs.ins.stacked", { n: stacked.length }), prs: stacked.map((p) => p.number) });
  const day = Date.now() - 864e5;
  const m24 = b.merged.filter((m) => Date.parse(m.at) > day);
  out.push({ tone: m24.length ? "success" : "gray", text: m24.length ? t("prs.ins.merged24", { n: m24.length }) : t("prs.ins.none24"), prs: m24.map((m) => m.number) });
  return out;
}
