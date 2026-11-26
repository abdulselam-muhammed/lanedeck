"use client";
// The GitHub side of the Inbox (/api/notify, server/notify/notify.mjs), shared by the tabs, the sidebar badges and the
// notifier: ONE fetch per scope ("all" or a project id), however many components listen. It is read again when the server
// says something new arrived (the `notify` SSE event, see InboxContext), when the tab becomes visible, after a mark-read,
// and every 2 minutes as a fallback. Nothing here talks to GitHub: the server does, read-only.
import { useCallback, useSyncExternalStore } from "react";

export type GhSection = "mentions" | "replies" | "review" | "reviews" | "assigned" | "state";
export const GH_SECTIONS: GhSection[] = ["mentions", "replies", "review", "reviews", "assigned", "state"];
export type GhItem = {
  id: string;
  repo: string;
  projects: string[];
  section: GhSection;
  reason: string;
  type: string;
  number: number | null;
  title: string;
  url: string | null;
  actor: string | null;
  /** The actor's picture (avatars.githubusercontent.com only), or null. */
  avatar: string | null;
  excerpt: string;
  review: string | null;
  state: string | null;
  at: string;
  unread: boolean;
};
export type GhStateCode = "ok" | "loading" | "disabled" | "norepos" | "nogh" | "auth" | "scope" | "ratelimit" | "budget" | "network" | "failed";
export type GhAnswer = {
  state: { code: GhStateCode; text: string | null; at: number | null; checkedAt: number | null; nextAt: number | null; resetAt: number | null; pollSeconds: number };
  settings: { enabled: boolean; sections: GhSection[]; pollSeconds: number; browser: boolean };
  repos: string[];
  items: GhItem[];
  counts: { total: number; unread: number; sections: Record<GhSection, number> };
};

type Snap = { data: GhAnswer | null; failed: boolean };
type Entry = { snap: Snap; subs: Set<() => void>; timer: ReturnType<typeof setTimeout> | null; busy: boolean };
const EMPTY: Snap = { data: null, failed: false };
const entries = new Map<string, Entry>();
const entryOf = (scope: string) => {
  let e = entries.get(scope);
  if (!e) entries.set(scope, (e = { snap: { data: null, failed: false }, subs: new Set(), timer: null, busy: false }));
  return e;
};
const urlOf = (scope: string, sub = "") => (scope === "all" ? `/api/notify${sub}?scope=all` : `/api/p/${encodeURIComponent(scope)}/notify${sub}`);

async function load(scope: string) {
  const e = entryOf(scope);
  if (e.busy) return;
  e.busy = true;
  try {
    const r = await fetch(urlOf(scope), { cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    e.snap = { data: (await r.json()) as GhAnswer, failed: false };
  } catch {
    e.snap = { ...e.snap, failed: true };
  } finally {
    e.busy = false;
    e.subs.forEach((f) => f());
  }
}

async function post(scope: string, sub: string, body: unknown) {
  const e = entryOf(scope);
  try {
    const r = await fetch(urlOf(scope, sub), { method: "POST", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) {
      const j = (await r.json()) as GhAnswer & { changed?: number };
      e.snap = { data: j, failed: false };
      e.subs.forEach((f) => f());
      // the other scopes show the same rows: read them again
      for (const [k] of entries) if (k !== scope) void load(k);
      return j.changed ?? 0;
    }
  } catch {
    /* offline: the next read shows the truth */
  }
  return 0;
}

function schedule(scope: string) {
  const e = entryOf(scope);
  if (e.timer) clearTimeout(e.timer);
  e.timer = setTimeout(async () => {
    if (!document.hidden) await load(scope);
    if (e.subs.size) schedule(scope);
  }, !e.snap.data || e.snap.data.state.code === "loading" ? 6000 : 120000);
}

function subscribe(scope: string, cb: () => void) {
  const e = entryOf(scope);
  e.subs.add(cb);
  if (e.subs.size === 1) {
    if (!e.snap.data) load(scope).then(() => schedule(scope));
    else schedule(scope);
  }
  const vis = () => {
    if (!document.hidden) load(scope);
  };
  document.addEventListener("visibilitychange", vis);
  return () => {
    e.subs.delete(cb);
    document.removeEventListener("visibilitychange", vis);
    if (!e.subs.size && e.timer) {
      clearTimeout(e.timer);
      e.timer = null;
    }
  };
}

// ---------- the live event: the server found new unread rows ----------
export type GhFresh = { at: number; fresh: GhItem[] };
const freshSubs = new Set<(d: GhFresh) => void>();
/** Called by the page's SSE channel (InboxContext) for every `notify` event. */
export function notifyEvent(d: unknown) {
  for (const k of entries.keys()) void load(k);
  const ev = d as GhFresh;
  if (ev && Array.isArray(ev.fresh)) freshSubs.forEach((f) => f(ev));
}
/** Listen to new unread rows (the toast notifier). */
export function onFresh(fn: (d: GhFresh) => void) {
  freshSubs.add(fn);
  return () => void freshSubs.delete(fn);
}

/** The GitHub rows of a scope (null until the first answer), and the mark-read / mark-unread / refresh actions. */
export function useNotify(scope: string) {
  const sub = useCallback((cb: () => void) => subscribe(scope, cb), [scope]);
  const snap = useSyncExternalStore(sub, () => entryOf(scope).snap, () => EMPTY);
  const markRead = useCallback((ids: string[]) => post(scope, "/read", { ids }), [scope]);
  const markUnread = useCallback((ids: string[]) => post(scope, "/read", { ids, unread: true }), [scope]);
  const markAllRead = useCallback(() => post(scope, "/read", { all: true }), [scope]);
  const refresh = useCallback(() => post(scope, "/refresh", {}), [scope]);
  return { data: snap.data, failed: snap.failed, markRead, markUnread, markAllRead, refresh };
}
