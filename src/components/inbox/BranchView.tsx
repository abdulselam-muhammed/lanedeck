"use client";
// Default-branch watch: our last pull of origin/<branch> vs the branch on GitHub now (data from /api/branch, measured every minute).
import React from "react";
import dynamic from "next/dynamic";
import type { EChartsCoreOption } from "echarts/core";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import Button from "@/components/ui/button/Button";
import { useTheme } from "@/context/ThemeContext";
import { repoUrl, useBranch, useConfig, useT } from "@/context/ConfigContext";
import { RelTime } from "@/components/common/RelTime";
import { useInbox, BranchCommit, BranchData } from "./InboxContext";
import { Icon } from "./IconSprite";
import { Card, CardHead, Empty, KpiStrip, PageHeader } from "./bits";

const EChart = dynamic(() => import("@/components/charts/EChart"), { ssr: false });
const shortSha = (x: string | null | undefined) => (x || "").slice(0, 9);
const lbl = (c: BranchCommit | null) => (c ? (c.pr ? "#" + c.pr : c.sha.slice(0, 7)) : "…");
const bare = (s: string) => s.replace(/\s*\(#\d+\)\s*$/, "");

function When({ iso }: { iso: string | null | undefined }) {
  return iso ? <span title={iso}><RelTime at={Date.parse(iso)} /></span> : <>—</>;
}
const ShaLink = ({ sha }: { sha: string }) => {
  const GH = repoUrl(useConfig()) ?? "";
  return (
  <a href={`${GH}/commit/${sha}`} target="_blank" rel="noopener noreferrer" className="text-gray-800 underline-offset-2 hover:underline dark:text-gray-200">
    <code dir="ltr" className="mono text-theme-xs">
      {shortSha(sha)}
    </code>
  </a>
  );
};
const PrLink = ({ c }: { c: BranchCommit }) => {
  const GH = repoUrl(useConfig()) ?? "";
  return c.pr ? (
    <a href={`${GH}/pull/${c.pr}`} target="_blank" rel="noopener noreferrer" className="mono text-gray-800 underline-offset-2 hover:underline dark:text-gray-200">
      #{c.pr}
    </a>
  ) : null;
};

/**
 * Two series on one calendar-day axis (Apache ECharts), the last 14 days, one vertical line per day.
 * y = the cumulative number of commits on the default branch since the start of the window: GitHub's default branch (a wide blue
 * band with a soft area under it) and our local origin/<branch>, i.e. our last pull (a thin orange line on top).
 * Days without commits stay flat and have no marker. Data: `/api/branch` `days` (GitHub's commit list, cached
 * by the server, and a read-only `git log` of our ref). Time runs from the right (RTL): today is leftmost.
 */
function LanesChart({ d }: { d: BranchData }) {
  const { dark } = useTheme();
  const cfg = useConfig();
  const t = useT();
  const GH = repoUrl(cfg) ?? "";
  const days = d.days;
  if (!days || !days.github) return <p className="px-3 pb-3 text-theme-sm text-muted">{t("inbox.branch.noHistory", { branch: cfg.project.defaultBranch })}</p>;
  const DAY = 86400000;
  const startOfDay = (t: number) => new Date(new Date(t).setHours(0, 0, 0, 0)).getTime();
  const last = startOfDay(Date.now());
  const grid: number[] = [];
  for (let i = 13; i >= 0; i--) grid.push(last - i * DAY);
  const bucket = (dates: string[]) => {
    const per = grid.map(() => 0);
    for (const s of dates) {
      const k = Math.round((startOfDay(Date.parse(s)) - grid[0]) / DAY);
      if (k >= 0 && k < grid.length) per[k] += 1;
    }
    return per;
  };
  const gPer = bucket(days.github);
  const oPer = bucket(days.ours);
  const cum = (per: number[]) => per.reduce<number[]>((a, n, i) => [...a, (a[i - 1] ?? 0) + n], []);
  const gCum = cum(gPer);
  const oCum = cum(oPer);
  // The commits the snapshot names (our last ones + what was pushed after our pull), per day, for the tooltip.
  const dayKey = (t: number) => new Date(startOfDay(t)).getTime();
  const named = [...(d.before || []), ...(d.behind ? d.newer || [] : [])].map((c) => ({ c, t: Date.parse(c.at) }));
  const namedOf = (t: number) => named.filter((x) => dayKey(x.t) === t).sort((a, b) => b.t - a.t);
  const idx = grid.map((_, i) => i); // oldest first, so today is on the right
  const accent = dark ? "#22d3ee" : "#0891b2";
  const blue = dark ? "#38bdf8" : "#0284c7";
  const txt = dark ? "#8fb3c9" : "#4d6a7a";
  const label = (t: number) => new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const gitData = idx.map((i) => ({ value: gCum[i], symbolSize: gPer[i] ? 9 : 0 }));
  const usData = idx.map((i) => oCum[i]);
  const vals = [...gitData.map((x) => x.value), ...usData];
  const option: EChartsCoreOption = {
    animation: false,
    grid: { left: 28, right: 28, top: 16, bottom: 36 },
    tooltip: {
      trigger: "axis",
      confine: true,
      backgroundColor: dark ? "#0a1a2f" : "#ffffff",
      borderColor: dark ? "rgba(56,189,248,0.4)" : "#b9d3e3",
      textStyle: { color: dark ? "#e2f3ff" : "#0b2538", fontSize: 12 },
      axisPointer: { type: "line", lineStyle: { color: dark ? "rgba(56,189,248,0.4)" : "#a9c6da" } },
      formatter: (ps: unknown) => {
        const i = idx[(ps as { dataIndex: number }[])[0].dataIndex];
        const rows = namedOf(grid[i])
          .map((r) => `<div style="margin-top:4px"><b dir="ltr">${esc(lbl(r.c))}</b> <span dir="auto">${esc(bare(r.c.subject))}</span></div>`)
          .join("");
        return `<div dir="${cfg.ui.dir}" style="max-width:320px;white-space:normal;line-height:1.55"><b dir="ltr">${label(grid[i])}</b><br>${esc(t("inbox.branch.tipGithub", { per: gPer[i], cum: gCum[i] }))}<br>${esc(t("inbox.branch.tipUs", { per: oPer[i], cum: oCum[i] }))}${rows}</div>`;
      },
    },
    xAxis: {
      type: "category",
      data: idx.map((i) => label(grid[i])),
      boundaryGap: false,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: txt, fontSize: 11, interval: 0, hideOverlap: true, margin: 14 },
      splitLine: { show: true, lineStyle: { color: dark ? "rgba(56,189,248,0.12)" : "rgba(14,116,144,0.14)", width: 1 } },
    },
    yAxis: { type: "value", min: 0, max: Math.max(...vals) + 2, show: false, splitLine: { show: false } },
    series: [
      // The gap between GitHub and our pull, filled red: an invisible base at our line, then the difference stacked on it.
      { name: "gap-base", type: "line", stack: "gap", data: usData, symbol: "none", lineStyle: { opacity: 0 }, tooltip: { show: false }, emphasis: { disabled: true }, silent: true, z: 1 },
      {
        name: "gap",
        type: "line",
        stack: "gap",
        data: idx.map((i) => Math.max(0, gCum[i] - oCum[i])),
        symbol: "none",
        lineStyle: { opacity: 0 },
        areaStyle: { color: dark ? "rgba(239,68,68,0.45)" : "rgba(220,38,38,0.35)" },
        tooltip: { show: false },
        emphasis: { disabled: true },
        silent: true,
        z: 1,
      },
      {
        name: "GitHub",
        type: "line",
        smooth: false,
        data: gitData,
        symbol: "circle",
        showSymbol: true,
        itemStyle: { color: blue, opacity: 0.9 },
        lineStyle: { color: blue, width: 10, opacity: 0.32, cap: "round", join: "round" },
        areaStyle: { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: "rgba(56,189,248,0.32)" }, { offset: 1, color: "rgba(56,189,248,0)" }] } },
        z: 2,
      },
      { name: "us", type: "line", smooth: false, data: usData, showSymbol: false, symbol: "none", lineStyle: { color: accent, width: 2.5, cap: "round", join: "round", shadowColor: accent, shadowBlur: dark ? 10 : 0 }, emphasis: { disabled: true }, z: 3 },
    ],
  };
  return (
    <div dir="ltr">
      <EChart
        option={option}
        height={280}
        label={t("inbox.branch.chartLabel", { branch: cfg.project.defaultBranch })}
        onPointClick={(k) => {
          const i = idx[k];
          const c = namedOf(grid[i])[0]?.c;
          const url = c
            ? `${GH}/commit/${c.sha}`
            : `${GH}/commits/${cfg.project.defaultBranch}?since=${new Date(grid[i]).toISOString()}&until=${new Date(grid[i] + DAY).toISOString()}`;
          window.open(url, "_blank", "noopener,noreferrer");
        }}
      />
    </div>
  );
}

/** The card's head (title, subtitle, square-swatch legend with the delta pill) and the chart under it. */
function LanesCard({ d }: { d: BranchData }) {
  const { dark } = useTheme();
  const b = useBranch();
  const t = useT();
  const late = (d.behind ?? 0) > 0;
  const known = d.behind != null;
  const sw = (c: string) => <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: c }} />;
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-3 pt-3 pb-2.5">
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold text-gray-900 dark:text-white">{t("inbox.branch.lanes")}</h2>
          <p className="mt-1 text-theme-sm text-muted">{t("inbox.branch.lanesDesc", { branch: b })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-theme-sm text-gray-700 dark:text-gray-300">
          <span className="inline-flex items-center gap-2">
            {sw(dark ? "#38bdf8" : "#0284c7")}
            GitHub
          </span>
          <span className="inline-flex items-center gap-2">
            {sw(dark ? "#22d3ee" : "#0891b2")}
            {t("inbox.branch.us")}
          </span>
          {known && (
            <span
              className={`rounded-full border px-2.5 py-0.5 text-theme-xs font-medium ${
                late
                  ? "border-error-500/30 bg-error-500/10 text-error-600 dark:text-error-400"
                  : "border-success-500/30 bg-success-500/10 text-success-600 dark:text-success-400"
              }`}
            >
              {late ? t("inbox.branch.behindN", { n: d.behind ?? 0 }) : t("inbox.branch.inSync")}
            </span>
          )}
        </div>
      </div>
      <div className="px-3 pb-2.5 md:px-3">
        <LanesChart d={d} />
      </div>
    </>
  );
}

/** /branch: our last pull of origin/<branch> vs <branch> on GitHub — KPIs, the verdict, the lanes chart, the details and the newer commits. */
export default function BranchView() {
  const { branchData: d, loadBranch, branchLoading } = useInbox();
  const b = useBranch();
  const t = useT();
  const pull = (
    <Button size="sm" disabled={branchLoading} onClick={() => loadBranch(true)} startIcon={<Icon name="refresh" className="s14" />}>
      {t("inbox.branch.pullNow", { branch: b })}
    </Button>
  );
  const head = (
    <PageHeader crumbs={[{ label: t("inbox.branch.crumb") }]} title={<span className="inline-flex items-center gap-2.5">{t("nav.branch")} <span dir="ltr" className="mono rounded-md bg-strip px-2 py-0.5 text-theme-xs font-medium text-muted">{b}</span></span>} desc={t("inbox.branch.headDesc", { branch: b })}>
      {pull}
    </PageHeader>
  );
  if (!d)
    return (
      <>
        {head}
        <Empty icon="loader">{t("inbox.branch.checking")}</Empty>
      </>
    );
  const L = d.latest;
  const verdict =
    d.behind == null && d.noLocalRepo && d.latest ? (
      <b dir="ltr">no local repo: only GitHub&apos;s tip is shown</b>
    ) : d.behind == null ? (
      <b className="text-error-600 dark:text-error-400">{d.error || t("inbox.branch.measureFailed")}</b>
    ) : d.behind === 0 ? (
      <>
        <b className="text-success-600 dark:text-success-400">✓ {t("inbox.branch.upToDate", { branch: b })}</b>: {t("inbox.branch.sameCommit")}
      </>
    ) : (
      <>
        <b className="text-error-600 dark:text-error-400">⚠ {t("inbox.branch.behindBy", { n: d.behind })}</b> {t("inbox.branch.pushedAfter", { branch: b })}
      </>
    );
  const th = "px-3 py-1.5 text-start text-theme-xs font-medium text-gray-500 dark:text-gray-400";
  const td = "px-3 py-1.5 text-start text-theme-sm text-gray-700 dark:text-gray-300";
  return (
    <>
      {head}
      <KpiStrip
        cols="grid-cols-2 xl:grid-cols-4"
        items={[
          {
            key: "behind",
            label: t("inbox.branch.kpiBehind"),
            value: d.behind == null ? "—" : d.behind === 0 ? "✓" : d.behind,
            sub: d.behind == null ? (d.noLocalRepo && d.latest ? "no local repo" : d.error || t("inbox.branch.measureFailed")) : d.behind ? t("inbox.branch.commitsAfterPull") : t("inbox.branch.onLatest", { branch: b }),
            tone: d.behind ? "error" : "success",
            hot: d.behind != null,
            icon: "git-fork",
          },
          {
            key: "pulled",
            label: t("inbox.branch.lastPull"),
            value: <span className="text-xl">{d.pulledAt ? <RelTime at={Date.parse(d.pulledAt)} /> : "—"}</span>,
            sub: d.noLocalRepo ? <span dir="ltr">no local repo</span> : d.ourSha ? <span dir="ltr">{shortSha(d.ourSha)}</span> : "—",
            icon: "refresh",
          },
          {
            key: "latest",
            label: t("inbox.branch.lastGh"),
            value: <span className="text-xl">{L ? lbl(L) : "—"}</span>,
            sub: L ? <span dir="auto">{L.author} · <RelTime at={Date.parse(L.at)} /></span> : "—",
            icon: "globe",
          },
          { key: "checked", label: t("inbox.branch.lastCheck"), value: <span className="text-xl"><RelTime at={Date.parse(d.checkedAt)} /></span>, sub: t("inbox.branch.everyMinute"), icon: "clock" },
        ]}
      />
      <div className="grid gap-3 [&>*]:min-w-0">
        <Card className={`px-3 py-2 text-theme-sm text-gray-700 dark:text-gray-300 ${d.behind ? "border-error-200 dark:border-error-500/30" : ""}`}>{verdict}</Card>
        <Card>
          <LanesCard d={d} />
        </Card>
        <Card className="overflow-hidden">
          <CardHead title={t("inbox.branch.details")} />
          <div className="max-w-full overflow-x-auto">
            <Table>
              <TableBody className="divide-y divide-line border-t border-line ">
                <TableRow>
                  <TableCell isHeader className={th + " w-56"}>
                    {t("inbox.branch.ourPull", { branch: b })}
                  </TableCell>
                  <TableCell className={td}>
                    {d.ourSha ? <ShaLink sha={d.ourSha} /> : "—"} · {t("inbox.branch.pulled")} <When iso={d.pulledAt} />
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell isHeader className={th}>
                    {t("inbox.branch.ghNow")}
                  </TableCell>
                  <TableCell className={td}>
                    {L ? (
                      <>
                        <ShaLink sha={L.sha} /> <PrLink c={L} /> · <span dir="auto">{L.subject}</span> · {L.author} · <When iso={L.at} />
                      </>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell isHeader className={th}>
                    {t("inbox.branch.lastCheck")}
                  </TableCell>
                  <TableCell className={td}>
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <When iso={d.checkedAt} /> · {t("inbox.branch.everyMinute")} ·
                      <Button size="sm" variant="outline" disabled={branchLoading} onClick={() => loadBranch(true)} startIcon={<Icon name="refresh" className="s14" />}>
                        {t("inbox.branch.pullNow", { branch: b })}
                      </Button>
                    </span>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </Card>
        {!!d.behind && (
          <Card className="overflow-hidden">
            <CardHead title={t("inbox.branch.newerTitle", { branch: b, n: d.behind })} desc={t("inbox.branch.newestFirst")} />
            <div className="max-w-full overflow-x-auto">
              <Table>
                <TableHeader className="border-y border-line bg-strip ">
                  <TableRow>
                    {["commit", "PR", t("inbox.branch.colTitle"), t("inbox.branch.colAuthor"), t("inbox.branch.colWhen")].map((h) => (
                      <TableCell key={h} isHeader className={th}>
                        {h}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-line">
                  {d.newer.map((c) => (
                    <TableRow key={c.sha}>
                      <TableCell className={td}>
                        <ShaLink sha={c.sha} />
                      </TableCell>
                      <TableCell className={td}>
                        <PrLink c={c} />
                      </TableCell>
                      <TableCell className={td}>
                        <span dir="auto">{bare(c.subject)}</span>
                      </TableCell>
                      <TableCell className={td}>{c.author}</TableCell>
                      <TableCell className={td + " whitespace-nowrap"}>
                        <When iso={c.at} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        )}
        <p className="text-theme-xs leading-6 text-gray-500 dark:text-gray-400">
          {t("inbox.branch.method", { branch: b })}
        </p>
      </div>
    </>
  );
}
