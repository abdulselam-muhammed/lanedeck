"use client";
// Floating banner on every page: shown only while the machine load is high; dismissable for 10 minutes.
import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/inbox/IconSprite";
import { useLoad } from "./LoadContext";
import { lsRead } from "@/lib/storage";
import { useT, type TFn } from "@/context/ConfigContext";

const KEY = "laneDeck.loadBannerHiddenUntil";
const HIDE_MS = 10 * 60 * 1000;

export function etaText(t: TFn, eta?: { minutes: number | null; approximate: boolean; untilRestart?: boolean }) {
  if (eta?.untilRestart) return t("load.banner.untilRestart");
  if (!eta || eta.minutes == null) return t("load.banner.unknown");
  return t("load.banner.minutes", { n: eta.minutes });
}

export default function LoadBanner() {
  const t = useT();
  const { data } = useLoad();
  const path = usePathname();
  const [until, setUntil] = React.useState(0);
  const [, force] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => {
    try { setUntil(Number(lsRead(KEY)) || 0); } catch { /* storage blocked */ }
  }, []);
  const high = !!data?.alert?.high;
  // re-render when the 10 minutes pass so the banner comes back by itself
  React.useEffect(() => {
    if (!until) return;
    const ms = until - Date.now();
    if (ms <= 0) return;
    const tm = setTimeout(force, ms + 200);
    return () => clearTimeout(tm);
  }, [until]);
  if (!high || Date.now() < until || path.startsWith("/load")) return null;
  const a = data!.alert!;
  const dismiss = () => {
    const u = Date.now() + HIDE_MS;
    setUntil(u);
    try { localStorage.setItem(KEY, String(u)); } catch { /* storage blocked */ }
  };
  return (
    <div role="alert" className="fixed bottom-4 start-4 z-[60] w-[min(440px,calc(100vw-2rem))] rounded-xl border border-line bg-pop p-3 shadow-lg">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-warning-50 text-warning-600 dark:bg-warning-500/15">
          <Icon name="alert" className="s14" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-theme-sm font-semibold text-gray-900 dark:text-white">{t("load.banner.high")} <span dir="ltr" className="mono">{a.reasons.join(" · ")}</span></p>
          <p className="mt-1 text-theme-sm text-gray-700 dark:text-gray-300">{a.cause}</p>
          <p className="mt-1 text-theme-xs text-muted">{t("load.eta")} <b>{etaText(t, a.eta)}</b>{a.eta.minutes != null ? t("load.etaBy", { why: a.eta.why }) : ""}</p>
          <Link href="/load" className="mt-2 inline-block text-theme-sm font-medium text-gray-800 underline-offset-4 hover:underline dark:text-gray-200">{t("load.banner.details")}</Link>
        </div>
        <button type="button" onClick={dismiss} title={t("load.banner.hide")} aria-label={t("load.banner.hide")} className="shrink-0 rounded-lg p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5">
          <Icon name="x" className="s14" />
        </button>
      </div>
    </div>
  );
}
