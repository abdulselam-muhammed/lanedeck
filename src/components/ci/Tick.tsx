"use client";
// A live duration in English ("4m 12s"): one shared 1 s clock for every label on the /ci page (the same idea as
// RelTime, which speaks Arabic). Hidden tabs stop ticking; coming back ticks at once.
import { useSyncExternalStore } from "react";
import { fmtDur } from "@/lib/ci/model";

let tick = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const subs = new Set<() => void>();
const bump = () => {
  tick += 1;
  subs.forEach((f) => f());
};
const onVisible = () => document.visibilityState === "visible" && bump();
function subscribe(cb: () => void) {
  subs.add(cb);
  if (!timer) {
    timer = setInterval(bump, 1000);
    document.addEventListener("visibilitychange", onVisible);
  }
  return () => {
    subs.delete(cb);
    if (!subs.size && timer) {
      clearInterval(timer);
      timer = null;
      document.removeEventListener("visibilitychange", onVisible);
    }
  };
}
export function useNow() {
  useSyncExternalStore(subscribe, () => tick, () => 0);
  return Date.now();
}
/** Elapsed time from `from` to `to` (or to now, ticking while `to` is empty). */
export function Dur({ from, to, pre = "" }: { from?: string | null; to?: string | null; pre?: string }) {
  useSyncExternalStore(subscribe, () => (to ? 0 : tick), () => 0);
  if (!from) return null;
  const t = fmtDur((to ? Date.parse(to) : Date.now()) - Date.parse(from));
  return <span className="tnum">{pre ? `${pre} ` : ""}{t}</span>;
}
