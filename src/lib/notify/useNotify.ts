"use client";
// The GitHub side of the Inbox (/api/notify, server/notify/notify.mjs), shared by the tabs, the sidebar badges and the
// notifier: one store per scope ("all" or a project id), however many components listen. The server PUSHES it over the
// page's live channel (the sticky `notify.data` / `notify.state` SSE events, server/notify/push.mjs, wired in InboxContext),
// so nothing here polls: a scope is fetched once only if it has no data yet, and a mark-read answers with the new rows.
// Nothing here talks to GitHub: the one server poller does, read-only (a manual Refresh asks it, rate-limited there).
import { useCallback, useSyncExternalStore } from "react";

export type GhSection = "mentions" | "replies" | "review" | "reviews" | "assigned" | "state" | "other";
export const GH_SECTIONS: GhSection[] = ["mentions", "replies", "review", "reviews", "assigned", "state", "other"];
export type GhItem = {
  id: string;
  repo: string;
  projects: string[];
  section: GhSection;
  /** What actually happened (server/notify/events.mjs EVENTS): the row's sentence, badge and chip follow it. */
  event: string;
  /** The latest event is your own action: never unread, worded "You ...". */
  self: boolean;
  /** The event is known (false while the thread has not been read yet: a generic row). */
  resolved: boolean;
  /** Why GitHub subscribed you (sticky): only shown as the "why" of a generic row. */
  reason: string;
  type: string;
  number: number | null;
  /** A commit's short sha or a release's name, for threads without a number. */
  ref: string | null;
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
  /** Only on an archived row: when it was archived (local; nothing is written to GitHub). */
  archivedAt?: string;
};
export type GhStateCode = "ok" | "loading" | "disabled" | "norepos" | "nogh" | "auth" | "scope" | "ratelimit" | "budget" | "network" | "failed";
export type GhAnswer = {
  state: { code: GhStateCode; text: string | null; at: number | null; checkedAt: number | null; nextAt: number | null; resetAt: number | null; pollSeconds: number };
  settings: { enabled: boolean; sections: GhSection[]; pollSeconds: number; hideSelf: boolean; browser: boolean };
  repos: string[];
  items: GhItem[];
  /** The archived rows of the scope (local): a thread with newer activity leaves this list and is back in `items`. */
  archived: GhItem[];
  counts: { total: number; unread: number; sections: Record<GhSection, number>; archived: number };
};

type Snap = { data: GhAnswer | null; failed: boolean };
type Entry = { snap: Snap; subs: Set<() => void>; busy: boolean };
const EMPTY: Snap = { data: null, failed: false };
const entries = new Map<string, Entry>();
const entryOf = (scope: string) => {
  let e = entries.get(scope);
  if (!e) entries.set(scope, (e = { snap: { data: null, failed: false }, subs: new Set(), busy: false }));
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
      // the other scopes show the same rows: the server pushes them (notify.data)
      return j.changed ?? 0;
    }
  } catch {
    /* offline: the next read shows the truth */
  }
  return 0;
}

function subscribe(scope: string, cb: () => void) {
  const e = entryOf(scope);
  e.subs.add(cb);
  // The push usually arrives first (it is replayed on connect); the read only fills a scope that has nothing yet.
  if (e.subs.size === 1 && !e.snap.data) void load(scope);
  return () => {
    e.subs.delete(cb);
  };
}

// ---------- the push: the server's rows and state for this page's scopes ----------
/** `notify.data` { scopes: { <scope>: GhAnswer } }: the rows changed. */
export function notifyData(d: unknown) {
  const scopes = (d as { scopes?: Record<string, GhAnswer> } | null)?.scopes;
  if (!scopes) return;
  for (const [k, a] of Object.entries(scopes)) {
    const e = entryOf(k);
    e.snap = { data: a, failed: false };
    e.subs.forEach((f) => f());
  }
}
/** `notify.state` { scopes: { <scope>: state } }: a poll ran (when it was checked, the next check); the rows are unchanged. */
export function notifyState(d: unknown) {
  const scopes = (d as { scopes?: Record<string, GhAnswer["state"]> } | null)?.scopes;
  if (!scopes) return;
  for (const [k, st] of Object.entries(scopes)) {
    const e = entries.get(k);
    if (!e?.snap.data) continue;
    e.snap = { data: { ...e.snap.data, state: st }, failed: false };
    e.subs.forEach((f) => f());
  }
}

// ---------- the live event: the server found new unread rows ----------
export type GhFresh = { at: number; fresh: GhItem[] };
const freshSubs = new Set<(d: GhFresh) => void>();
/** Called by the page's SSE channel (InboxContext) for every `notify` event (the rows themselves come as notify.data). */
export function notifyEvent(d: unknown) {
  const ev = d as GhFresh;
  if (ev && Array.isArray(ev.fresh)) freshSubs.forEach((f) => f(ev));
}
/** Listen to new unread rows (the toast notifier). */
export function onFresh(fn: (d: GhFresh) => void) {
  freshSubs.add(fn);
  return () => void freshSubs.delete(fn);
}

/** The GitHub rows of a scope (null until the first answer), and the mark-read / mark-unread / archive / restore / refresh actions. */
export function useNotify(scope: string) {
  const sub = useCallback((cb: () => void) => subscribe(scope, cb), [scope]);
  const snap = useSyncExternalStore(sub, () => entryOf(scope).snap, () => EMPTY);
  const markRead = useCallback((ids: string[]) => post(scope, "/read", { ids }), [scope]);
  const markUnread = useCallback((ids: string[]) => post(scope, "/read", { ids, unread: true }), [scope]);
  const markAllRead = useCallback(() => post(scope, "/read", { all: true }), [scope]);
  const refresh = useCallback(() => post(scope, "/refresh", {}), [scope]);
  const archive = useCallback((ids: string[]) => post(scope, "/archive", { ids }), [scope]);
  const archiveRead = useCallback(() => post(scope, "/archive", { read: true }), [scope]);
  const restore = useCallback((ids: string[]) => post(scope, "/restore", { ids }), [scope]);
  const restoreAll = useCallback(() => post(scope, "/restore", { all: true }), [scope]);
  return { data: snap.data, failed: snap.failed, markRead, markUnread, markAllRead, refresh, archive, archiveRead, restore, restoreAll };
}
