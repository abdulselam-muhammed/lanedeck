"use client";
// The live state of the /ci page: ONE WebSocket (/api/ci/ws, src/lib/ci/socket.ts) opened while the page is mounted and
// closed when it unmounts. It carries the server-computed aggregates (KPI numbers, hourly bins), the runner list, this
// machine's runner cards, the GitHub meta and the queue-depth series (capped at 24 h = 2880 points). Job rows are NOT
// kept here: every list tab fetches its own pages (useCiList) and patches them from the `jobs` messages it subscribes to
// with onJobs. After a reconnect `epoch` changes, so the tabs re-read their first page (they may have missed rows).
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { openCiSocket, type CiMsg } from "@/lib/ci/socket";
import type { Agg, Job, Meta, QdPoint, RunnerEntry, RunnersState } from "@/lib/ci/model";

const MAX_QD = 2880;
type Ctx = {
  agg: Agg | null;
  runners: RunnerEntry[] | null;
  state: RunnersState | null;
  meta: Meta | null;
  qd: QdPoint[] | null;
  live: boolean;
  updatedAt: number | null;
  epoch: number;
  /** subscribe to the changed rows pushed by the server; returns the unsubscribe */
  onJobs: (fn: (rows: Job[]) => void) => () => void;
};
const C = createContext<Ctx | null>(null);
export const useCi = () => {
  const c = useContext(C);
  if (!c) throw new Error("CiProvider missing");
  return c;
};

export function CiProvider({ children }: { children: React.ReactNode }) {
  const [agg, setAgg] = useState<Agg | null>(null);
  const [runners, setRunners] = useState<RunnerEntry[] | null>(null);
  const [state, setState] = useState<RunnersState | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [qd, setQd] = useState<QdPoint[] | null>(null);
  const [live, setLive] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [epoch, setEpoch] = useState(0);
  const subs = useRef(new Set<(rows: Job[]) => void>());
  const onJobs = useCallback((fn: (rows: Job[]) => void) => {
    subs.current.add(fn);
    return () => void subs.current.delete(fn);
  }, []);

  useEffect(() => {
    const listeners = subs.current;
    let hellos = 0;
    let stamped = 0;
    const apply = (m: CiMsg) => {
      // "last update" is shown to the second; a burst of job rows does not need a re-render per message
      if (m.t !== "jobs" || Date.now() - stamped > 3000) {
        stamped = Date.now();
        setUpdatedAt(stamped);
      }
      switch (m.t) {
        case "hello":
          if (hellos++ > 0) setEpoch((n) => n + 1);
          setAgg(m.agg as Agg);
          setRunners(m.runners as RunnerEntry[]);
          setState(m.state as RunnersState);
          setMeta(m.meta as Meta);
          setQd((m.qd as QdPoint[]).slice(-MAX_QD));
          break;
        case "agg":
          setAgg(m.agg as Agg);
          break;
        case "runners":
          setRunners(m.runners as RunnerEntry[]);
          break;
        case "state":
          setState(m.state as RunnersState);
          break;
        case "meta":
          setMeta(m.meta as Meta);
          break;
        case "qd":
          setQd((p) => [...(p || []), m.p as QdPoint].slice(-MAX_QD));
          break;
        case "jobs":
          for (const f of listeners) f(m.rows as Job[]);
          break;
      }
    };
    const close = openCiSocket({ onMessage: apply, onOpen: () => setLive(true), onClose: () => setLive(false) });
    return () => {
      close();
      listeners.clear();
    };
  }, []);

  const value = useMemo(() => ({ agg, runners, state, meta, qd, live, updatedAt, epoch, onJobs }), [agg, runners, state, meta, qd, live, updatedAt, epoch, onJobs]);
  return <C.Provider value={value}>{children}</C.Provider>;
}
