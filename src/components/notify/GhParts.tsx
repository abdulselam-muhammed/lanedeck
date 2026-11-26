"use client";
// The GitHub pieces of the unified Inbox: the GitHub tab (filter chips over one list under day headers) and the plain-words
// state when GitHub cannot be read (gh missing, signed out, ...). The rows themselves are in NotifyList.tsx.
import React, { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/inbox/IconSprite";
import { useT } from "@/context/ConfigContext";
import type { GhAnswer } from "@/lib/notify/useNotify";
import { chipCounts, chipsFor, matchChip } from "@/lib/notify/list.mjs";
import { DayList, GhLine, ListEmpty } from "./NotifyList";

/** Why the GitHub rows cannot be read now (or are only the last reading), in plain words; null when all is well. */
export function GhStateNote({ data, failed, compact }: { data: GhAnswer | null; failed?: boolean; compact?: boolean }) {
  const t = useT();
  if (failed && !data) return <Note tone="warning" icon="alert">{t("ntf.st.unreachable")}</Note>;
  if (!data) return null;
  const c = data.state.code;
  if (c === "ok" || (c === "loading" && compact)) return null;
  if (c === "loading") return <Note icon="loader">{t("ntf.st.loading")}</Note>;
  const settings = (
    <Link href="/settings?tab=notifications" className="font-medium text-brand-600 underline-offset-4 hover:underline dark:text-brand-400">
      {t("ntf.st.settings")}
    </Link>
  );
  if (c === "disabled") return <Note icon="bell-off">{t("ntf.st.disabled")} {settings}</Note>;
  if (c === "norepos")
    return (
      <Note icon="github">
        {t("ntf.st.norepos")}{" "}
        <Link href="/settings?tab=projects" className="font-medium text-brand-600 underline-offset-4 hover:underline dark:text-brand-400">
          {t("ntf.st.settings")}
        </Link>
      </Note>
    );
  if (c === "ratelimit") {
    const when = data.state.resetAt ? new Date(data.state.resetAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : t("ntf.st.ratelimitSoon");
    return <Note tone="warning" icon="hourglass">{t("ntf.st.ratelimit", { when })}</Note>;
  }
  if (c === "scope" || c === "auth") return <FixNote data-code={c} text={t(c === "scope" ? "ntf.st.scope" : "ntf.st.auth")} run={t(c === "scope" ? "ntf.st.scope.run" : "ntf.st.auth.run")} cmd={c === "scope" ? GH_REFRESH_CMD : GH_LOGIN_CMD} hint={c === "scope" ? t("ntf.st.scope.hint") : null} />;
  const key = { nogh: "ntf.st.nogh", auth: "ntf.st.auth", scope: "ntf.st.scope", budget: "ntf.st.budget", network: "ntf.st.network" }[c as string] ?? "ntf.st.failed";
  return <Note tone="warning" icon="alert">{t(key)}</Note>;
}

const GH_REFRESH_CMD = "gh auth refresh -h github.com -s notifications";
const GH_LOGIN_CMD = "gh auth login -h github.com";

/** A problem the user fixes in a terminal: what is wrong, the exact command in a copyable box, and an optional hint. */
function FixNote({ text, run, cmd, hint, ...rest }: { text: string; run: string; cmd: string; hint: string | null; "data-code"?: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(cmd); setDone(true); setTimeout(() => setDone(false), 1400); } catch { /* clipboard blocked */ }
  };
  return (
    <div role="alert" data-code={rest["data-code"]} className="mb-3 rounded-lg bg-warning-50 px-3 py-2 text-theme-sm text-warning-700 dark:bg-warning-500/15 dark:text-warning-400">
      <p className="flex items-start gap-2">
        <Icon name="alert" className="s16 mt-0.5 shrink-0" />
        <span className="min-w-0">{text}</span>
      </p>
      <div className="mt-2 ps-6">
        <p className="mb-1 text-theme-xs">{run}</p>
        <div className="flex items-center gap-2">
          <code dir="ltr" className="mono min-w-0 flex-1 overflow-x-auto rounded-lg bg-white/70 px-3 py-1.5 text-theme-sm whitespace-nowrap text-gray-800 dark:bg-black/30 dark:text-gray-100">{cmd}</code>
          <button type="button" className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 text-theme-xs font-medium text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/[0.04]" data-copy={cmd} onClick={copy} aria-label={`${t("ntf.st.copy")}: ${cmd}`}>
            <Icon name={done ? "check" : "copy"} className="s14" />{done ? t("ntf.st.copied") : t("ntf.st.copy")}
          </button>
        </div>
        {hint && <p className="mt-2 text-theme-xs">{hint}</p>}
      </div>
    </div>
  );
}

function Note({ children, icon, tone }: { children: React.ReactNode; icon: string; tone?: "warning" }) {
  return (
    <p
      role={tone ? "alert" : "status"}
      className={`mb-3 flex items-start gap-2 rounded-lg px-3 py-2 text-theme-sm ${
        tone ? "bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-400" : "bg-strip text-gray-600 dark:text-gray-300"
      }`}
    >
      <Icon name={icon} className="s16 mt-0.5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** The GitHub tab: the filter chips, then one list of every notification under day headers. */
export function GhList({ data, onRead, onUnread }: { data: GhAnswer; onRead: (ids: string[]) => void; onUnread: (ids: string[]) => void }) {
  const t = useT();
  const [chip, setChip] = useState<Chip>("all");
  if (data.state.code === "disabled" || data.state.code === "norepos") return null;
  // GitHub could not be read at all: the note above says why, so no empty list that looks like an empty inbox.
  if (!data.items.length && ["scope", "auth", "nogh"].includes(data.state.code)) return null;
  if (!data.settings.sections.length) return <ListEmpty icon="bell-off">{t("ntf.empty.hidden")}</ListEmpty>;
  if (!data.items.length && data.state.code === "ok") return <ListEmpty icon="github">{t("ntf.empty.github", { repos: data.repos.join(", ") })}</ListEmpty>;
  const chips = chipsFor(data.settings.sections) as Chip[];
  const on = chips.includes(chip) ? chip : "all";
  const n = chipCounts(data.items) as Record<Chip, number>;
  const rows = data.items.filter((it) => matchChip(it, on)).map((it) => ({ ...it, key: it.id, at: Date.parse(it.at), it }));
  return (
    <>
      <div role="toolbar" aria-label={t("ntf.chips.label")} className="mb-2.5 flex flex-wrap items-center gap-1.5">
        {chips.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={on === c}
            data-chip={c}
            onClick={() => setChip(c)}
            className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-theme-xs font-medium whitespace-nowrap transition ${
              on === c
                ? "border-brand-500/60 bg-brand-500/15 text-brand-700 shadow-[0_0_12px_var(--glow)] dark:text-brand-300"
                : "border-line/70 text-gray-600 hover:border-gray-300 hover:text-gray-900 dark:text-gray-400 dark:hover:border-white/20 dark:hover:text-white"
            }`}
          >
            {t(`ntf.chip.${c}`)}
            {n[c] > 0 && <span className={`tnum text-[11px] ${on === c ? "text-brand-600 dark:text-brand-300" : "text-gray-400 dark:text-gray-500"}`}>{n[c]}</span>}
          </button>
        ))}
      </div>
      {rows.length ? (
        <DayList rows={rows} render={(r) => <GhLine it={r.it} onRead={onRead} onUnread={onUnread} />} />
      ) : (
        <ListEmpty icon="check-check">{t(on === "unread" ? "ntf.empty.unread" : "ntf.empty.chip")}</ListEmpty>
      )}
    </>
  );
}
type Chip = "all" | "unread" | "mentions" | "replies" | "reviews" | "assigned" | "status";
