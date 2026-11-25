"use client";
// The "Your work" answer (/api/p/<id>/mine), shared by the sidebar badge, the notifier and the page: ONE poll per project
// (every 60 s while the tab is visible, at once when it becomes visible again), however many components listen.
import { useCallback, useSyncExternalStore } from "react";

export type Who = { by: string; at: string } | null;
export type MineIssue = {
  number: number;
  title: string;
  url: string;
  updated: string;
  why: "assigned" | "opened" | "both";
  labels: { name: string; color: string }[];
  last: Who;
  newReply: boolean;
  replyBy: string | null;
  replyAt: string | null;
  linked: { number: number; url: string; state: "OPEN" | "MERGED" | "CLOSED"; closes: boolean }[];
};
export type MinePr = {
  number: number;
  title: string;
  url: string;
  draft: boolean;
  updated: string;
  stage: string;
  parent: number | null;
  group: "needs" | "waiting" | "ready";
  reason: string;
  last: Who;
  replyBy: string | null;
  replyAt: string | null;
  ci: { pass: number; fail: number; run: number };
};
export type MineAsk = { kind: "review" | "mention"; type: "pr" | "issue"; number: number; title: string; url: string; by: string | null; at: string };
export type Mine = {
  me: string | null;
  repo: string | null;
  issues: MineIssue[];
  prs: MinePr[] | null;
  asked: MineAsk[];
  attention: { key: string; kind: "reply" | "review" | "mention"; number: number; by: string | null; title: string }[];
  counts: { issues: number; issuesNew: number; prs: number; needs: number; waiting: number; ready: number; asked: number; needsYou: number } | null;
  at: number;
  error: { code: string; text: string } | null;
  boardLoading: boolean;
  boardError: string | null;
};

type Snap = { data: Mine | null; failed: boolean };
type Entry = { snap: Snap; subs: Set<() => void>; timer: ReturnType<typeof setTimeout> | null; busy: boolean };
const EMPTY: Snap = { data: null, failed: false };
const entries = new Map<string, Entry>();
const entryOf = (pid: string) => {
  let e = entries.get(pid);
  if (!e) entries.set(pid, (e = { snap: { data: null, failed: false }, subs: new Set(), timer: null, busy: false }));
  return e;
};

async function load(pid: string, force = false) {
  const e = entryOf(pid);
  if (e.busy && !force) return;
  e.busy = true;
  try {
    const r = await fetch(`/api/p/${pid}/mine${force ? "?refresh=1" : ""}`, { cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    e.snap = { data: (await r.json()) as Mine, failed: false };
  } catch {
    e.snap = { ...e.snap, failed: true };
  } finally {
    e.busy = false;
    e.subs.forEach((f) => f());
  }
}

function schedule(pid: string) {
  const e = entryOf(pid);
  if (e.timer) clearTimeout(e.timer);
  // Still loading the board or the first read: look again soon; otherwise the board's own cadence.
  const soon = !e.snap.data || e.snap.data.boardLoading || e.snap.failed;
  e.timer = setTimeout(async () => {
    if (!document.hidden) await load(pid);
    if (e.subs.size) schedule(pid);
  }, soon ? 5000 : 60000);
}

function subscribe(pid: string, cb: () => void) {
  const e = entryOf(pid);
  e.subs.add(cb);
  if (e.subs.size === 1) {
    if (!e.snap.data) load(pid).then(() => schedule(pid));
    else schedule(pid);
  }
  const vis = () => { if (!document.hidden) load(pid); };
  document.addEventListener("visibilitychange", vis);
  return () => {
    e.subs.delete(cb);
    document.removeEventListener("visibilitychange", vis);
    if (!e.subs.size && e.timer) { clearTimeout(e.timer); e.timer = null; }
  };
}

/** The project's "Your work" answer (null until the first answer), whether the last call failed, and a forced refresh. */
export function useMine(pid: string) {
  const sub = useCallback((cb: () => void) => subscribe(pid, cb), [pid]);
  const snap = useSyncExternalStore(sub, () => entryOf(pid).snap, () => EMPTY);
  const refresh = useCallback(() => load(pid, true), [pid]);
  return { data: snap.data, failed: snap.failed, refresh };
}
