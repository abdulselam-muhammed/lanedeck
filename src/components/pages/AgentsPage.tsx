"use client";
// /agents (machine level): every Claude Code agent on this PC, across ALL projects (GET /api/agents: ~/.claude/projects/*, last 48 h,
// capped per project). Each agent carries the configured project it belongs to, or "other". One tree table: an agent with its
// subagents under it. Filters: state tabs, a project filter (?p=<id> in the URL), a text filter.
import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Agent } from "@/lib/inbox/model";
import { RelTime } from "@/components/common/RelTime";
import { Icon } from "@/components/inbox/IconSprite";
import { Card, CardHead, Empty, KpiStrip, PageHeader, Seg } from "@/components/inbox/bits";
import { useConfig, useT } from "@/context/ConfigContext";
import { api } from "@/lib/settings";
import { agentHref } from "@/components/pages/AgentDetailPage";

export type MachineAgent = Agent & { project: string; dir: string };
type AllAgents = { agents: MachineAgent[]; projects: string[]; now: number; hidden?: string[]; windowHours?: number };

/** Polls /api/agents while the tab is visible. Shared by the agents page and the machine overview. */
export function useAllAgents(everyMs = 5000) {
  const [data, setData] = useState<AllAgents | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (!document.hidden) {
        try {
          const r = await fetch("/api/agents", { cache: "no-store" });
          if (!stop && r.ok) { setData(await r.json()); setError(false); }
        } catch { if (!stop) setError(true); }
      }
      if (!stop) timer = setTimeout(tick, everyMs);
    };
    tick();
    const onVis = () => { if (!document.hidden) { clearTimeout(timer); tick(); } };
    document.addEventListener("visibilitychange", onVis);
    return () => { stop = true; clearTimeout(timer); document.removeEventListener("visibilitychange", onVis); };
  }, [everyMs]);
  return { data, error };
}

type Tab = "all" | "active" | "done" | "hidden";
const STATE_ORDER: Record<string, number> = { run: 0, wait: 1, idle: 2, stopped: 3, done: 4 };
/** The status pill of each state (globals.css .st-pill): working breathes, waiting is amber, stopped red, done green. */
const STATE_CLS: Record<string, string> = { run: "is-run pulse", wait: "is-wait", idle: "is-idle", stopped: "is-fail", done: "is-done" };
const isActive = (a: Agent) => a.state === "run" || a.state === "wait";

type Node = { a: MachineAgent; kids: Node[] };
function buildForest(list: MachineAgent[]): Node[] {
  const nodes = new Map(list.map((a) => [a.id, { a, kids: [] as Node[] }]));
  const tops: Node[] = [];
  for (const n of nodes.values()) {
    const p = n.a.parent ? nodes.get(n.a.parent) : undefined;
    if (p && p !== n) p.kids.push(n); else tops.push(n);
  }
  const rank = (n: Node): number => Math.min(STATE_ORDER[n.a.state] ?? 9, ...n.kids.map(rank));
  const sort = (xs: Node[]) => { xs.sort((x, y) => rank(x) - rank(y) || y.a.lastAt - x.a.lastAt); xs.forEach((x) => sort(x.kids)); };
  sort(tops);
  return tops;
}
const hay = (a: MachineAgent) => [a.name, a.branch, a.id, a.model, a.project, a.step].filter(Boolean).join(" ").toLowerCase();
const matchDeep = (n: Node, words: string[]): boolean => words.every((w) => hay(n.a).includes(w)) || n.kids.some((k) => matchDeep(k, words));
const tabDeep = (n: Node, tab: Tab): boolean => (tab === "all" || tab === "hidden" ? true : tab === "active" ? isActive(n.a) : n.a.state === "done") || n.kids.some((k) => tabDeep(k, tab));

function ProjectTag({ id, names }: { id: string; names: Map<string, string> }) {
  const known = id !== "other";
  const label = names.get(id) ?? (known ? id : "other");
  const cls = "inline-block max-w-[140px] truncate rounded-full px-2 py-0.5 text-theme-xs";
  return known ? (
    <Link href={`/p/${id}`} className={`${cls} bg-brand-50 text-brand-700 hover:underline dark:bg-brand-500/15 dark:text-brand-300`} title={label}>{label}</Link>
  ) : (
    <span className={`${cls} bg-strip text-gray-600 dark:text-gray-300`}>{label}</span>
  );
}

/** Hide/unhide acts on the agent and its subagents together. */
type Act = { hiddenView: boolean; toggle: (n: Node) => void };
const subtree = (n: Node): string[] => [n.a.id, ...n.kids.flatMap(subtree)];

function Row({ n, depth, names, act }: { n: Node; depth: number; names: Map<string, string>; act: Act }) {
  const t = useT();
  const [shut, setShut] = useState(false);
  const a = n.a;
  const pct = a.progress && a.progress.source !== "none" ? a.progress.pct : null;
  const td = "px-3 py-1.5 align-middle";
  const href = agentHref(a);
  const router = useRouter();
  // The whole row opens the agent's page; the name is the real link (Enter, middle-click, new tab), the other controls keep their own click.
  const open = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("a,button,input,select,textarea") || e.button !== 0 || window.getSelection()?.toString()) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey) window.open(href, "_blank");
    else router.push(href);
  };
  return (
    <>
      <tr onClick={open} className="cursor-pointer hover:bg-gray-50 dark:hover:bg-white/[0.03]">
        <td className="max-w-0 py-1.5 ps-3 pe-3">
          <div className="flex min-w-0 items-center gap-1.5" style={{ paddingInlineStart: depth * 20 }}>
            {n.kids.length > 0 ? (
              <button type="button" onClick={() => setShut(!shut)} aria-expanded={!shut} aria-label="subagents"
                className="grid h-6 w-6 shrink-0 place-items-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/5">
                <Icon name="chevron-down" className={`s14 transition-transform ${shut ? "rotate-90" : ""}`} />
              </button>
            ) : depth > 0 ? (
              <span className="grid h-6 w-6 shrink-0 place-items-center text-gray-300 dark:text-gray-700" aria-hidden="true"><Icon name="corner" className="s14 -scale-x-100" /></span>
            ) : <span className="w-6 shrink-0" />}
            <span className="grid min-w-0">
              <Link href={href} dir="auto" title={a.name} aria-label={`${t("pages.agents.open")}: ${a.name}`} className="truncate text-theme-sm font-semibold text-gray-800 hover:underline dark:text-white/90">{a.name}</Link>
              <span dir="ltr" title={a.id} className="truncate text-start text-[11px] text-gray-400 mono dark:text-gray-500">{a.id}</span>
            </span>
          </div>
        </td>
        <td className={td} data-label={t("pages.agents.colProject")}><ProjectTag id={a.project} names={names} /></td>
        <td className={td} data-label={t("pages.agents.colState")}><span className={`st-pill ${STATE_CLS[a.state] ?? STATE_CLS.idle}`}>{STATE_CLS[a.state] ? t(`pages.agent.state.${a.state}`) : a.state}</span></td>
        <td className={td} data-label="model">{a.model ? <span className="tag">{a.model}</span> : <span className="dt-empty">—</span>}</td>
        <td className={td + " max-w-[180px]"} data-label={t("pages.agents.colBranch")}>
          {a.branch ? <span dir="ltr" className="block truncate text-theme-xs text-gray-600 mono dark:text-gray-300" title={a.branch}>{a.branch}</span> : <span className="dt-empty">—</span>}
        </td>
        <td className={td + " w-[150px]"} data-label={t("pages.agents.colProgress")}>
          {pct == null ? <span className="dt-empty">—</span> : (
            <span className="flex items-center gap-2">
              <b className="w-10 shrink-0 text-theme-xs mono text-gray-800 dark:text-white/90">{pct}%</b>
              <span className={`dt-bar flex-1 ${pct >= 100 ? "is-done" : ""}`}><span style={{ width: `${pct}%` }} /></span>
            </span>
          )}
        </td>
        <td className={td + " whitespace-nowrap text-theme-xs text-gray-500 tnum dark:text-gray-400"} data-label={t("pages.agents.colStarted")}><RelTime at={a.startedAt} /></td>
        <td className={td + " whitespace-nowrap text-theme-xs text-gray-500 tnum dark:text-gray-400"} data-label={t("pages.agents.colLast")}><RelTime at={a.lastAt} /></td>
        <td className={td + " whitespace-nowrap pe-3 text-end"} data-label={t("pages.agents.colActions")}>
          <button type="button" onClick={() => act.toggle(n)} title={t("pages.agents.hideNote")} className="rounded-md px-2 py-1 text-theme-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-white">
            {t(act.hiddenView ? "pages.agents.unhide" : "pages.agents.hide")}
          </button>
        </td>
      </tr>
      {!shut && n.kids.map((k) => <Row key={k.a.id} n={k} depth={depth + 1} names={names} act={act} />)}
    </>
  );
}

export default function AgentsPage() {
  const cfg = useConfig();
  const t = useT();
  const { data, error } = useAllAgents();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const project = params.get("p") ?? "";
  const [tab, setTab] = useState<Tab>("all");
  const [text, setText] = useState("");
  const names = useMemo(() => new Map(cfg.projects.map((p) => [p.id, p.name])), [cfg.projects]);
  const setProject = (p: string) => router.replace(p ? `${pathname}?p=${encodeURIComponent(p)}` : pathname);
  const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);

  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hideErr, setHideErr] = useState(false);
  useEffect(() => { if (data?.hidden) setHidden(new Set(data.hidden)); }, [data]);
  /** Hide/unhide: a list kept in lanedeck's data folder (POST /api/agents/hidden, CSRF-protected); Claude Code's files are never touched. */
  const change = async (action: "hide" | "unhide" | "unhideAll", ids: string[] = []) => {
    try {
      const { csrf } = await api.load();
      const r = await fetch("/api/agents/hidden", { method: "POST", cache: "no-store", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify({ action, ids }) });
      if (!r.ok) throw new Error(String(r.status));
      setHidden(new Set(((await r.json()) as { hidden: string[] }).hidden));
      setHideErr(false);
    } catch { setHideErr(true); }
  };
  const all = useMemo(() => data?.agents ?? [], [data]);
  const inProject = useMemo(() => all.filter((a) => (!project || a.project === project) && hidden.has(a.id) === (tab === "hidden")), [all, project, hidden, tab]);
  const hiddenCount = useMemo(() => all.filter((a) => (!project || a.project === project) && hidden.has(a.id)).length, [all, project, hidden]);
  const finished = inProject.filter((a) => a.state === "done" && tab !== "hidden").map((a) => a.id);
  const act: Act = { hiddenView: tab === "hidden", toggle: (n) => change(tab === "hidden" ? "unhide" : "hide", subtree(n)) };
  const forest = useMemo(() => buildForest(inProject).filter((n) => tabDeep(n, tab) && matchDeep(n, words)), [inProject, tab, words]);
  const running = inProject.filter((a) => a.state === "run").length;
  const waiting = inProject.filter((a) => a.state === "wait").length;
  const today = new Date().setHours(0, 0, 0, 0);
  const doneToday = inProject.filter((a) => a.state === "done" && a.lastAt >= today).length;
  const counts = new Map<string, number>();
  for (const a of all) counts.set(a.project, (counts.get(a.project) ?? 0) + (isActive(a) ? 1 : 0));

  return (
    <>
      <PageHeader crumbs={[{ label: t("pages.agents.crumb") }]} title={t("pages.agents.title")} desc={t("pages.agents.desc", { window: t(`pages.agents.win${data?.windowHours ?? cfg.agents.windowHours ?? 48}`) })}>
        <Seg<Tab>
          label={t("pages.agents.filter")}
          value={tab}
          onChange={setTab}
          className="w-full sm:w-auto"
          items={[
            { v: "all", label: t("pages.agents.all") },
            { v: "active", label: t("pages.agents.active"), n: running + waiting, tone: "info" },
            { v: "done", label: t("pages.agents.finished") },
            { v: "hidden", label: t("pages.agents.hidden"), n: hiddenCount },
          ]}
        />
      </PageHeader>
      <KpiStrip
        cols="grid-cols-2 xl:grid-cols-4"
        items={[
          { key: "run", label: t("pages.agents.kpiRun"), value: running, sub: waiting ? t("pages.agents.kpiRunWaiting", { n: waiting }) : t("pages.agents.kpiRunSub"), tone: "run", hot: running > 0, icon: "activity" },
          { key: "done", label: t("pages.agents.kpiDone"), value: doneToday, sub: t("pages.agents.kpiDoneSub"), tone: "success", icon: "check" },
          { key: "all", label: t("pages.agents.kpiShown"), value: inProject.length, sub: project ? names.get(project) ?? project : t("pages.agents.allProjects"), tone: "gray", icon: "bot" },
          { key: "prj", label: t("pages.agents.kpiProjects"), value: new Set(all.map((a) => a.project)).size, sub: [...counts].filter(([, n]) => n).map(([p, n]) => `${names.get(p) ?? p} ${n}`).join(" · ") || t("pages.agents.noActivity"), tone: "gray", icon: "bot" },
        ]}
      />
      <Card>
        <CardHead title={t("pages.agents.list")} desc={t("pages.agents.listDesc")}>
          <div role="group" aria-label={t("pages.agents.project")} className="flex flex-wrap gap-1 rounded-lg bg-strip p-1">
            {[["", t("pages.agents.allProjects")], ...cfg.projects.map((p) => [p.id, p.name]), ["other", "other"]].map(([id, label]) => (
              <button key={id} type="button" onClick={() => setProject(id)} aria-pressed={project === id}
                className={`rounded-md px-3 py-1.5 text-theme-xs font-medium transition ${project === id ? "seg-on text-gray-900 dark:text-white" : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white"}`}>
                {label}
              </button>
            ))}
          </div>
          {tab === "hidden" ? (
            <button type="button" disabled={!hiddenCount} onClick={() => change("unhideAll")} className="h-10 rounded-lg border border-line px-3 text-theme-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:text-gray-200 dark:hover:bg-white/5">{t("pages.agents.unhideAll")}</button>
          ) : (
            <button type="button" disabled={!finished.length} title={t("pages.agents.hideNote")} onClick={() => change("hide", finished)} className="h-10 rounded-lg border border-line px-3 text-theme-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:text-gray-200 dark:hover:bg-white/5">{t("pages.agents.hideFinished")}</button>
          )}
          <label className="relative block">
            <span className="sr-only">{t("pages.agents.filterLabel")}</span>
            <Icon name="search" className="s14 pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("pages.agents.filterPh")}
              className="dt-search h-10 w-[min(260px,70vw)] rounded-lg border border-line bg-transparent ps-9 pe-3 text-theme-sm text-gray-800 outline-none placeholder:text-gray-400 focus:border-gray-400 dark:text-white/90" />
          </label>
        </CardHead>
        {hideErr && <p role="alert" className="px-4 pb-2 text-theme-xs text-error-600 dark:text-error-400">{t("pages.agents.hideFailed")}</p>}
        {!data ? (
          <Empty icon="loader">{error ? t("pages.agents.unreachable") : t("pages.agents.reading")}</Empty>
        ) : forest.length === 0 ? (
          <Empty icon={tab === "active" ? "activity" : "check"}>{words.length ? t("pages.agents.noResults") : tab === "active" ? t("pages.agents.noneRunning") : tab === "hidden" ? t("pages.agents.noneHidden") : t("pages.agents.none")}</Empty>
        ) : (
          <div className="custom-scrollbar overflow-x-auto px-2 pb-2">
            <table className="dt dt-stack w-full min-w-[1040px]">
              <thead>
                <tr>
                  <th className="w-[26%] py-1.5 ps-3 pe-3 text-start font-medium">{t("pages.agents.colAgent")}</th>
                  <th className="px-3 py-1.5 text-start font-medium">{t("pages.agents.colProject")}</th>
                  <th className="px-3 py-1.5 text-start font-medium">{t("pages.agents.colState")}</th>
                  <th className="px-3 py-1.5 text-start font-medium">model</th>
                  <th className="px-3 py-1.5 text-start font-medium">{t("pages.agents.colBranch")}</th>
                  <th className="px-3 py-1.5 text-start font-medium">{t("pages.agents.colProgress")}</th>
                  <th className="px-3 py-1.5 text-start font-medium">{t("pages.agents.colStarted")}</th>
                  <th className="px-3 py-1.5 text-start font-medium">{t("pages.agents.colLast")}</th>
                  <th className="py-1.5 ps-3 pe-3 text-end font-medium"><span className="sr-only">{t("pages.agents.colActions")}</span></th>
                </tr>
              </thead>
              <tbody>
                {forest.map((n) => <Row key={n.a.id} n={n} depth={0} names={names} act={act} />)}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
