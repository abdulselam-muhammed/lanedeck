"use client";
// The Inbox as one list, like a mail or notifications page: rows newest first under day headers (Today, Yesterday, Earlier
// this week, Older), thin dividers, no card per section. A GitHub row is the actor's avatar with a small badge for what
// happened, one sentence ("alice commented on #12") with the title muted, a one-line snippet and repo#number; unread rows are
// bold, tinted and dotted. On hover: mark read / unread, archive (local, Gmail-style "Done") and open on GitHub. A click
// opens the thread and marks it read. In select mode a checkbox leads the row; an archived row carries Restore instead.
// The pure rules (chips, day groups, row kinds) are in src/lib/notify/list.mjs.
import React, { useState } from "react";
import Link from "next/link";
import { RelTime } from "@/components/common/RelTime";
import { Icon } from "@/components/inbox/IconSprite";
import { useT } from "@/context/ConfigContext";
import type { GhItem } from "@/lib/notify/useNotify";
import { badgeOf, groupByDay, initials, kindOf, refText } from "@/lib/notify/list.mjs";

/** Subject types the dictionary names; anything newer GitHub sends is "a thread". */
const TYPES = new Set(["PullRequest", "Issue", "Discussion", "Release", "Commit", "CheckSuite", "WorkflowRun", "RepositoryVulnerabilityAlert", "RepositoryDependabotAlertsThread", "RepositoryInvitation", "SecurityAdvisory"]);
/** GitHub's reasons the dictionary words (the "why" of a generic row). */
const WHY = new Set(["assign", "author", "comment", "ci_activity", "invitation", "manual", "member_feature_requested", "mention", "review_requested", "security_alert", "security_advisory_credit", "state_change", "subscribed", "team_mention", "approval_requested"]);
/** The dictionary key of a row's sentence: "You ..." for your own action, a no-actor wording when nobody is known. */
function sentenceKey(it: Pick<GhItem, "self" | "actor">, kind: string) {
  if (it.self) return `ntf.self.${kind}`;
  if (!it.actor && (kind === "activity" || kind === "release")) return `ntf.anon.${kind}`;
  return `ntf.kind.${kind}`;
}

const BADGE_TONE: Record<string, string> = {
  brand: "bg-brand-500",
  gray: "bg-gray-500",
  warning: "bg-warning-500",
  success: "bg-success-500",
  error: "bg-error-500",
  merged: "bg-theme-purple-500",
};

/** A round avatar: the picture when there is one (and it loads), else the initials; an optional badge on the end corner. */
function Avatar({ login, src, icon, badge }: { login?: string | null; src?: string | null; icon?: string; badge?: { icon: string; tone: string; label: string } }) {
  const [broken, setBroken] = useState(false);
  const pic = src && !broken ? `${src}${src.includes("?") ? "&" : "?"}s=72` : null;
  return (
    <span className="relative mt-0.5 h-9 w-9 shrink-0">
      {pic ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={pic} alt="" width={36} height={36} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="h-9 w-9 rounded-full bg-gray-200 object-cover dark:bg-white/10" />
      ) : (
        <span aria-hidden className="grid h-9 w-9 place-items-center rounded-full bg-gray-200 text-[12px] font-semibold text-gray-600 dark:bg-white/10 dark:text-gray-300">
          {icon ? <Icon name={icon} className="s16 text-brand-600 dark:text-brand-400" /> : initials(login)}
        </span>
      )}
      {badge && (
        <span title={badge.label} className={`absolute -end-1 -bottom-1 grid h-[18px] w-[18px] place-items-center rounded-full text-white ring-2 ring-[var(--card)] ${BADGE_TONE[badge.tone] ?? BADGE_TONE.gray}`}>
          <Icon name={badge.icon} className="h-2.5! w-2.5!" />
        </span>
      )}
    </span>
  );
}

const A = "";
const R = "";
/** The row's sentence with the actor in bold and the reference in mono: the dictionary words it per language. */
function Sentence({ it, kind }: { it: GhItem; kind: string }) {
  const t = useT();
  const ref = refText(it) ?? t(TYPES.has(it.type) ? `ntf.type.${it.type}` : "ntf.type.other");
  const text = t(sentenceKey(it, kind), { actor: A, ref: R });
  const parts = text.split(new RegExp(`(${A}|${R})`));
  return (
    <>
      {parts.map((p, i) =>
        p === A ? (
          <bdi key={i} className="font-semibold text-gray-900 dark:text-white">{it.actor ?? t("ntf.someone")}</bdi>
        ) : p === R ? (
          <bdi key={i} className="font-medium text-gray-800 dark:text-gray-200">{ref}</bdi>
        ) : (
          <React.Fragment key={i}>{p}</React.Fragment>
        ),
      )}
    </>
  );
}

const ROW = "group relative flex items-start gap-3 px-3 py-2.5 transition-colors";
const rowTone = (unread: boolean) =>
  unread ? "bg-brand-500/[0.05] hover:bg-brand-500/[0.09] dark:bg-brand-400/[0.06] dark:hover:bg-brand-400/[0.10]" : "hover:bg-gray-50 dark:hover:bg-white/[0.03]";

/** The unread dot on the start edge of a row. */
const Dot = ({ on }: { on: boolean }) => {
  const t = useT();
  return on ? <span aria-label={t("ntf.unread")} title={t("ntf.unread")} className="absolute start-1 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-brand-500 shadow-[0_0_6px_var(--color-brand-500)]" /> : null;
};

/** A row's checkbox in select mode. */
export type RowPick = { checked: boolean; toggle: () => void };

/** One GitHub notification as a list row. `onArchive`: the hover Archive action; `onRestore`: an archived row (Restore shown). */
export function GhLine({ it, onRead, onUnread, onArchive, onRestore, pick, project, source }: {
  it: GhItem; onRead: (ids: string[]) => void; onUnread: (ids: string[]) => void; onArchive?: (ids: string[]) => void; onRestore?: (ids: string[]) => void;
  pick?: RowPick; project?: string; source?: boolean;
}) {
  const t = useT();
  const kind = kindOf(it);
  const [icon, tone] = badgeOf(kind);
  const open = () => { if (it.unread) onRead([it.id]); };
  // A generic row says why GitHub sent it (its sticky reason), since it cannot say what happened.
  const why = kind === "activity" && it.reason ? t("ntf.why.label", { why: t(`ntf.why.${WHY.has(it.reason) ? it.reason : "other"}`) }) : null;
  return (
    <li data-kind={kind} data-self={it.self ? "1" : "0"} data-unread={it.unread ? "1" : "0"} title={it.self ? t("ntf.selfHint") : undefined} className={`${ROW} ${rowTone(it.unread)} ${it.self ? "opacity-60" : ""}`}>
      {it.url && <a href={it.url} target="_blank" rel="noopener noreferrer" aria-label={`${t("ntf.open")}: ${it.title}`} className="absolute inset-0 z-0 rounded-[inherit]" onClick={open} onAuxClick={open} />}
      <Dot on={it.unread} />
      {pick && <PickBox pick={pick} label={it.title} />}
      <span className="pointer-events-none relative flex min-w-0 flex-1 items-start gap-3">
        <Avatar login={it.actor} src={it.avatar} badge={{ icon, tone, label: t(`ntf.kindLabel.${kind}`) }} />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex min-w-0 items-baseline gap-3">
            <span dir="auto" className={`min-w-0 flex-1 truncate text-theme-sm ${it.unread ? "text-gray-900 dark:text-white" : "text-gray-700 dark:text-gray-300"}`}>
              <Sentence it={it} kind={kind} />
              {it.title !== it.ref && (
                <>
                  <span className="text-gray-400 dark:text-gray-500"> · </span>
                  <span dir="auto" className={it.unread ? "font-medium text-gray-700 dark:text-gray-200" : "text-gray-500 dark:text-gray-400"}>{it.title}</span>
                </>
              )}
            </span>
            <span className={`shrink-0 text-theme-xs tnum transition-opacity group-focus-within:opacity-0 group-hover:opacity-0 ${it.unread ? "font-semibold text-brand-600 dark:text-brand-400" : "text-gray-500 dark:text-gray-400"}`}>
              <RelTime at={Date.parse(it.at)} />
            </span>
          </span>
          <span className="flex min-w-0 items-center gap-2 text-[12px] text-gray-500 dark:text-gray-400">
            <span dir="ltr" className="mono shrink-0 text-[11px] text-gray-400 dark:text-gray-500">
              {it.repo}
              {it.number != null ? `#${it.number}` : ""}
            </span>
            {source && <span className="shrink-0 text-[11px] font-medium text-gray-400 dark:text-gray-500">{t("ntf.src.github")}</span>}
            {project && <span className="shrink-0 font-medium text-gray-600 dark:text-gray-300">{project}</span>}
            {it.archivedAt && <span className="shrink-0 tnum">{t("inbox.archive.dateLabel")} <RelTime at={Date.parse(it.archivedAt)} /></span>}
            {why && <span className="shrink-0 italic">{why}</span>}
            {it.excerpt && <span dir="auto" className="min-w-0 truncate">{it.excerpt}</span>}
          </span>
        </span>
      </span>
      {onRestore ? (
        <button type="button" className="btn btn-ghost relative z-10 shrink-0 self-center" onClick={() => onRestore([it.id])}>
          <Icon name="archive-restore" className="s14" />{t("inbox.archive.restore")}
        </button>
      ) : (
        <span className="absolute end-2 top-1.5 z-10 flex items-center gap-0.5 rounded-lg border border-line/70 bg-[var(--card)] p-0.5 opacity-0 shadow-theme-xs transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          <RowBtn icon={it.unread ? "check" : "circle"} label={t(it.unread ? "ntf.markRead" : "ntf.markUnread")} onClick={() => (it.unread ? onRead : onUnread)([it.id])} />
          {onArchive && <RowBtn icon="archive" label={t("ntf.arch.action")} title={t("ntf.arch.tip")} onClick={() => onArchive([it.id])} />}
          {it.url && <RowBtn icon="external" label={t("ntf.open")} href={it.url} onClick={open} />}
        </span>
      )}
    </li>
  );
}

/** The select-mode checkbox at the start of a row (above the row's link). */
export function PickBox({ pick, label }: { pick: RowPick; label: string }) {
  return (
    <input type="checkbox" className="relative z-10 mt-2.5 shrink-0" checked={pick.checked} onChange={pick.toggle} aria-label={label} />
  );
}

function RowBtn({ icon, label, onClick, href, title }: { icon: string; label: string; onClick: () => void; href?: string; title?: string }) {
  const cls = "grid h-7 w-7 place-items-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-white";
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" title={label} aria-label={label} className={cls} onClick={onClick}>
      <Icon name={icon} className="s14" />
    </a>
  ) : (
    <button type="button" title={title ?? label} aria-label={label} className={cls} onClick={onClick}>
      <Icon name={icon} className="s14" />
    </button>
  );
}

/** One AI-agent file as a list row (the All and AI agents tabs). */
export type AgentRow = { key: string; href: string; title: string; sub: string; at: number; unread: boolean; lead?: React.ReactNode; project?: string };
export function AgentLine({ a }: { a: AgentRow }) {
  const t = useT();
  return (
    <li className={`${ROW} ${rowTone(a.unread)}`}>
      <Link href={a.href} aria-label={a.title} className="absolute inset-0 z-0" />
      <Dot on={a.unread} />
      <span className="pointer-events-none relative flex min-w-0 flex-1 items-start gap-3">
        <Avatar icon="bot" badge={{ icon: "file-text", tone: "brand", label: t("ntf.src.agent") }} />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex min-w-0 items-baseline gap-3">
            <span dir="auto" className={`min-w-0 flex-1 truncate text-theme-sm ${a.unread ? "font-semibold text-gray-900 dark:text-white" : "text-gray-700 dark:text-gray-300"}`}>
              {a.title}
            </span>
            <span className={`shrink-0 text-theme-xs tnum ${a.unread ? "font-semibold text-brand-600 dark:text-brand-400" : "text-gray-500 dark:text-gray-400"}`}>
              <RelTime at={a.at} />
            </span>
          </span>
          <span className="flex min-w-0 items-center gap-2 text-[12px] text-gray-500 dark:text-gray-400">
            {a.lead && <span className="grid w-4 shrink-0 place-items-center">{a.lead}</span>}
            <span className="shrink-0 text-[11px] font-medium text-gray-400 dark:text-gray-500">{t("ntf.src.agent")}</span>
            {a.project && <span className="shrink-0 font-medium text-gray-600 dark:text-gray-300">{a.project}</span>}
            <span dir="auto" className="min-w-0 truncate">{a.sub}</span>
          </span>
        </span>
      </span>
    </li>
  );
}

/** Rows under day headers, in one panel with thin dividers. `at` is in ms. */
export function DayList<T extends { at: number; key: string }>({ rows, render }: { rows: T[]; render: (r: T) => React.ReactNode }) {
  const t = useT();
  const groups = groupByDay(rows) as { day: string; rows: T[] }[];
  return (
    <div className="overflow-hidden rounded-xl border border-line/70 bg-card shadow-theme-xs">
      {groups.map((g) => (
        <section key={g.day} aria-label={t(`ntf.day.${g.day}`)}>
          <h3 className="border-b border-line/60 bg-strip/60 px-3 py-1.5 text-[11px] font-semibold tracking-wide text-gray-500 uppercase dark:text-gray-400">{t(`ntf.day.${g.day}`)}</h3>
          <ul className="divide-y divide-line/50 border-b border-line/60 last:border-b-0">
            {g.rows.map((r) => <React.Fragment key={r.key}>{render(r)}</React.Fragment>)}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** The one centered message when the list has nothing to show. */
export function ListEmpty({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <div className="grid justify-items-center gap-2 rounded-xl border border-line/70 bg-card px-4 py-16 text-center text-theme-sm text-gray-500 dark:text-gray-400">
      <Icon name={icon} className="h-7! w-7! text-gray-400" />
      <p className="max-w-md">{children}</p>
    </div>
  );
}
