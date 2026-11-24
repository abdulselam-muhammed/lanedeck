"use client";
// One shared clock for every relative time in the app ("12s ago"). A single setInterval (1s) feeds a tiny
// external store; <RelTime at={ms}/> subscribes through useSyncExternalStore, so only these small labels
// re-render on a tick, never the pages around them. Labels that already show minutes or hours listen to a
// coarse snapshot (every 30s). Coming back to a hidden tab ticks at once (background tabs are throttled).
import { useSyncExternalStore } from "react";
import { ago } from "@/lib/inbox/model";

let tick = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const subs = new Set<() => void>();
const bump = () => {
  tick += 1;
  subs.forEach((f) => f());
};
const onVisible = () => {
  if (document.visibilityState === "visible") bump();
};

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

/** Elapsed-time label that stays live. `at` is a client-comparable epoch in ms (the label is Date.now() - at). */
export function RelTime({ at }: { at: number | null | undefined }) {
  // Seconds are only shown for the first minute; after that a 30s snapshot is plenty.
  const fine = !!at && Date.now() - at < 90e3;
  useSyncExternalStore(
    subscribe,
    () => (fine ? tick : -1 - Math.floor(tick / 30)),
    () => 0,
  );
  return <>{ago(at)}</>;
}
