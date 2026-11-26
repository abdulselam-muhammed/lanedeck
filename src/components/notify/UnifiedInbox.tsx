"use client";
// The source tabs on top of the Inbox (project page and the all-projects page): All (everything, newest first, each row with
// its avatar), AI agents (the agents' inbox, as it always was) and GitHub (your GitHub notifications as one list with filter chips).
// Every tab carries its unread count; "Mark all read" works on the tab you are on. GitHub read state and archive are lanedeck's own.
import React from "react";
import { RelTime } from "@/components/common/RelTime";
import { Seg } from "@/components/inbox/bits";
import { Icon } from "@/components/inbox/IconSprite";
import { useT } from "@/context/ConfigContext";
import type { ToastKind } from "@/components/inbox/InboxContext";
import type { GhAnswer, GhItem } from "@/lib/notify/useNotify";
import { GhArchive, GhList, GhStateNote } from "./GhParts";
import { AgentLine, AgentRow, DayList, GhLine, ListEmpty } from "./NotifyList";

export type InboxTab = "all" | "agents" | "github" | "archive";
export { INBOX_TABS, tabFromParams } from "@/lib/notify/list.mjs";

/** One AI-agent row of the All tab: what the agents' inbox shows for a file, in the All list's shape. */
export type { AgentRow };

/** The tab bar: the four tabs (the unread counts; Archive carries how many are archived, never part of All), then the tab's own actions. */
export function InboxTabs({ tab, onTab, counts, children }: { tab: InboxTab; onTab: (t: InboxTab) => void; counts: { agents: number; github: number; archived?: number | null }; children?: React.ReactNode }) {
  const t = useT();
  return (
    <div className="mb-2.5 flex flex-wrap items-center gap-2">
      <Seg<InboxTab>
        label={t("ntf.tabs.label")}
        value={tab}
        onChange={onTab}
        className="w-full max-w-xl"
        items={[
          { v: "all", label: t("ntf.tabs.all"), n: counts.agents + counts.github, tone: "brand" },
          { v: "agents", label: <span className="inline-flex items-center gap-1.5"><Icon name="bot" className="s14" />{t("ntf.tabs.agents")}</span>, n: counts.agents, tone: "brand" },
          { v: "github", label: <span className="inline-flex items-center gap-1.5"><Icon name="github" className="s14" />{t("ntf.tabs.github")}</span>, n: counts.github, tone: "brand" },
          { v: "archive", label: <span className="inline-flex items-center gap-1.5"><Icon name="archive" className="s14" />{t("inbox.archive.view")}</span>, n: counts.archived ?? undefined },
        ]}
      />
      <div className="ms-auto flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/** "Mark all read" for the tab on screen. */
export function MarkAllButton({ n, onClick }: { n: number; onClick: () => void }) {
  const t = useT();
  return (
    <button type="button" className="btn btn-tonal" disabled={!n} onClick={onClick} title={t("ntf.localOnly")}>
      <Icon name={n ? "check-check" : "check"} className="s14" />
      {n ? t("ntf.markAll") : t("ntf.nothingUnread")}
    </button>
  );
}

/** When GitHub was last checked, and a refresh. */
export function GhChecked({ data, onRefresh }: { data: GhAnswer | null; onRefresh: () => void }) {
  const t = useT();
  const [busy, setBusy] = React.useState(false);
  if (!data || !data.settings.enabled) return null;
  return (
    <span className="inline-flex items-center gap-2 text-theme-xs text-muted">
      {data.state.at && (
        <span title={t("ntf.every", { n: data.state.pollSeconds })}>
          {t("ntf.checked")} <RelTime at={data.state.at} />
        </span>
      )}
      <button
        type="button"
        className="btn btn-ghost"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try { await onRefresh(); } finally { setBusy(false); }
        }}
      >
        <Icon name="refresh" className={`s14 ${busy ? "animate-spin" : ""}`} />
        {t("ntf.refresh")}
      </button>
    </span>
  );
}

/** The All tab (and the AI agents tab, with gh = null): agent files and GitHub notifications in one list under day headers. */
export function AllList({ agents, gh, failed, onRead, onUnread, empty, arch }: {
  agents: AgentRow[]; gh: GhAnswer | null; failed?: boolean; onRead: (ids: string[]) => void; onUnread: (ids: string[]) => void; empty?: string; arch?: GhArchive;
}) {
  const t = useT();
  type Row = { key: string; at: number; agent?: AgentRow; gh?: GhItem };
  const rows: Row[] = [
    ...agents.map((a) => ({ key: "a" + a.key, at: a.at, agent: a })),
    ...(gh?.items ?? []).map((g) => ({ key: "g" + g.id, at: Date.parse(g.at), gh: g })),
  ].sort((a, b) => b.at - a.at).slice(0, 150);
  return (
    <>
      <GhStateNote data={gh} failed={failed} compact />
      {rows.length ? (
        <DayList rows={rows} render={(r) => (r.gh ? <GhLine it={r.gh} onRead={onRead} onUnread={onUnread} onArchive={arch ? (ids) => void arch.onArchive(ids) : undefined} /> : <AgentLine a={r.agent!} />)} />
      ) : (
        <ListEmpty icon="inbox">{empty ?? t("ntf.empty.all")}</ListEmpty>
      )}
    </>
  );
}

/** The GitHub tab body. */
export function GithubTab({ data, failed, onRead, onUnread, arch }: { data: GhAnswer | null; failed?: boolean; onRead: (ids: string[]) => void; onUnread: (ids: string[]) => void; arch?: GhArchive }) {
  return (
    <>
      <GhStateNote data={data} failed={failed} />
      {data && <GhList data={data} onRead={onRead} onUnread={onUnread} arch={arch} />}
    </>
  );
}

/** The GitHub archive actions with their toasts (one place for the project Inbox and the all-projects page). */
export function useGhArchive(gh: { archive: (ids: string[]) => Promise<number>; archiveRead: () => Promise<number> }, toast: (title: string, body: string, kind?: ToastKind) => void): GhArchive {
  const t = useT();
  const said = (n: number) => toast(n ? t("ntf.arch.done", { n }) : t("ntf.arch.nothing"), t("ntf.arch.doneBody"), n ? "done" : "");
  return {
    onArchive: async (ids) => { const n = await gh.archive(ids); said(n); return n; },
    onArchiveRead: async () => { const n = await gh.archiveRead(); said(n); return n; },
  };
}
