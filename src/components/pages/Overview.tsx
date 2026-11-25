"use client";
// Overview (VR2: the page that opens first): the KPI row, the active agents with their progress,
// the agents' states (donut), the first open questions, the inbox activity of 14 days (bar), and the
// latest events (timeline). Everything is read from the live snapshot; nothing new is fetched.
import React, { useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { ApexOptions } from "apexcharts";
import type { EChartsCoreOption } from "echarts/core";
import { useTheme } from "@/context/ThemeContext";
import { useBranch, useConfig, useProject, useT } from "@/context/ConfigContext";
import { useProjectPrs } from "@/lib/prs/useProjectPrs";
import { byActivity, CHIP_LABEL, hrefOf, isReadme, openQuestions, stateKey, StateKey, titleOf, TreeNode, whenOf } from "@/lib/inbox/model";
import { RelTime } from "@/components/common/RelTime";
import { md } from "@/lib/inbox/markdown";
import { SetupCard } from "@/components/setup/Setup";
import { useInbox } from "@/components/inbox/InboxContext";
import { Icon } from "@/components/inbox/IconSprite";
import { Card, CardHead, Chip, Empty, Kpi, KpiStrip, MiniBar, MoreLink, PageHeader } from "@/components/inbox/bits";
import { CopyButton } from "@/components/inbox/QuestionsView";

const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });
const EChart = dynamic(() => import("@/components/charts/EChart"), { ssr: false });

// Status hues (DESIGN.md), light / dark — the same tokens as the chips, for the charts.
export const HUE = {
  run: ["#0369a1", "#38bdf8"],
  wait: ["#0284c7", "#7dd3fc"],
  done: ["#0f766e", "#2dd4bf"],
  idle: ["#4d6a7a", "#8fb3c9"],
  blocked: ["#be123c", "#fb7185"],
} as const;

/** The agent's progress as a number, or null when it cannot be estimated. */
export function pctOf(n: TreeNode): number | null {
  const a = n.agent;
  if (!a) return null;
  if (a.state === "done") return 100;
  const p = a.progress;
  if (!p || p.source === "none") return null;
  return p.pct;
}

export function useOverviewKpis(): Kpi[] {
  const b = useBranch();
  const { base, id } = useProject();
  const t = useT();
  const prs = useProjectPrs(id);
  const { metrics: m, unreadCount, branchData, setFilter } = useInbox();
  const noReviewer = useConfig().project.reviewers.length === 0;
  const branchValue = !branchData || branchData.behind == null ? "—" : branchData.behind ? branchData.behind : "✓";
  const branchSub = !branchData ? t("pages.ov.kpiScanning") : branchData.behind == null ? branchData.error || t("pages.ov.kpiMeasureFail") : branchData.behind ? t("pages.ov.kpiBehind") : t("pages.ov.kpiLatest", { pr: branchData.latest?.pr ? " · #" + branchData.latest.pr : "" });
  const all: Kpi[] = [
    { key: "active", label: t("pages.ov.kpiActive"), value: m.agentsRunning, sub: m.subagentsRunning ? t("pages.ov.kpiActiveSubs", { n: m.subagentsRunning }) : m.fileOnlyRunning ? t("pages.ov.kpiActiveFiles", { n: m.fileOnlyRunning }) : t("pages.ov.kpiActiveLive"), see: t("pages.ov.kpiActiveSee"), icon: "activity", tone: "run", hot: m.agentsRunning > 0, href: `/agents?p=${id}`, onClick: () => setFilter("active"), title: t("pages.ov.kpiActiveTitle") },
    { key: "questions", label: t("pages.ov.kpiQ"), value: m.questions, sub: t("pages.ov.kpiQSub", { n: m.waitingFiles }), see: t("pages.ov.kpiQSee"), icon: "help", tone: "gray", hot: m.questions > 0, href: base + "/questions", title: t("pages.ov.kpiQTitle") },
    { key: "unread", label: t("pages.ov.kpiUnread"), value: unreadCount, sub: t("pages.ov.kpiUnreadSub"), see: t("pages.ov.kpiUnreadSee"), icon: "bell", tone: "brand", hot: unreadCount > 0, href: base + "/inbox", title: t("pages.ov.kpiUnreadTitle") },
    { key: "branch", label: b, value: branchValue, sub: branchSub, see: t("pages.ov.kpiDetails"), icon: "git-fork", tone: branchData && branchData.behind ? "error" : "success", hot: !!branchData && branchData.behind != null, href: base + "/branch", title: t("pages.ov.kpiBranchTitle", { b }) },
    { key: "prs-us", label: t("pages.ov.kpiUs"), value: prs ? prs.us : "—", sub: t("pages.ov.kpiUsSub"), see: t("pages.ov.kpiBoard"), icon: "alert", tone: prs && prs.us ? "error" : "gray", hot: !!prs && prs.us > 0, href: base + "/prs", title: t("pages.ov.kpiUsTitle") },
    { key: "prs-rev", label: t("who.reviewer"), value: prs ? prs.reviewer : "—", sub: prs ? t("pages.ov.kpiRevSub", { n: prs.open }) : t("pages.ov.kpiReading"), see: t("pages.ov.kpiBoard"), icon: "circle-check", tone: "brand", hot: !!prs && prs.reviewer > 0, href: base + "/prs", title: t("pages.ov.kpiRevTitle") },
  ];
  return noReviewer ? all.filter((k) => k.key !== "prs-rev") : all; // no reviewer configured: no "waiting on {reviewer}" tile
}

function ActiveAgents() {
  const t = useT();
  const { tree, metrics } = useInbox();
  const { id, base } = useProject();
  const live = [...tree.nodes.values()].filter((n) => n.agent).sort(byActivity);
  const shown = live.slice(0, 5);
  const runners = live.filter((n) => n.agent!.state === "run");
  const running = metrics.agentsRunning; // the same number as the KPI card and the ring
  const pcts = runners.map(pctOf).filter((x): x is number => x != null);
  const avg = pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null;
  return (
    <Card className="flex flex-col xl:col-span-2">
      <CardHead title={t("pages.ov.aaTitle")} desc={t("pages.ov.aaDesc")}>
        <MoreLink href={`/agents?p=${id}`}>{t("pages.ov.viewAll")}</MoreLink>
      </CardHead>
      {shown.length === 0 ? (
        <Empty icon="bot">{t("pages.ov.noAgents12")}</Empty>
      ) : (
        <div className="overflow-x-auto">
          <div className="mx-6 mb-2.5 grid grid-cols-2 divide-x divide-line rounded-xl border border-line bg-strip py-1.5 text-center">
            <div>
              <div className="text-theme-xs text-muted">{t("pages.ov.running")}</div>
              <div className="mono text-xl font-bold text-gray-900 dark:text-white">{running}</div>
            </div>
            <div>
              <div className="text-theme-xs text-muted">{t("pages.ov.avgProgress")}</div>
              <div className="mono text-xl font-bold text-gray-900 dark:text-white">{avg == null ? "—" : avg + "%"}</div>
            </div>
          </div>
          <table className="dt w-full min-w-[620px] text-start">
            <thead>
              <tr>
                <th className="px-3 py-1.5 text-start font-medium">{t("pages.ov.colAgentStep")}</th>
                <th className="px-3 py-1.5 text-start font-medium">{t("pages.ov.colState")}</th>
                <th className="px-3 py-1.5 text-start font-medium">model</th>
                <th className="w-[34%] px-3 py-1.5 text-start font-medium">{t("pages.ov.colProgress")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map((n) => {
                const a = n.agent!;
                const pct = pctOf(n);
                return (
                  <tr key={n.key} className="hover:bg-gray-50 dark:hover:bg-white/[0.02]">
                    <td className="max-w-0 px-3 py-1.5">
                      <Link href={hrefOf(n.key, base)} className="grid min-w-0">
                        <b dir="auto" className="truncate text-theme-sm font-medium text-gray-800 hover:underline dark:text-white/90">
                          {titleOf(n)}
                        </b>
                        <span dir="auto" className="truncate text-theme-xs text-gray-500 mono dark:text-gray-400" title={a.step}>
                          {a.step || "—"}
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-1.5">
                      <Chip n={n} />
                    </td>
                    <td className="px-3 py-1.5">{a.model ? <span className="tag">{a.model}</span> : "—"}</td>
                    <td className="px-3 py-2">
                      <span className="mb-2 flex items-center justify-between gap-2 text-theme-xs">
                        <span className="truncate text-gray-500 dark:text-gray-400">
                          {a.state === "done" ? t("pages.ov.done") : a.state === "stopped" ? t("pages.ov.stopped") : a.progress?.phase?.label || (a.progress && a.progress.total ? t("pages.ov.progressOf", { done: a.progress.done, total: a.progress.total }) : t("pages.ov.unspecified"))}
                        </span>
                        <b className="mono text-gray-800 dark:text-white/90">{pct == null ? "—" : pct + "%"}</b>
                      </span>
                      <MiniBar n={n} pct={pct ?? 0} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// One muted tone per state, from the status hues (blue run, teal wait, green done, grey idle, red blocked); [light, dark].
const SLICE: Record<"run" | "wait" | "done" | "idle" | "blocked", [string, string]> = {
  run: ["#0284c7", "#0ea5e9"],
  wait: ["#0891b2", "#22d3ee"],
  done: ["#0d9488", "#2dd4bf"],
  idle: ["#64839a", "#5b7a92"],
  blocked: ["#e11d48", "#be123c"],
};
const SLICE_KEYS = ["run", "wait", "done", "idle", "blocked"] as const;
/** Concentric radial rings (Apache ECharts gauges): one ring per state, arc = its share of the total, from 12 o'clock; the total in the centre. */
function StateRings({ items, total, dark }: { items: { k: (typeof SLICE_KEYS)[number]; n: number; color: string }[]; total: number; dark: boolean }) {
  const t = useT();
  const track = dark ? "rgba(56,189,248,0.12)" : "rgba(14,116,144,0.1)";
  const W = 9; // ring thickness in px
  const option: EChartsCoreOption = {
    animation: false,
    tooltip: {
      trigger: "item",
      confine: true,
      backgroundColor: dark ? "#0a1a2f" : "#ffffff",
      borderColor: dark ? "rgba(56,189,248,0.4)" : "#b9d3e3",
      textStyle: { color: dark ? "#e2f3ff" : "#0b2538", fontSize: 12 },
      formatter: (p: unknown) => {
        const q = p as { seriesName: string; value: number };
        return `${q.seriesName}: <b>${q.value}</b> / ${total}`;
      },
    },
    series: items.map((it, i) => ({
      type: "gauge" as const,
      name: CHIP_LABEL[it.k],
      center: ["50%", "50%"],
      radius: `${96 - i * 14}%`,
      startAngle: 90,
      endAngle: -270, // clockwise from 12 o'clock
      min: 0,
      max: Math.max(total, 1),
      pointer: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { show: false },
      title: { show: false },
      detail: { show: false },
      axisLine: { roundCap: true, lineStyle: { width: W, color: [[1, track]] as [number, string][] } },
      progress: { show: true, roundCap: true, width: W, itemStyle: { color: it.color } },
      data: [{ value: it.n, name: CHIP_LABEL[it.k] }],
      z: 2 + i,
    })),
    graphic: [
      { type: "text", left: "center", top: "41%", style: { text: String(total), fill: dark ? "#e2f3ff" : "#0b2538", font: "700 26px Readex Pro, system-ui, sans-serif", textAlign: "center" } },
      { type: "text", left: "center", top: "56%", style: { text: "agent", fill: dark ? "#8fb3c9" : "#4d6a7a", font: "500 12px Readex Pro, system-ui, sans-serif", textAlign: "center" } },
    ],
  };
  return <EChart option={option} height={260} label={t("pages.ov.ringLabel", { n: total })} />;
}

function StatesDonut() {
  const t = useT();
  const { metrics } = useInbox();
  const { dark } = useTheme();
  const tally = metrics.ring; // per agent, by id; ring.run === agentsRunning
  // Running, done and stopped always show (a zero is an answer too); waiting and idle only when present.
  const ALWAYS = new Set<string>(["run", "done", "blocked"]);
  const items = SLICE_KEYS.filter((k) => tally[k] > 0 || ALWAYS.has(k)).map((k) => ({ k, n: tally[k], color: SLICE[k][dark ? 1 : 0] }));
  const total = items.reduce((s, i) => s + i.n, 0);
  return (
    <Card className="flex flex-col">
      <CardHead title={t("pages.ov.statesTitle")} desc={t("pages.ov.last12")} />
      {total === 0 ? (
        <Empty icon="pie">{t("pages.ov.noAgents12")}</Empty>
      ) : (
        <div className="flex flex-1 flex-col justify-center gap-3 px-3 pb-3">
          <StateRings items={items} total={total} dark={dark} />
          <ul className="grid grid-cols-3 gap-x-2 gap-y-4">
            {items.map((i) => (
              <li key={i.k} className="flex min-w-0 items-stretch gap-2.5">
                <span className="w-[3px] shrink-0 rounded-full" style={{ background: i.color }} />
                <span className="min-w-0">
                  <span className="block text-theme-xs text-muted">{CHIP_LABEL[i.k]}</span>
                  <b className="mono block text-theme-sm text-gray-800 dark:text-white/90">{i.n}</b>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

/** Files last changed per day, 14 days; the newest day on the left, so time runs from the right (RTL). */
function ActivityBars() {
  const t = useT();
  const { ui } = useConfig();
  const { files } = useInbox();
  const { dark } = useTheme();
  const [tab, setTab] = useState<"all" | "agents" | "q">("all");
  const days = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const out: { label: string; full: string; all: number; agents: number; q: number }[] = [];
    for (let i = 0; i < 14; i++) {
      const d0 = new Date(start);
      d0.setDate(start.getDate() - i);
      const d1 = new Date(d0);
      d1.setDate(d0.getDate() + 1);
      const inDay = files.filter((f) => !f.general && f.mtime >= d0.getTime() && f.mtime < d1.getTime());
      out.push({
        label: String(d0.getDate()),
        full: d0.toLocaleDateString(ui.lang === "ar" ? "ar-u-nu-latn" : "en-GB", { weekday: "long", day: "numeric", month: "numeric" }),
        all: inDay.length,
        agents: inDay.filter((f) => f.agentIds.length > 0).length,
        q: inDay.filter((f) => f.questions.length > 0).length,
      });
    }
    return out; // index 0 = today, drawn leftmost: time runs from the right (RTL)
  }, [files, ui.lang]);
  const TABS = [
    { k: "all", label: t("pages.ov.tabAll") },
    { k: "agents", label: t("pages.ov.tabAgents") },
    { k: "q", label: t("pages.ov.tabQ") },
  ] as const;
  const data = days.map((d) => d[tab]);
  // The dashed second series: the trailing 7-day average (oldest days have fewer to average).
  const avg = data.map((_, i) => {
    const w = data.slice(i, i + 7);
    return Math.round((w.reduce((x, y) => x + y, 0) / w.length) * 10) / 10;
  });
  const options: ApexOptions = {
    chart: { type: "area", fontFamily: "inherit", toolbar: { show: false }, zoom: { enabled: false }, background: "transparent", animations: { enabled: false } },
    theme: { mode: dark ? "dark" : "light" },
    colors: [dark ? "#22d3ee" : "#0891b2", dark ? "#2dd4bf" : "#0f766e"],
    stroke: { curve: "smooth", width: [2.5, 1.75], dashArray: [0, 6] },
    fill: { type: ["gradient", "solid"], gradient: { shadeIntensity: 0, opacityFrom: dark ? 0.32 : 0.22, opacityTo: 0, stops: [0, 95] }, opacity: [1, 0] },
    markers: { size: 0, hover: { size: 5 } },
    legend: { show: true, position: "top", horizontalAlign: "right", fontSize: "12px", markers: { size: 5 }, itemMargin: { horizontal: 10 } },
    dataLabels: { enabled: false },
    grid: { borderColor: dark ? "rgba(56,189,248,0.12)" : "rgba(14,116,144,0.12)", strokeDashArray: 0, xaxis: { lines: { show: false } }, padding: { left: 8, right: 8 } },
    xaxis: { categories: days.map((d) => d.label), axisBorder: { show: false }, axisTicks: { show: false }, labels: { style: { fontSize: "11px" } }, tooltip: { enabled: false } },
    yaxis: { labels: { formatter: (v: number) => String(Math.round(v)) }, forceNiceScale: true, min: 0 },
    tooltip: {
      shared: true,
      custom: ({ dataPointIndex }) => {
        const d = days[dataPointIndex];
        return `<div dir="${ui.dir}" style="padding:6px 10px;font-size:12px">${d.full}: ${t("pages.ov.tipFiles", { n: `<b>${d[tab]}</b>`, avg: avg[dataPointIndex] })}</div>`;
      },
    },
  };
  return (
    <Card className="flex flex-col xl:col-span-2">
      <CardHead title={t("pages.ov.actTitle")} desc={t("pages.ov.actDesc")} />
      <div role="tablist" aria-label={t("pages.ov.metric")} className="mx-6 flex gap-3 border-b border-line">
        {TABS.map((tb) => {
          const total = days.reduce((x, d) => x + d[tb.k], 0);
          const on = tab === tb.k;
          return (
            <button
              key={tb.k}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setTab(tb.k)}
              className={`-mb-px grid gap-1 border-b-2 pb-3 text-start transition-colors ${on ? "border-gray-800 dark:border-gray-200" : "border-transparent hover:border-line"}`}
            >
              <span className={`text-theme-xs font-medium ${on ? "text-gray-800 dark:text-gray-200" : "text-muted"}`}>{tb.label}</span>
              <span className={`text-2xl leading-8 font-semibold tnum ${on ? "text-gray-900 dark:text-white" : "text-gray-600 dark:text-gray-300"}`}>{total}</span>
            </button>
          );
        })}
      </div>
      <div dir="ltr" className="px-3 pt-2 pb-3">
        <Chart
          options={options}
          series={[
            { name: t("pages.ov.seriesFiles"), data },
            { name: t("pages.ov.series7"), data: avg },
          ]}
          type="area"
          height={250}
        />
      </div>
    </Card>
  );
}

function FirstQuestions() {
  const t = useT();
  const { files, freshQ } = useInbox();
  const { base } = useProject();
  const qs = openQuestions(files);
  return (
    <Card className="flex flex-col xl:col-span-3">
      <CardHead title={t("pages.ov.qTitle")} desc={t("pages.ov.qDesc")}>
        {qs.length > 0 && <MoreLink href={base + "/questions"}>{t("pages.ov.allQuestions", { n: qs.length })}</MoreLink>}
      </CardHead>
      {qs.length === 0 ? (
        <Empty icon="check-check">{t("pages.ov.noQuestions")}</Empty>
      ) : (
        <ul className="divide-y divide-line border-t border-line ">
          {qs.slice(0, 5).map(({ f, q }) => (
            <li key={f.name + "|" + q.id} className={`flex items-center gap-2 px-3 py-1.5 ${freshQ.has(f.name + "|" + q.id) ? "bg-strip/50" : ""}`}>
              <span dir="ltr" className="shrink-0 rounded-md bg-strip px-2 py-0.5 text-theme-xs font-semibold text-gray-700 mono dark:text-gray-200">
                {q.id}
              </span>
              <Link href={hrefOf(f.name, base)} className="grid min-w-0 flex-1">
                <span dir="auto" className="truncate text-theme-sm font-medium text-gray-800 hover:underline dark:text-white/90">
                  {q.title.replace(/^[A-Z]{1,8}\d{1,3}\s*[—–-]?\s*/, "")}
                </span>
                <span dir="ltr" className="truncate text-end text-theme-xs text-gray-500 mono dark:text-gray-400">
                  {f.name}
                </span>
              </Link>
              <CopyButton text={q.id + ":"} short />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const DOT: Record<StateKey, string> = {
  run: "bg-blue-light-500",
  wait: "bg-blue-light-400",
  subrun: "bg-blue-light-400",
  done: "bg-success-500",
  idle: "bg-gray-400",
  blocked: "bg-error-500",
  info: "bg-gray-400",
};

function Timeline() {
  const t = useT();
  const { tree, unreadOf } = useInbox();
  const { base } = useProject();
  const events = useMemo(
    () =>
      [...tree.nodes.values()]
        .filter((n) => !(n.file && isReadme(n.file)))
        .map((n) => ({ n, at: whenOf(n) }))
        .filter((e) => e.at > 0)
        .sort((a, b) => b.at - a.at)
        .slice(0, 8),
    [tree],
  );
  return (
    <Card>
      <CardHead title={t("pages.ov.evTitle")} desc={t("pages.ov.evDesc")}>
        <MoreLink href={base + "/inbox"}>{t("pages.ov.inbox")}</MoreLink>
      </CardHead>
      {events.length === 0 ? (
        <Empty icon="clock">{t("pages.ov.noEvents")}</Empty>
      ) : (
        <ol className="px-3 pb-3">
          {events.map(({ n, at }, i) => {
            const k = stateKey(n);
            const unread = !!n.file && unreadOf(n.file);
            const what = n.agent && n.agent.state === "run" ? n.agent.step || t("pages.ov.evRunning") : n.file?.statusText || (k !== "info" ? CHIP_LABEL[k] : t("pages.ov.evUpdate"));
            return (
              <li key={n.key} className="relative flex gap-3 pb-2.5 last:pb-0">
                {i < events.length - 1 && <span className="absolute start-[5px] top-4 bottom-0 w-px bg-line" aria-hidden="true" />}
                <span className={`relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full ring-4 ring-white dark:ring-gray-900 ${unread ? "bg-gray-500 dark:bg-gray-300" : DOT[k]}`} />
                <Link href={hrefOf(n.key, base)} className="grid min-w-0 flex-1 gap-0.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <b dir="auto" className="truncate text-theme-sm font-medium text-gray-800 hover:underline dark:text-white/90">
                      {titleOf(n)}
                    </b>
                    {unread && <span className="rounded-full bg-strip px-1.5 text-[11px] leading-[18px] font-semibold text-gray-700 dark:text-gray-200">{t("pages.ov.new")}</span>}
                  </span>
                  <span dir="auto" className="truncate text-theme-xs text-gray-500 dark:text-gray-400">
                    {what}
                  </span>
                </Link>
                <span className="shrink-0 text-theme-xs text-gray-500 tnum dark:text-gray-400"><RelTime at={at} /></span>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

/** Protocol projects: project.md (first paragraph, "more" for the rest) and the soft "protocol" badge with the parse warnings. */
function ProtocolPanel() {
  const t = useT();
  const { protocol, files } = useInbox();
  const { id, base } = useProject();
  const [more, setMore] = useState(false);
  if (!protocol) return null;
  const blocks = (protocol.project ?? "").replace(/\r\n?/g, "\n").split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const head = blocks.findIndex((b) => !/^#{1,6}\s/.test(b));
  const first = head < 0 ? [] : [blocks[head]];
  const rest = head < 0 ? [] : blocks.slice(head + 1);
  const w = protocol.warnings;
  return (
    <>
    {(!protocol.project || !protocol.map) ? <SetupCard projectId={id} base={base} /> : files.some((f) => f.name === "00-setup.md") && <SetupCard projectId={id} base={base} aiDone />}
    <Card className="mb-3">
      <CardHead title={t("pages.ov.aboutTitle")} desc={<span dir="ltr" className="mono">.lanedeck/project.md</span>}>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-theme-xs font-medium ${w.length ? "border-warning-500/50 text-warning-700 dark:text-warning-300" : "border-line text-muted"}`}
          title={w.length ? w.join("\n") : "protocol v" + protocol.version + ": no problems"}
        >
          protocol{w.length ? ` · ${w.length}` : " ✓"}
        </span>
      </CardHead>
      <div className="px-4 pb-3">
        {first.length === 0 ? (
          <p className="text-theme-sm text-muted">{t("pages.ov.emptyProject")}</p>
        ) : (
          <div className="md-doc" dangerouslySetInnerHTML={{ __html: md([...first, ...(more ? rest : [])].join("\n\n")) }} />
        )}
        {rest.length > 0 && (
          <button type="button" onClick={() => setMore((m) => !m)} className="mt-1 text-theme-xs font-medium text-brand-600 underline underline-offset-4 dark:text-brand-400">
            {more ? t("pages.ov.less") : t("pages.ov.more")}
          </button>
        )}
        {w.length > 0 && (
          <ul aria-label="protocol warnings" className="mt-2 grid gap-0.5 text-theme-xs text-warning-700 dark:text-warning-300" dir="ltr">
            {w.map((x) => <li key={x} className="mono">⚠ {x}</li>)}
          </ul>
        )}
      </div>
    </Card>
    </>
  );
}

export default function Overview() {
  const t = useT();
  const { updatedAt, unreadCount, markAllRead } = useInbox();
  const { project } = useConfig();
  const kpis = useOverviewKpis();
  return (
    <>
      <PageHeader title={project.name} desc={t("pages.ov.pageDesc")}>
        <span className="text-theme-sm text-gray-500 dark:text-gray-400">
          {t("pages.ov.lastUpdate")}{" "}
          <span className="mono text-gray-700 dark:text-gray-300" dir="ltr">
            {updatedAt ? new Date(updatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}
          </span>
        </span>
        <button
          type="button"
          onClick={markAllRead}
          disabled={!unreadCount}
          title={unreadCount ? t("pages.ov.markAllN", { n: unreadCount }) : t("pages.ov.nothingUnread")}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-card px-3 text-theme-sm font-medium text-gray-700 shadow-theme-xs transition hover:bg-gray-50 disabled:cursor-default disabled:opacity-60 dark:text-gray-300 dark:hover:bg-white/[0.05]"
        >
          <Icon name={unreadCount ? "check-check" : "check"} />
          {unreadCount ? t("pages.ov.markAll") : t("pages.ov.nothingUnread")}
          {unreadCount > 0 && <span className="rounded-full bg-strip px-2 text-theme-xs leading-5 font-semibold text-gray-700 mono dark:text-gray-200">{unreadCount}</span>}
        </button>
      </PageHeader>
      <KpiStrip items={kpis} cols="grid-cols-2 md:grid-cols-3 xl:grid-cols-6" />
      <ProtocolPanel />
      {!updatedAt ? (
        <Empty icon="loader">{t("pages.ov.connecting")}</Empty>
      ) : (
        <div className="grid gap-3 [&>*]:min-w-0">
          <div className="grid gap-3 xl:grid-cols-3 [&>*]:min-w-0">
            <ActiveAgents />
            <StatesDonut />
          </div>
          <div className="grid gap-3 xl:grid-cols-5 [&>*]:min-w-0">
            <ActivityBars />
            <FirstQuestions />
          </div>
          <Timeline />
        </div>
      )}
    </>
  );
}
