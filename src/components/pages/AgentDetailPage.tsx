"use client";
// /agents/[id] and /p/[project]/agents/[id]: one agent on its own page. The same detail view the Inbox shows when you pick an
// agent there (AgentSide: progress card, agent card, last actions, subagents) plus the agent's inbox file when it has one.
// Project-scoped route: the project's live inbox (SSE) gives the tree, so the file and the progress match the Inbox exactly.
// Machine route: the agent comes from GET /api/agents (any project, last 48 h); a configured project's agent moves to its
// project-scoped page, an "other" agent stays here without a file.
import React, { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { buildTree, TreeNode } from "@/lib/inbox/model";
import { useInbox } from "@/components/inbox/InboxContext";
import { Empty, PageHeader } from "@/components/inbox/bits";
import AgentSide from "@/components/inbox/LivePanel";
import { DocText } from "@/components/inbox/NodeView";
import { useAllAgents } from "@/components/pages/AgentsPage";
import { useProject, useT } from "@/context/ConfigContext";

/** Where an agent's page lives: its project's route when the project is configured, else the machine route. */
export const agentHref = (a: { id: string; project?: string }) =>
  a.project && a.project !== "other" ? `/p/${a.project}/agents/${encodeURIComponent(a.id)}` : `/agents/${encodeURIComponent(a.id)}`;

export default function AgentDetailPage({ id, scoped = false }: { id: string; scoped?: boolean }) {
  const t = useT();
  const { base } = useProject();
  const router = useRouter();
  const { tree, updatedAt } = useInbox();
  const { data, error } = useAllAgents(4000);
  const mine = data?.agents.find((a) => a.id === id);

  // The machine route hands a configured project's agent over to its own page.
  useEffect(() => {
    if (!scoped && mine && mine.project !== "other") router.replace(agentHref(mine));
  }, [scoped, mine, router]);

  const live = useMemo(() => (scoped ? [...tree.nodes.values()].filter((n) => n.agent?.id === id).sort((a, b) => Number(!!b.file) - Number(!!a.file))[0] : undefined), [scoped, tree, id]);
  const local = useMemo<TreeNode | undefined>(() => {
    if (!mine) return undefined;
    const group = (data?.agents ?? []).filter((a) => a.dir === mine.dir);
    return buildTree([], group).nodes.get("agent:" + id);
  }, [data, mine, id]);
  const n = live ?? local;

  const subHref = (k: TreeNode) => (k.agent ? (scoped ? `${base}/agents/${encodeURIComponent(k.agent.id)}` : `/agents/${encodeURIComponent(k.agent.id)}`) : null);

  const crumbs = [{ label: t("pages.agents.crumb") }, { label: t("pages.agents.title"), href: "/agents" }];
  const ready = scoped ? !!updatedAt || !!data : !!data;
  if (!n) {
    return (
      <>
        <PageHeader crumbs={crumbs} title={id} />
        <Empty icon={ready ? "bot" : "loader"}>{ready ? t("pages.agentPage.gone") : error ? t("pages.agents.unreachable") : t("pages.agents.reading")}</Empty>
      </>
    );
  }
  const f = n.file;
  return (
    <>
      <PageHeader crumbs={[...crumbs, { label: n.agent?.name ?? id }]} title={<span dir="auto">{n.agent?.name ?? id}</span>} desc={<span dir="ltr" className="mono">{id}</span>} />
      <div className={`panel-smoke grid gap-0 overflow-hidden rounded-xl border border-line/70 bg-card shadow-theme-xs ${f ? "xl:grid-cols-[minmax(0,1fr)_340px]" : "max-w-3xl"}`}>
        {f && (
          <div className="min-w-0 px-3 py-3 md:px-7">
            <div className="mb-2 text-theme-xs text-gray-500 dark:text-gray-400">
              {t("pages.agentPage.file")} <span dir="ltr" className="mono">{f.name}</span>
            </div>
            <DocText f={f} />
          </div>
        )}
        <aside aria-label={t("inbox.live.agent")} className={`min-w-0 px-3 py-3 ${f ? "border-t border-line xl:border-s xl:border-t-0" : ""}`}>
          <AgentSide n={n} subHref={subHref} />
        </aside>
      </div>
    </>
  );
}
