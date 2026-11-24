"use client";
// One paginated list of the /ci page. The first page is fetched once per (list, filters); "Load more" fetches the next
// cursor; nothing polls. Rows already on screen are patched IN PLACE from the socket's `jobs` messages (no reflow);
// rows that would belong to the loaded range are held back and offered as "N new - show". Memory is bounded: at most
// MAX_ROWS rows per list, and the list is dropped with its tab (the hook unmounts with it).
import { useCallback, useEffect, useRef, useState } from "react";
import { rowKey, type Job, type Page } from "@/lib/ci/model";
import { useCi } from "./CiContext";

const MAX_ROWS = 600;
const PAGE = 50;
type Opts = {
  path: string;
  params: Record<string, string>;
  dir: "desc" | "asc";
  /** does a pushed row belong to this list (the filters, the tab's own rule)? */
  member: (j: Job) => boolean;
  /** an on-screen row stays only while this holds (the Queue drops what left the queue); default: always */
  stay?: (j: Job) => boolean;
};

export function useCiList<O = never>({ path, params, dir, member, stay }: Opts) {
  const { onJobs, epoch } = useCi();
  const [rows, setRows] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [next, setNext] = useState<string | null>(null);
  const [options, setOptions] = useState<O | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newCount, setNewCount] = useState(0);
  const [capped, setCapped] = useState(false);
  const rowsRef = useRef<Job[]>([]);
  const nextRef = useRef<string | null>(null);
  const pending = useRef(new Map<number, Job>());
  const gen = useRef(0);
  const ctl = useRef<AbortController | null>(null);
  const memberRef = useRef(member);
  const stayRef = useRef(stay);
  memberRef.current = member;
  stayRef.current = stay;
  rowsRef.current = rows;
  nextRef.current = next;
  const key = JSON.stringify(params);
  const lastKey = useRef(key);

  const url = useCallback(
    (cursor?: string) => {
      const q = new URLSearchParams({ ...(JSON.parse(key) as Record<string, string>), limit: String(PAGE) });
      if (cursor) q.set("cursor", cursor);
      return `${path}?${q}`;
    },
    [path, key],
  );

  // The first page: once per (list, filters), and again only after a reconnect of the socket.
  useEffect(() => {
    const my = ++gen.current;
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    pending.current.clear();
    setNewCount(0);
    if (lastKey.current !== key) {
      lastKey.current = key; // other filters = another list: do not show the old rows under the new filter
      setRows([]);
      setTotal(0);
      setNext(null);
    }
    setLoading(true);
    setError(null);
    setCapped(false);
    fetch(url(), { signal: c.signal, cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Page<O>>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (my !== gen.current) return;
        setRows(d.jobs);
        setTotal(d.total);
        setNext(d.next);
        if (d.options) setOptions(d.options);
        setLoading(false);
      })
      .catch((e) => {
        if (my !== gen.current || c.signal.aborted) return;
        setError(String(e.message || e));
        setLoading(false);
      });
    return () => c.abort();
  }, [url, epoch, key]);

  const loadMore = useCallback(() => {
    const cursor = nextRef.current;
    if (!cursor || more) return;
    const my = gen.current;
    const c = ctl.current;
    setMore(true);
    fetch(url(cursor), { signal: c?.signal, cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Page<O>>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (my !== gen.current) return;
        const have = new Set(rowsRef.current.map((r) => r.id));
        let merged = [...rowsRef.current, ...d.jobs.filter((r) => !have.has(r.id))];
        let n = d.next;
        if (merged.length >= MAX_ROWS) {
          merged = merged.slice(0, MAX_ROWS);
          n = null;
          setCapped(!!d.next);
        }
        setRows(merged);
        setTotal(d.total);
        setNext(n);
        setMore(false);
      })
      .catch((e) => {
        if (my !== gen.current || c?.signal.aborted) return;
        setError(String(e.message || e));
        setMore(false);
      });
  }, [url, more]);

  // Live: patch what is on screen, hold back what is new.
  useEffect(() => {
    const inRange = (r: Job) => {
      const last = rowsRef.current[rowsRef.current.length - 1];
      if (nextRef.current === null || !last) return true;
      const a = dir === "desc" ? rowKey(r) : Date.parse(r.createdAt || "") || 0;
      const b = dir === "desc" ? rowKey(last) : Date.parse(last.createdAt || "") || 0;
      return dir === "desc" ? a >= b : a <= b;
    };
    return onJobs((incoming) => {
      const on = new Map(rowsRef.current.map((r) => [r.id, r]));
      const upd = new Map<number, Job>();
      const drop = new Set<number>();
      for (const r of incoming) {
        const old = on.get(r.id);
        if (old) {
          if ((r.seq || 0) < (old.seq || 0)) continue;
          if (stayRef.current && !stayRef.current(r)) drop.add(r.id);
          else upd.set(r.id, r);
        } else if (memberRef.current(r) && inRange(r)) pending.current.set(r.id, r);
        else pending.current.delete(r.id);
      }
      if (upd.size || drop.size) {
        setRows((prev) => (drop.size ? prev.filter((r) => !drop.has(r.id)) : prev).map((r) => upd.get(r.id) || r));
        if (drop.size) setTotal((t) => Math.max(0, t - drop.size));
      }
      setNewCount(pending.current.size);
    });
  }, [onJobs, dir]);

  const showNew = useCallback(() => {
    const add = [...pending.current.values()];
    pending.current.clear();
    setNewCount(0);
    if (!add.length) return;
    const cmp = dir === "desc" ? (a: Job, b: Job) => rowKey(b) - rowKey(a) || b.id - a.id : (a: Job, b: Job) => (Date.parse(a.createdAt || "") || 0) - (Date.parse(b.createdAt || "") || 0) || a.id - b.id;
    const have = new Set(rowsRef.current.map((r) => r.id));
    setRows([...rowsRef.current, ...add.filter((r) => !have.has(r.id))].sort(cmp).slice(0, MAX_ROWS));
    setTotal((t) => t + add.length);
  }, [dir]);

  return { rows, total, next, options, loading, more, error, newCount, capped, loadMore, showNew };
}
