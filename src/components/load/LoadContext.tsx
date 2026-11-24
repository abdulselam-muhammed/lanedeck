"use client";
// Machine load (GET /api/load, sampled by the server every ~5 s): one poll for the whole shell, shared by the
// banner (every page) and the "Machine load" page. Polls only while the tab is visible.
import React from "react";

export type LoadGroup = { key: string; label: string; kind: string; count: number; memMB: number; cores: number; tools: string[]; ageS: number };
export type LoadContainer = { name: string; image: string; status: string; project: string | null; ageS: number | null; e2e: boolean };
export type LoadData = {
  machines?: { id: string; label: string }[];
  ready: boolean;
  thresholds: { ram: number; cpu: number; disk: number; pagedPoolGB?: number };
  current?: { t: number; cpu: number; ram: number; ramUsedMB: number; ramTotalMB: number; disk: number };
  kernel?: { pagedMB: number; nonpagedMB: number; uptimeS: number; procsWsMB: number; at: number } | null;
  history?: [number, number, number, number][];
  alert?: { high: boolean; reasons: string[]; cause: string; eta: { minutes: number | null; why: string; approximate: boolean; untilRestart?: boolean } };
  agents?: { worktrees: number; active: number };
  nodeCount?: number;
  groups?: LoadGroup[];
  docker?: { at: number; ok: boolean; stale: boolean; containers: LoadContainer[]; ci: { running: boolean; job: boolean; busyFor: number | null } };
  typical?: { e2e: number; tool: number };
  /** What this OS supports and why a part is off (server/platform.mjs). */
  features?: { platform: string; platformName: string; processSampler: boolean; wsl: boolean; nativeDocker: boolean; note: string | null };
  status?: { sampler: { ok: boolean; reason: string | null }; docker: { ok: boolean; reason: string | null } };
};

const Ctx = React.createContext<{ data: LoadData | null; error: boolean }>({ data: null, error: false });
export const useLoad = () => React.useContext(Ctx);

export function LoadProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = React.useState<LoadData | null>(null);
  const [error, setError] = React.useState(false);
  React.useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (!document.hidden) {
        try {
          const r = await fetch("/api/load", { cache: "no-store" });
          if (!stop && r.ok) { setData(await r.json()); setError(false); }
        } catch { if (!stop) setError(true); }
      }
      if (!stop) timer = setTimeout(tick, 5000);
    };
    tick();
    const onVis = () => { if (!document.hidden) { clearTimeout(timer); tick(); } };
    document.addEventListener("visibilitychange", onVis);
    return () => { stop = true; clearTimeout(timer); document.removeEventListener("visibilitychange", onVis); };
  }, []);
  return <Ctx.Provider value={{ data, error }}>{children}</Ctx.Provider>;
}

// ---- remote machines (read-only over ssh; the server samples one only while this hook is polling it) ----
export type MachineRef = { id: string; label: string };
export type RemoteProc = { pid: number; cpu: number; mem: number; etime: string; ageS: number | null; comm: string; group: "ci" | "docker" | "other" };
export type RemoteContainer = { name: string; image: string; status: string; project: string | null; ageS: number | null; group: "runner" | "job" | "project" | "other" };
export type RemoteLoad = {
  ready: boolean; machine: string; machines: MachineRef[]; kind: "remote"; label: string;
  thresholds: { ram: number; cpu: number; disk: number };
  reachable: boolean; lastSeen: number | null; now: number;
  current?: { t: number; cpu: number; ram: number; ramUsedMB: number; ramTotalMB: number; disk: number };
  cpuKnown?: boolean;
  history?: [number, number, number, number][];
  alert?: { high: boolean; reasons: string[] };
  load?: number[] | null;
  root?: { usedB: number; totalB: number; pct: number } | null;
  procs?: RemoteProc[]; containers?: RemoteContainer[];
  ci?: { running: boolean; job: boolean; busyFor: number | null };
};

/** Polls /api/load?machine=<id> every 5 s while the tab is visible (the server samples the remote every ~10 s, only while polled). */
export function useRemoteLoad(machine: string | null) {
  const [data, setData] = React.useState<RemoteLoad | null>(null);
  const [error, setError] = React.useState(false);
  React.useEffect(() => {
    setData(null); setError(false);
    if (!machine) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (!document.hidden) {
        try {
          const r = await fetch(`/api/load?machine=${encodeURIComponent(machine)}`, { cache: "no-store" });
          if (!stop && r.ok) { setData(await r.json()); setError(false); } else if (!stop) setError(true);
        } catch { if (!stop) setError(true); }
      }
      if (!stop) timer = setTimeout(tick, 5000);
    };
    tick();
    const onVis = () => { if (!document.hidden) { clearTimeout(timer); tick(); } };
    document.addEventListener("visibilitychange", onVis);
    return () => { stop = true; clearTimeout(timer); document.removeEventListener("visibilitychange", onVis); };
  }, [machine]);
  return { data, error };
}
