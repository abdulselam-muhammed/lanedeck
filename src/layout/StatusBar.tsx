"use client";
// The 24px status bar (VS Code-like): live/SSE dot, machine RAM and CPU, runners busy/total, active agents,
// and the current project with its branch. Every item is a link to the page it summarises.
import React from "react";
import Link from "next/link";
import { useBranch, useProject, useT } from "@/context/ConfigContext";
import { useInbox } from "@/components/inbox/InboxContext";
import { useLoad } from "@/components/load/LoadContext";
import { useAllAgents } from "@/components/pages/AgentsPage";
import { Icon } from "@/components/inbox/IconSprite";

const item = "flex h-full shrink-0 items-center gap-1.5 px-2.5 hover:bg-gray-100 dark:hover:bg-white/5";

export default function StatusBar() {
  const { connected, updatedAt, ci } = useInbox();
  const { data: load } = useLoad();
  const { data: agentsAll } = useAllAgents(15000);
  const { id, base, projects } = useProject();
  const branch = useBranch();
  const t = useT();
  const name = projects.find((p) => p.id === id)?.name ?? id;
  const time = updatedAt ? new Date(updatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
  const cur = load?.current;
  const th = load?.thresholds;
  const hot = (v: number | undefined, limit: number | undefined) => (v != null && limit != null && v >= limit ? "text-error-600 dark:text-error-400" : "");
  const running = agentsAll ? agentsAll.agents.filter((a) => a.state === "run").length : null;

  return (
    <footer
      role="contentinfo"
      aria-label={t("layout.status.aria")}
      className="fixed inset-x-0 bottom-0 z-[55] flex h-6 items-stretch overflow-x-auto border-t border-line bg-shell text-[11px] text-gray-600 no-scrollbar dark:text-gray-300"
    >
      <span className={`${item} cursor-default`} title={connected ? t("layout.status.liveTitle", { time }) : t("layout.status.offlineTitle")}>
        <span className={`h-2 w-2 rounded-full ${connected ? "bg-success-500 breathe" : "bg-error-500"}`} />
        <span className="hidden sm:inline">{connected ? t("layout.status.live") : t("layout.status.offline")}</span>
        <span className="mono hidden text-muted md:inline" dir="ltr">{time}</span>
      </span>
      <Link href="/load" className={item} title={t("layout.status.load")}>
        <Icon name="gauge" className="s14" />
        <span className={`mono ${hot(cur?.ram, th?.ram)}`} dir="ltr">RAM {cur ? Math.round(cur.ram) + "%" : "—"}</span>
        <span className={`mono ${hot(cur?.cpu, th?.cpu)}`} dir="ltr">CPU {cur ? Math.round(cur.cpu) + "%" : "—"}</span>
      </Link>
      <Link href="/ci" className={item} title={t("layout.status.runners")}>
        <Icon name="terminal" className="s14" />
        <span className="mono" dir="ltr">{ci ? `${ci.busy}/${ci.total}` : "—"}</span>
        <span className="hidden sm:inline">runners</span>
      </Link>
      <Link href="/agents" className={item} title={t("layout.status.agents")}>
        <Icon name="bot" className="s14" />
        <span className="mono" dir="ltr">{running ?? "—"}</span>
        <span className="hidden sm:inline">agents</span>
      </Link>
      <Link href={`${base}/branch`} className={`${item} ms-auto`} title={`${t("nav.branch")} — ${name}`}>
        <Icon name="git-fork" className="s14" />
        <span className="max-w-[160px] truncate">{name}</span>
        <span className="mono text-muted" dir="ltr">{branch}</span>
      </Link>
    </footer>
  );
}
