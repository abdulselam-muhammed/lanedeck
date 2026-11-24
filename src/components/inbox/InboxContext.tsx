"use client";
// The page's state (moved from the old index.html): the SSE snapshot, the tree, selection, filters,
// collapsed state, unread tracking per file hash, new-question tracking, notifications, the default-branch check.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Agent,
  buildTree,
  emptyTree,
  Filter,
  hrefOf,
  keyOfPath,
  InboxFile,
  isReadme,
  computeMetrics,
  emptyMetrics,
  Metrics,
  parseFile,
  RawFile,
  Protocol,
  Snapshot,
  store,
  titleOf,
  setModelT,
  Tree,
} from "@/lib/inbox/model";
import { openLive } from "@/lib/inbox/live";
import { useConfig, useMark, useProject, useT } from "@/context/ConfigContext";

/** The runners summary of the `ci.runners` event (server/ci/org.mjs aggregates, the fields the Overview shows). */
export type CiSum = { busy: number; total: number; queued: number; oursBusy: number; oursTotal: number; oldest: string | null; ok: boolean };

export type BranchCommit = { sha: string; subject: string; author: string; at: string; pr: string | null };
export type BranchData = {
  checkedAt: string;
  ourSha: string | null;
  pulledAt: string | null;
  latest: BranchCommit | null;
  behind: number | null;
  newer: BranchCommit[];
  before: BranchCommit[];
  days?: { since: string; ours: string[]; github: string[] | null };
  error: string | null;
  errorKind?: "budget" | "unreachable" | null;
  /** The project has no local clone (repoPath): only GitHub's tip is shown. */
  noLocalRepo?: boolean;
};
export type ToastKind = "" | "done" | "question";
export type ToastItem = { id: number; title: string; body: string; kind: ToastKind; key?: string };

type Ctx = {
  files: InboxFile[];
  agents: Agent[];
  /** The .selam-deck/ data of a protocol project; null in legacy mode. */
  protocol: Protocol | null;
  tree: Tree;
  connected: boolean;
  updatedAt: number | null;
  inboxError: string | null;
  selected: string;
  filter: Filter;
  collapsed: Record<string, boolean>;
  modes: Record<string, string>;
  freshQ: Set<string>;
  unreadOf: (f: InboxFile) => boolean;
  unreadCount: number;
  /** Tab/filter counts of the inbox LIST (rows). `active` = rows in the running state (files + agents), NOT "agents running". */
  counts: { all: number; active: number; waiting: number; questions: number };
  /** The single definition of every shared number (see lib/inbox/model.ts computeMetrics). */
  metrics: Metrics;
  ci: CiSum | null;
  branchData: BranchData | null;
  branchLoading: boolean;
  sound: boolean;
  toasts: ToastItem[];
  now: number;
  select: (key: string) => void;
  setFilter: (f: Filter) => void;
  toggleCollapsed: (key: string) => void;
  setMode: (file: string, mode: string) => void;
  markAllRead: () => void;
  loadBranch: (pull: boolean) => void;
  toggleSound: () => void;
  toast: (title: string, body: string, kind?: ToastKind, key?: string) => void;
  dismissToast: (id: number) => void;
  notifyHelp: boolean;
  setNotifyHelp: (v: boolean) => void;
  /** Per-viewer storage scoped to this project (the first project keeps the old unprefixed keys). */
  pstore: { get<T>(k: string, d: T): T; set(k: string, v: unknown): void };
};
const InboxCtx = createContext<Ctx | null>(null);
export const useInbox = () => {
  const c = useContext(InboxCtx);
  if (!c) throw new Error("useInbox outside InboxProvider");
  return c;
};

/** One inbox per project: remounts (fresh state, new SSE connection) when the current project changes. */
export function ProjectInboxProvider({ children }: { children: React.ReactNode }) {
  const { id } = useProject();
  return <InboxProvider key={id} projectId={id}>{children}</InboxProvider>;
}

function InboxProvider({ children, projectId }: { children: React.ReactNode; projectId: string }) {
  const cfg = useConfig();
  const tNow = useT();
  const tRef = useRef(tNow);
  tRef.current = tNow;
  setModelT(tNow, cfg.ui.lang);
  const { base, projects } = useProject();
  const pstore = useMemo(() => {
    const ns = projects.length && projects[0].id !== projectId ? `${projectId}.` : "";
    return { get: <T,>(k: string, d: T): T => store.get<T>(ns + k, d), set: (k: string, v: unknown) => store.set(ns + k, v) };
  }, [projectId, projects]);
  const markUrl = useMark().icon;
  const faviconUrl = useMark().favicon;
  const [files, setFiles] = useState<InboxFile[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [protocol, setProtocol] = useState<Protocol | null>(null);
  const [connected, setConnected] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [inboxError, setInboxError] = useState<string | null>(null);
  // The route decides what is on screen (the redesign); "selected" is the node or fixed view it shows.
  const pathname = usePathname();
  const router = useRouter();
  const selected = keyOfPath(pathname);
  const [filter, setFilterState] = useState<Filter>("all");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [modes, setModes] = useState<Record<string, string>>({});
  const [seenHash, setSeenHash] = useState<Record<string, number> | null>(null);
  const [freshQ, setFreshQ] = useState<Set<string>>(new Set());
  const [branchData, setBranchData] = useState<BranchData | null>(null);
  const [ci, setCi] = useState<CiSum | null>(null);
  const [branchLoading, setBranchDataLoading] = useState(false);
  const [sound, setSound] = useState(true);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [now] = useState(() => Date.now());
  const [notifyHelp, setNotifyHelp] = useState(false);
  const [ready, setReady] = useState(false);

  // Mutable mirrors for the SSE handler (it outlives renders).
  const filesRef = useRef<InboxFile[]>([]);
  const rawRef = useRef<Map<string, RawFile>>(new Map());
  const agentsRef = useRef<Map<string, Agent>>(new Map());
  const errorRef = useRef<string | null>(null);
  const seenHashRef = useRef<Record<string, number> | null>(null);
  const seenQRef = useRef<string[] | null>(null);
  const prevAgents = useRef<Map<string, string> | null>(null);
  const soundRef = useRef(true);
  const audio = useRef<AudioContext | null>(null);
  const toastId = useRef(0);
  const selectRef = useRef<(k: string) => void>(() => {});

  // Per-viewer state from localStorage (same keys as the old page, so nothing is lost).
  useEffect(() => {
    setFilterState(pstore.get<Filter>("filter", "all"));
    setCollapsed(pstore.get("collapsed", {}));
    setModes(pstore.get("mode", {}));
    const sh = pstore.get<Record<string, number> | null>("seenHash", null);
    seenHashRef.current = sh;
    setSeenHash(sh);
    seenQRef.current = pstore.get<string[] | null>("seenQ", null);
    const s = store.get("sound", true);
    soundRef.current = s;
    setSound(s);
    setReady(true);
  }, [pstore]);

  const tree = useMemo(() => (files.length || agents.length ? buildTree(files, agents) : emptyTree()), [files, agents]);
  const treeRef = useRef(tree);
  treeRef.current = tree;

  const beep = useCallback((question: boolean) => {
    if (!soundRef.current) return;
    try {
      const W = window as unknown as { AudioContext: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
      audio.current = audio.current || new (W.AudioContext || W.webkitAudioContext!)();
      const a = audio.current;
      const notes = question ? [880, 1175] : [660];
      notes.forEach((f, k) => {
        const o = a.createOscillator(),
          g = a.createGain();
        o.frequency.value = f;
        o.type = "sine";
        o.connect(g);
        g.connect(a.destination);
        const t = a.currentTime + k * 0.16;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        o.start(t);
        o.stop(t + 0.25);
      });
    } catch {}
  }, []);

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (title: string, body: string, kind: ToastKind = "", key?: string) => {
      const id = ++toastId.current;
      setToasts((t) => [{ id, title, body, kind, key }, ...t].slice(0, 8));
      setTimeout(() => dismissToast(id), 9000);
    },
    [dismissToast],
  );
  const notify = useCallback(
    (title: string, body: string, key: string, kind: ToastKind) => {
      toast(title, body, kind, key);
      beep(kind === "question");
      if ("Notification" in window && Notification.permission === "granted") {
        try {
          const n = new Notification(title, { body, tag: key + title, renotify: true, icon: markUrl, badge: markUrl } as NotificationOptions);
          n.onclick = () => {
            window.focus();
            selectRef.current(key);
            n.close();
          };
        } catch {}
      }
    },
    [toast, beep, markUrl],
  );

  const select = useCallback(
    (key: string) => {
      router.push(hrefOf(key, base));
      window.scrollTo({ top: 0 });
    },
    [router, base],
  );
  // The last node opened stays in localStorage["selamDeck.selected"], as before (/inbox reopens it).
  useEffect(() => {
    if (selected && !selected.startsWith("__")) pstore.set("selected", selected);
  }, [selected, pstore]);
  selectRef.current = select;

  const setFilter = useCallback((f: Filter) => {
    setFilterState(f);
    pstore.set("filter", f);
  }, [pstore]);
  const toggleCollapsed = useCallback((k: string) => {
    setCollapsed((c) => {
      const next = { ...c };
      if (k === "__others") next.__others = c.__others === false; // shut by default
      else next[k] = c[k] !== true;
      pstore.set("collapsed", next);
      return next;
    });
  }, [pstore]);
  const setMode = useCallback((file: string, mode: string) => {
    setModes((m) => {
      const next = { ...m, [file]: mode };
      pstore.set("mode", next);
      return next;
    });
  }, [pstore]);
  const toggleSound = useCallback(() => {
    soundRef.current = !soundRef.current;
    setSound(soundRef.current);
    store.set("sound", soundRef.current);
    if (soundRef.current) beep(true);
  }, [beep]);

  // ---------- live updates ----------
  const applyState = useCallback(
    (raw: RawFile[], nextAgents: Agent[], error: string | null) => {
      const next = raw.map(parseFile);
      if (seenHashRef.current === null) {
        seenHashRef.current = Object.fromEntries(next.map((f) => [f.name, f.hash]));
        seenQRef.current = next.flatMap((f) => f.questions.map((q) => f.name + "|" + q.id));
        pstore.set("seenHash", seenHashRef.current);
        pstore.set("seenQ", seenQRef.current);
        setSeenHash(seenHashRef.current);
      } else if (filesRef.current.length) {
        const seenQ = (seenQRef.current = seenQRef.current || []);
        const before = new Map(filesRef.current.map((f) => [f.name, f]));
        const fresh: string[] = [];
        for (const f of next) {
          if (isReadme(f)) continue;
          const newQs = f.questions.filter((q) => !seenQ.includes(f.name + "|" + q.id));
          newQs.forEach((q) => {
            seenQ.push(f.name + "|" + q.id);
            fresh.push(f.name + "|" + q.id);
          });
          if (newQs.length) notify(tRef.current("inbox.ev.newQuestion", { title: f.title }), newQs.map((q) => q.title).join(" · "), f.name, "question");
          else if (!before.has(f.name)) notify(tRef.current("inbox.ev.newFile", { title: f.title }), f.statusText || f.name, f.name, "");
          else if (before.get(f.name)!.hash !== f.hash) notify(tRef.current("inbox.ev.newNews", { title: f.title }), f.statusText || tRef.current("inbox.ev.fileChanged"), f.name, "");
        }
        if (fresh.length) setFreshQ((s) => new Set([...s, ...fresh]));
        pstore.set("seenQ", seenQ);
      }
      // agent events: new, finished, resumed
      const nextTree = buildTree(next, nextAgents);
      const keyOfAgent = (id: string) => {
        for (const n of nextTree.nodes.values()) if (n.kind === "file" && n.agent && n.agent.id === id) return n.key;
        return "agent:" + id;
      };
      const nowMap = new Map(nextAgents.map((a) => [a.id, a.state]));
      if (prevAgents.current) {
        for (const a of nextAgents) {
          const was = prevAgents.current.get(a.id),
            key = keyOfAgent(a.id);
          const node = nextTree.nodes.get(key);
          const name = node ? titleOf(node) : a.name;
          const sub = a.depth > 1;
          if (was === undefined && a.state === "run" && Date.now() - a.startedAt < 5 * 60e3) {
            if (sub) toast(tRef.current("inbox.ev.newSub", { name }), a.step || a.name, "", key);
            else notify(tRef.current("inbox.ev.newAgent", { name }), a.step || a.name, key, "");
          } else if (was && was !== "done" && a.state === "done") {
            if (sub) toast(tRef.current("inbox.ev.subDone", { name }), a.step || "", "done", key);
            else notify(tRef.current("inbox.ev.agentDone", { name }), a.step || tRef.current("inbox.ev.handedReport"), key, "done");
          } else if (was === "done" && a.state === "run") {
            toast(tRef.current("inbox.ev.resumed", { name }), a.step || "", "", key);
          }
        }
      }
      prevAgents.current = nowMap;
      filesRef.current = next;
      setFiles(next);
      setAgents(nextAgents);
      setInboxError(error || null);
      setUpdatedAt(Date.now());
    },
    [notify, toast, pstore],
  );

  // The typed events patch their own slice of the state: snapshot = everything, inbox = changed/removed files,
  // agents = changed/removed agents, ci.runners, branch. Transport + reconnect guarantee: lib/inbox/live.ts.
  useEffect(() => {
    if (!ready) return;
    const sortedRaw = () => [...rawRef.current.values()].sort((a, b) => a.name.localeCompare(b.name));
    return openLive({
      onStatus: setConnected,
      snapshot: (d) => {
        const snap = d as Snapshot;
        rawRef.current = new Map((snap.files || []).map((f) => [f.name, f]));
        agentsRef.current = new Map((snap.agents || []).map((a) => [a.id, a]));
        errorRef.current = snap.error || null;
        setProtocol(snap.protocol ?? null);
        applyState(sortedRaw(), [...agentsRef.current.values()], errorRef.current);
      },
      inbox: (d) => {
        const e = d as { changed: RawFile[]; removed: string[]; error: string | null };
        for (const f of e.changed) rawRef.current.set(f.name, f);
        for (const n of e.removed) rawRef.current.delete(n);
        errorRef.current = e.error;
        applyState(sortedRaw(), [...agentsRef.current.values()], errorRef.current);
      },
      agents: (d) => {
        const e = d as { changed: Agent[]; removed: string[] };
        for (const a of e.changed) agentsRef.current.set(a.id, a);
        for (const i of e.removed) agentsRef.current.delete(i);
        applyState(sortedRaw(), [...agentsRef.current.values()], errorRef.current);
      },
      "ci.runners": (d) => setCi({ ...(d as Omit<CiSum, "ok">), ok: true }),
      branch: (d) => setBranchData(d as BranchData),
      protocol: (d) => setProtocol((d as Protocol | null) ?? null),
      config: () => router.refresh(), // the settings page saved: the root layout re-reads the public config
    }, `/api/p/${projectId}/events`);
  }, [ready, applyState, router, projectId]);

  // Relative times are live through the shared clock in components/common/RelTime.tsx (not through this context).

  // ---------- unread ----------
  const unreadOf = useCallback((f: InboxFile) => !!seenHash && seenHash[f.name] !== f.hash, [seenHash]);
  // The file on screen is read: mark it seen as soon as it (or a new version of it) is shown.
  useEffect(() => {
    const n = tree.nodes.get(selected);
    const f = n?.file;
    if (!f || !seenHashRef.current || seenHashRef.current[f.name] === f.hash) return;
    seenHashRef.current = { ...seenHashRef.current, [f.name]: f.hash };
    pstore.set("seenHash", seenHashRef.current);
    setSeenHash(seenHashRef.current);
  }, [tree, selected, pstore]);
  // A file or agent that no longer exists falls back to its list.
  useEffect(() => {
    if (!updatedAt || !selected || selected.startsWith("__")) return;
    if (!tree.nodes.has(selected)) router.replace(pathname?.startsWith(base + "/flow") ? base + "/flow" : base + "/inbox");
  }, [tree, selected, updatedAt, router, pathname, base]);

  const unreadCount = files.filter(unreadOf).length;
  const markAllRead = useCallback(() => {
    const n = filesRef.current.filter((f) => !!seenHashRef.current && seenHashRef.current[f.name] !== f.hash).length;
    seenHashRef.current = Object.fromEntries(filesRef.current.map((f) => [f.name, f.hash]));
    pstore.set("seenHash", seenHashRef.current);
    setSeenHash(seenHashRef.current);
    setFreshQ(new Set());
    toast(n ? tRef.current("inbox.ev.markedRead", { n }) : tRef.current("inbox.ev.nothingUnread"), tRef.current("inbox.ev.questionsStay"), "");
  }, [toast, pstore]);

  const metrics = useMemo(() => (files.length || agents.length ? computeMetrics(files, agents, tree) : emptyMetrics()), [files, agents, tree]);
  const counts = useMemo(
    () => ({ all: metrics.nodes, active: metrics.activeNodes, waiting: metrics.waitingFiles, questions: metrics.questions }),
    [metrics],
  );

  // -- default-branch watch ----------
  const branchBusy = useRef(false);
  const loadBranch = useCallback(async (pull: boolean) => {
    if (branchBusy.current) return;
    branchBusy.current = true;
    setBranchDataLoading(true);
    try {
      setBranchData(await (await fetch(`/api/p/${projectId}/branch` + (pull ? "?pull=1" : ""), { cache: "no-store" })).json());
    } catch {}
    branchBusy.current = false;
    setBranchDataLoading(false);
  }, [projectId]);
  useEffect(() => {
    loadBranch(false); // first paint; afterwards the server pushes `branch` (no polling)
  }, [loadBranch]);

  // ---------- tab title + favicon ----------
  useEffect(() => {
    const q = counts.questions,
      running = metrics.agentsRunning,
      unread = unreadCount;
    document.title = (unread ? `(${unread}) ` : "") + (q ? `❓${q} · ` : "") + (running ? `▶${running} · ` : "") + cfg.ui.title;
    // Counts use the theme accent (brand-600); no red here, nothing in this counter is an alert.
    const color = "%230891b2";
    let link = document.getElementById("favicon") as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = "favicon";
      link.rel = "icon";
      document.head.appendChild(link);
    }
    // Nothing waiting: the app mark (Monitor); otherwise the coloured counter, as before.
    if (!q && !unread) {
      link.href = faviconUrl;
      return;
    }
    link.href = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='${color}'/><text x='16' y='22' font-size='18' text-anchor='middle' fill='white' font-family='Consolas,monospace' font-weight='700'>${q || unread || "S"}</text></svg>`;
  }, [counts, metrics, unreadCount, cfg.ui.title, faviconUrl]);

  const value: Ctx = {
    files,
    agents,
    protocol,
    tree,
    connected,
    updatedAt,
    inboxError,
    selected,
    filter,
    collapsed,
    modes,
    freshQ,
    unreadOf,
    unreadCount,
    counts,
    metrics,
    ci,
    branchData,
    branchLoading,
    sound,
    toasts,
    now,
    select,
    setFilter,
    toggleCollapsed,
    setMode,
    markAllRead,
    loadBranch,
    toggleSound,
    toast,
    dismissToast,
    notifyHelp,
    setNotifyHelp,
    pstore,
  };
  return <InboxCtx.Provider value={value}>{children}</InboxCtx.Provider>;
}
