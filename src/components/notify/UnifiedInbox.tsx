"use client";
// The source tabs on top of the Inbox (project page and the all-projects page): All (everything, newest first, each row with
// its avatar), AI agents (the agents' inbox, as it always was) and GitHub (your GitHub notifications as one list with filter chips).
// Every tab carries its unread count; "Mark all read" works on the tab you are on. GitHub read state is lanedeck's own.
import React from "react";
import { RelTime } from "@/components/common/RelTime";
import { Seg } from "@/components/inbox/bits";
import { Icon } from "@/components/inbox/IconSprite";
import { useT } from "@/context/ConfigContext";
import type { GhAnswer, GhItem } from "@/lib/notify/useNotify";
import { GhList, GhStateNote } from "./GhParts";
import { AgentLine, AgentRow, DayList, GhLine, ListEmpty } from "./NotifyList";

export type InboxTab = "all" | "agents" | "github";
export const INBOX_TABS: InboxTab[] = ["all", "agents", "github"];
export const tabOf = (v: string | null | undefined): InboxTab | null => (INBOX_TABS.includes(v as InboxTab) ? (v as InboxTab) : null);

/** One AI-agent row of the All tab: what the agents' inbox shows for a file, in the All list's shape. */
export type { AgentRow };

/** The tab bar: the three tabs with unread counts, then the tab's own actions. */
export function InboxTabs({ tab, onTab, counts, children }: { tab: InboxTab; onTab: (t: InboxTab) => void; counts: { agents: number; github: number }; children?: React.ReactNode }) {
  const t = useT();
  return (
    <div className="mb-2.5 flex flex-wrap items-center gap-2">
      <Seg<InboxTab>
        label={t("ntf.tabs.label")}
        value={tab}
        onChange={onTab}
        className="w-full max-w-md"
        items={[
          { v: "all", label: t("ntf.tabs.all"), n: counts.agents + counts.github, tone: "brand" },
          { v: "agents", label: <span className="inline-flex items-center gap-1.5"><Icon name="bot" className="s14" />{t("ntf.tabs.agents")}</span>, n: counts.agents, tone: "brand" },
          { v: "github", label: <span className="inline-flex items-center gap-1.5"><Icon name="github" className="s14" />{t("ntf.tabs.github")}</span>, n: counts.github, tone: "brand" },
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
export function AllList({ agents, gh, failed, onRead, onUnread, empty }: {
  agents: AgentRow[]; gh: GhAnswer | null; failed?: boolean; onRead: (ids: string[]) => void; onUnread: (ids: string[]) => void; empty?: string;
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
        <DayList rows={rows} render={(r) => (r.gh ? <GhLine it={r.gh} onRead={onRead} onUnread={onUnread} /> : <AgentLine a={r.agent!} />)} />
      ) : (
        <ListEmpty icon="inbox">{empty ?? t("ntf.empty.all")}</ListEmpty>
      )}
    </>
  );
}

/** The GitHub tab body. */
export function GithubTab({ data, failed, onRead, onUnread }: { data: GhAnswer | null; failed?: boolean; onRead: (ids: string[]) => void; onUnread: (ids: string[]) => void }) {
  return (
    <>
      <GhStateNote data={data} failed={failed} />
      {data && <GhList data={data} onRead={onRead} onUnread={onUnread} />}
    </>
  );
}
