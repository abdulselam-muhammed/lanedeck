"use client";
// /prs — the PR control board. Everything open on the project repo: where each PR stands, who it
// waits for, what failed and why, what merged. ONE WebSocket (/api/prs/ws) carries the board and the live events; the
// runners tile listens to /api/ci/ws?topics=agg. Nothing here polls. Read-only: links go to GitHub.
import React, { Fragment, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { EChartsCoreOption } from "echarts/core";
import { Card, CardHead, CountBadge, Empty, KpiStrip, PageHeader, Seg, type Kpi } from "@/components/inbox/bits";
import { Icon } from "@/components/inbox/IconSprite";
import { RelTime } from "@/components/common/RelTime";
import { useTheme } from "@/context/ThemeContext";
import { lsRead, lsWrite } from "@/lib/storage";
import { repoUrl, useBranch, useConfig, useProject, useT } from "@/context/ConfigContext";
import { openCiSocket } from "@/lib/ci/socket";
import { ConflictView } from "@/components/prs/ConflictView";
import { EVENT_TEXT, STAGES, STAGE_RANK, days, eventLabel, insights, isBoardFile, stageLabel, whoLabel, ms, stageOf, type Board, type Pr, type PrEvent } from "@/lib/prs/model";

const EChart = dynamic(() => import("@/components/charts/EChart"), { ssr: false });

/* ---------------------------------------------------------------- live data */

function usePrBoard(pid: string) {
  const [board, setBoard] = useState<Board | null>(null);
  const [events, setEvents] = useState<PrEvent[]>([]);
  const [live, setLive] = useState(false);
  useEffect(() => {
    let dead = false;
    fetch(`/api/p/${pid}/prs/board`, { cache: "no-store" })
      .then((r) => r.json())
      .then((b: Board) => !dead && setBoard((x) => x ?? b))
      .catch(() => {});
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let wait = 1000;
    const connect = () => {
      if (dead) return;
      const s = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/p/${pid}/prs/ws`);
      ws = s;
      s.onopen = () => {
        wait = 1000;
        setLive(true);
      };
      s.onmessage = (e) => {
        let m: { t: string; board?: Board; events?: PrEvent[]; event?: PrEvent };
        try {
          m = JSON.parse(String(e.data));
        } catch {
          return;
        }
        if (m.t === "hello") {
          if (m.board) setBoard(m.board);
          setEvents((m.events ?? []).slice().reverse());
        } else if (m.t === "board" && m.board) setBoard(m.board);
        else if (m.t === "event" && m.event) setEvents((x) => [m.event as PrEvent, ...x].slice(0, 200));
      };
      s.onclose = () => {
        if (ws === s) ws = null;
        setLive(false);
        if (dead) return;
        retry = setTimeout(connect, wait);
        wait = Math.min(wait * 2, 30000);
      };
      s.onerror = () => s.close();
    };
    connect();
    return () => {
      dead = true;
      if (retry) clearTimeout(retry);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    };
  }, [pid]);
  return { board, events, live };
}

type CiSum = { busy: number; total: number; queued: number; oldest: string | null };
function useRunners() {
  const [sum, setSum] = useState<CiSum | null>(null);
  useEffect(() => {
    let dead = false;
    const take = (a: CiSum) => !dead && a && setSum({ busy: a.busy, total: a.total, queued: a.queued, oldest: a.oldest });
    fetch("/api/ci/summary", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((a) => a && take(a))
      .catch(() => {});
    const close = openCiSocket({ topics: "agg", onMessage: (m) => (m.t === "hello" || m.t === "agg") && take(m.agg as CiSum) });
    return () => {
      dead = true;
      close();
    };
  }, []);
  return sum;
}

/* ---------------------------------------------------------------- small bits */

const TONE_TEXT: Record<string, string> = {
  error: "text-error-600 dark:text-error-400",
  warning: "text-warning-600 dark:text-warning-400",
  success: "text-success-600 dark:text-success-400",
  brand: "text-brand-600 dark:text-brand-400",
  info: "text-brand-600 dark:text-brand-300",
  gray: "text-muted",
};
const TONE_BG: Record<string, string> = {
  error: "bg-error-500/10 border-error-500/30",
  warning: "bg-warning-500/10 border-warning-500/30",
  success: "bg-success-500/10 border-success-500/30",
  brand: "bg-brand-500/10 border-brand-500/30",
  info: "bg-brand-500/10 border-brand-500/30",
  gray: "bg-strip border-line",
};

function PrLink({ n, url }: { n: number; url?: string }) {
  const gh = repoUrl(useConfig());
  return (
    <a
      href={url ?? `${gh}/pull/${n}`}
      target="_blank"
      rel="noreferrer"
      className="mono inline-flex items-center rounded-md border border-line bg-strip px-1.5 py-0.5 text-theme-xs font-medium text-brand-600 hover:border-brand-500 dark:text-brand-400"
      dir="ltr"
    >
      #{n}
    </a>
  );
}

function StageBadge({ pr }: { pr: Pr }) {
  const t = useT();
  const st = stageOf(pr.stage);
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-theme-xs font-medium whitespace-nowrap ${TONE_BG[st.tone]} ${TONE_TEXT[st.tone]}`}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: st.color }} />
      {stageLabel(t, st.s)}
    </span>
  );
}

/** pass / fail / running bar of a PR's checks (skipped ones are left out). */
function CiBar({ pr }: { pr: Pr }) {
  const t = useT();
  const c = pr.ci;
  const total = c.pass + c.fail + c.run + c.queue;
  if (!total) return <span className="text-theme-xs text-muted">{t("prs.noChecks")}</span>;
  const seg = (n: number, cls: string) => (n ? <span className={cls} style={{ width: `${(n / total) * 100}%` }} /> : null);
  return (
    <div className="min-w-[110px]" dir="ltr">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-strip">
        {seg(c.pass, "bg-success-500")}
        {seg(c.fail, "bg-error-500")}
        {seg(c.run, "bg-brand-500 breathe")}
        {seg(c.queue, "bg-warning-500")}
      </div>
      <div className="mono mt-1 flex gap-2 text-[11px] text-muted">
        <span title="pass">✓{c.pass}</span>
        {c.fail > 0 && <span className="text-error-500">✗{c.fail}</span>}
        {c.run > 0 && <span className="text-brand-500">▶{c.run}</span>}
        {c.queue > 0 && <span className="text-warning-500">⏸{c.queue}</span>}
        <span className="ms-auto" title="required check">
          gate:{c.gate ?? "—"}
        </span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- charts */

function StageChart({ prs, dark, onPick }: { prs: Pr[]; dark: boolean; onPick: (s: string) => void }) {
  const t = useT();
  const rows = STAGES.map((s) => ({ s, n: prs.filter((p) => p.stage === s.s).length })).filter((x) => x.n);
  const axis = dark ? "#8fb3c9" : "#475569";
  const option: EChartsCoreOption = {
    animation: false,
    grid: { left: 8, right: 36, top: 6, bottom: 6, containLabel: true },
    tooltip: { trigger: "item", confine: true, backgroundColor: dark ? "#0a1a2f" : "#fff", borderColor: "rgba(56,189,248,0.4)", textStyle: { color: dark ? "#e2f3ff" : "#0f172a" } },
    xAxis: { type: "value", show: false },
    yAxis: { type: "category", inverse: true, data: rows.map((r) => stageLabel(t, r.s.s)), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: axis, fontSize: 12, fontFamily: "inherit" } },
    series: [
      {
        type: "bar",
        barWidth: 14,
        data: rows.map((r) => ({ value: r.n, itemStyle: { color: r.s.color, borderRadius: 7, shadowColor: dark ? r.s.color : "transparent", shadowBlur: dark ? 8 : 0 } })),
        label: { show: true, position: "right", color: axis, fontFamily: "JetBrains Mono, monospace", fontSize: 12 },
      },
    ],
  };
  return <EChart option={option} height={Math.max(160, rows.length * 30 + 20)} label={t("prs.chart.byStage")} onPointClick={(i) => rows[i] && onPick(rows[i].s.s)} />;
}

function MergedChart({ perDay, dark }: { perDay: [string, number][]; dark: boolean }) {
  const t = useT();
  const axis = dark ? "#8fb3c9" : "#475569";
  const option: EChartsCoreOption = {
    animation: false,
    grid: { left: 8, right: 8, top: 18, bottom: 22, containLabel: true },
    tooltip: { trigger: "axis", confine: true, backgroundColor: dark ? "#0a1a2f" : "#fff", borderColor: "rgba(56,189,248,0.4)", textStyle: { color: dark ? "#e2f3ff" : "#0f172a" } },
    xAxis: { type: "category", data: perDay.map((d) => d[0].slice(5)), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: axis, fontSize: 10 } },
    yAxis: { type: "value", minInterval: 1, splitLine: { lineStyle: { color: dark ? "rgba(56,189,248,0.08)" : "rgba(15,23,42,0.06)" } }, axisLabel: { color: axis, fontSize: 10 } },
    series: [
      {
        type: "bar",
        name: t("prs.chart.merged"),
        barWidth: "55%",
        data: perDay.map((d) => d[1]),
        itemStyle: {
          borderRadius: [5, 5, 0, 0],
          color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: "#2dd4bf" }, { offset: 1, color: "#06b6d466" }] },
        },
        label: { show: true, position: "top", color: axis, fontSize: 10, formatter: (p: { value: number }) => (p.value ? String(p.value) : "") },
      },
    ],
  };
  return <EChart option={option} height={190} label={t("prs.chart.merged14")} />;
}

/* ---------------------------------------------------------------- table */

type View = "all" | "us" | "local" | "reviewer" | "ci" | "wait" | "held";
const VIEW_OF: Record<View, (p: Pr) => boolean> = {
  all: () => true,
  us: (p) => p.who === "us",
  local: (p) => p.who === "local",
  reviewer: (p) => p.who === "reviewer",
  ci: (p) => p.who === "ci" || p.who === "github" || p.who === "viewer",
  wait: (p) => p.who === "parent",
  held: (p) => p.who === "owner" || p.who === "none",
};

function PrRow({ pr, open, toggle }: { pr: Pr; open: boolean; toggle: () => void }) {
  const t = useT();
  const branch = useBranch();
  const BOARD_FILE = isBoardFile(useConfig().project.boardFiles);
  const age = days(pr.created);
  return (
    <>
      <tr className="cursor-pointer border-t border-line transition-colors hover:bg-strip/60" onClick={toggle}>
        <td className="px-3 py-1.5 align-top">
          <PrLink n={pr.number} url={pr.url} />
        </td>
        <td className="max-w-[420px] px-2 py-1.5 align-top">
          <div className="truncate text-theme-sm font-medium text-gray-800 dark:text-gray-100" dir="ltr" title={pr.title}>
            {pr.title}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-muted" dir="ltr">
            <span className={pr.mine ? "text-brand-600 dark:text-brand-400" : ""}>{pr.author}</span>
            {pr.base !== branch && <span title="stacked">↳ {pr.parent ? `on #${pr.parent}` : pr.base}</span>}
            {pr.children.length > 0 && <span>⤷ {pr.children.map((c) => `#${c}`).join(" ")}</span>}
            <span className="mono">
              +{pr.size.add}/−{pr.size.del} · {pr.size.files}f
            </span>
          </div>
        </td>
        <td className="px-2 py-1.5 align-top">
          <StageBadge pr={pr} />
          <div className="mt-1 max-w-[260px] truncate text-[11.5px] text-muted" title={pr.why}>
            {whoLabel(pr.who, t)} · <span dir="ltr">{pr.why}</span>
          </div>
        </td>
        <td className="px-2 py-1.5 align-top">
          <CiBar pr={pr} />
        </td>
        <td className="mono px-2 py-1.5 align-top text-[11.5px] text-muted" dir="ltr">
          {pr.mergeable === "CONFLICTING" ? <span className="text-error-500">CONFLICT</span> : pr.state}
          {pr.measured && <div className="text-[10.5px] text-brand-500" title={t("prs.measuredTip")}>measured locally</div>}
          {pr.review && <div className="text-[10.5px]">{pr.review.replace("_", " ").toLowerCase()}</div>}
        </td>
        <td className="px-3 py-1.5 align-top text-[11.5px] whitespace-nowrap text-muted">
          <RelTime at={ms(pr.updated)} />
          <div className={age > 14 ? "text-warning-500" : ""}>{t("prs.age", { n: age })}</div>
        </td>
      </tr>
      {open && (
        <tr className="bg-strip/40">
          <td colSpan={6} className="px-3 py-2">
            <div className="grid gap-3 lg:grid-cols-2">
              <div>
                <p className="mb-2 text-theme-xs font-semibold text-gray-700 dark:text-gray-200">{t("prs.checks")}</p>
                <ul className="grid grid-cols-1 gap-1" dir="ltr">
                  {[...pr.ci.checks]
                    .sort((a, b) => ["fail", "run", "queue", "pass"].indexOf(a.s) - ["fail", "run", "queue", "pass"].indexOf(b.s))
                    .map((c) => (
                      <li key={c.n} className="flex items-center gap-2 text-[12px]">
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${c.s === "pass" ? "bg-success-500" : c.s === "fail" ? "bg-error-500" : c.s === "run" ? "bg-brand-500 breathe" : "bg-warning-500"}`}
                        />
                        <a href={c.u} target="_blank" rel="noreferrer" className="mono truncate hover:text-brand-500">
                          {c.n}
                        </a>
                        <span className="ms-auto text-muted">{c.s}</span>
                      </li>
                    ))}
                </ul>
              </div>
              <div>
                {pr.conflictFiles.length > 0 && (
                  <>
                    <p className="mb-2 text-theme-xs font-semibold text-gray-700 dark:text-gray-200">{t("prs.conflictFiles", { base: pr.base })}</p>
                    <ul className="mb-2.5 grid gap-1" dir="ltr">
                      {pr.conflictFiles.map((f) => (
                        <li key={f} className={`mono truncate text-[12px] ${BOARD_FILE(f) ? "text-warning-500" : "text-error-500"}`} title={f}>
                          {BOARD_FILE(f) ? "◇ " : "◆ "}
                          {f}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[12px]">
                  <dt className="text-muted">{t("prs.branch")}</dt>
                  <dd className="mono truncate" dir="ltr">
                    {pr.headRef} → {pr.base}
                  </dd>
                  <dt className="text-muted">head</dt>
                  <dd className="mono" dir="ltr">
                    {pr.head.slice(0, 9)}
                  </dd>
                  <dt className="text-muted">{t("prs.lastCommit")}</dt>
                  <dd>
                    <RelTime at={ms(pr.pushed)} />
                  </dd>
                  <dt className="text-muted">{t("prs.ciStarted")}</dt>
                  <dd>{pr.ci.started ? <RelTime at={ms(pr.ci.started)} /> : "—"}</dd>
                </dl>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- page */

export default function PrsPage() {
  const cfg = useConfig();
  const projectId = useProject().id;
  const ghUrl = repoUrl(cfg);
  const t = useT();
  const branch = cfg.project.defaultBranch;
  const { board, events, live } = usePrBoard(projectId);
  const runners = useRunners();
  const { dark } = useTheme();
  const [mine, setMine] = useState(true);
  const [view, setView] = useState<View>("all");
  const [stage, setStage] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [asked, setAsked] = useState(false);

  useEffect(() => {
    try {
      const v = lsRead("laneDeck.prs.mine");
      if (v != null) setMine(v === "1");
    } catch {
      /* private mode */
    }
  }, []);
  const setMineSaved = (v: boolean) => {
    setMine(v);
    try {
      lsWrite("laneDeck.prs.mine", v ? "1" : "0");
    } catch {
      /* private mode */
    }
  };

  const scope = useMemo(() => (board?.prs ?? []).filter((p) => !mine || p.mine), [board, mine]);
  const rows = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return scope
      .filter(VIEW_OF[view])
      .filter((p) => !stage || p.stage === stage)
      .filter((p) => words.every((w) => `#${p.number} ${p.title} ${p.author} ${p.headRef} ${p.ci.failed.join(" ")}`.toLowerCase().includes(w)))
      .sort((a, b) => (view === "local" ? (a.batch?.n ?? 99) - (b.batch?.n ?? 99) : 0) || STAGE_RANK[a.stage] - STAGE_RANK[b.stage] || a.number - b.number);
  }, [scope, view, stage, q]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- t only changes with the config
  const lines = useMemo(() => (board ? insights(board, mine, t) : []), [board, mine]);

  const count = (f: (p: Pr) => boolean) => scope.filter(f).length;
  const m24 = (board?.merged ?? []).filter((m) => Date.parse(m.at) > Date.now() - 864e5 && (!mine || m.author === board?.me));
  const noReviewer = useConfig().project.reviewers.length === 0; // no reviewer configured: no "waiting on the reviewer" tile or filter
  const allKpis: Kpi[] = [
    { key: "open", label: t("prs.kpi.open"), value: board ? scope.length : "-", sub: mine ? t("prs.kpi.openSubMine", { n: board?.prs.length ?? 0 }) : t("prs.kpi.openSubAll"), icon: "git-fork", tone: "gray", onClick: () => setView("all") },
    { key: "us", label: t("prs.kpi.us"), value: board ? count(VIEW_OF.us) : "-", sub: t("prs.kpi.usSub"), icon: "alert", tone: count(VIEW_OF.us) ? "error" : "gray", hot: count(VIEW_OF.us) > 0, onClick: () => setView("us") },
    { key: "local", label: t("prs.kpi.local"), value: board ? count(VIEW_OF.local) : "-", sub: t("prs.kpi.localSub"), icon: "hourglass", tone: "gray", onClick: () => setView("local") },
    { key: "reviewer", label: t("who.reviewer"), value: board ? count(VIEW_OF.reviewer) : "-", sub: t("kpi.reviewer.sub", { ready: count((p) => p.stage === "ready"), board: count((p) => p.stage === "board-conflict") }), icon: "check-check", tone: "success", onClick: () => setView("reviewer") },
    { key: "ci", label: t("prs.kpi.ci"), value: board ? count((p) => p.stage === "ci-running") : "-", sub: t("prs.kpi.ciSub"), icon: "loader", tone: "run", onClick: () => setView("ci") },
    { key: "merged", label: t("prs.kpi.merged"), value: board ? m24.length : "-", sub: t("prs.kpi.mergedSub", { n: board?.merged.length ?? 0 }), icon: "circle-check", tone: "success" },
    { key: "runners", label: t("prs.kpi.runners"), value: runners ? runners.queued : "-", sub: runners ? t("prs.kpi.runnersSub", { busy: runners.busy, total: runners.total }) : "—", icon: "hourglass", tone: runners && runners.queued > 20 ? "warning" : "gray", href: "/ci" },
  ];
  const kpis = allKpis.filter((k) => !(noReviewer && k.key === "reviewer"));

  const refresh = () => {
    setAsked(true);
    fetch(`/api/p/${projectId}/prs/refresh`, { cache: "no-store" }).finally(() => setTimeout(() => setAsked(false), 20000));
  };

  return (
    <>
      <PageHeader
        crumbs={[{ label: t("prs.crumb") }]}
        title={t("prs.heading")}
        desc={t("prs.desc")}
      >
        <span className={`inline-flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-theme-xs ${live ? "text-success-600 dark:text-success-400" : "text-error-500"}`}>
          <span className={`h-2 w-2 rounded-full ${live ? "bg-success-500 breathe" : "bg-error-500"}`} />
          {live ? t("prs.live") : t("prs.offline")}
        </span>
        <span className="text-theme-xs text-muted">
          {t("prs.readAt")} {board?.readAt ? <RelTime at={board.readAt} /> : "…"}
        </span>
        <button
          type="button"
          onClick={refresh}
          disabled={asked}
          className="inline-flex items-center gap-2 rounded-lg border border-line bg-card px-3 py-1.5 text-theme-xs font-medium hover:border-brand-500 disabled:opacity-50"
        >
          <Icon name="refresh" className={`s14 ${asked ? "animate-spin" : ""}`} /> {t("prs.refresh")}
        </button>
      </PageHeader>

      {board?.error && (
        <div className="mb-2.5 rounded-xl border border-error-500/30 bg-error-500/10 px-3 py-2 text-theme-sm text-error-600 dark:text-error-400" dir="ltr">
          {board.error}
        </div>
      )}

      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <Seg
          label={t("prs.scope")}
          value={mine ? "mine" : "all"}
          onChange={(v) => setMineSaved(v === "mine")}
          items={[
            { v: "mine", label: t("prs.scope.mine") },
            { v: "all", label: t("prs.scope.all") },
          ]}
        />
        {board?.tip && (
          <span className="text-theme-xs text-muted">
            {branch}{" "}
            <a className="mono text-brand-600 dark:text-brand-400" dir="ltr" target="_blank" rel="noreferrer" href={`${ghUrl}/commit/${board.tip.sha}`}>
              {board.tip.sha.slice(0, 9)}
            </a>{" "}
            · <RelTime at={ms(board.tip.at)} /> · <span dir="ltr">{board.tip.msg.slice(0, 70)}</span>
          </span>
        )}
      </div>

      <KpiStrip items={kpis} cols="grid-cols-2 md:grid-cols-3 xl:grid-cols-7" />

      <div className="mb-3 grid grid-cols-1 gap-3 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHead title={t("prs.digest.title")} desc={t("prs.digest.desc")} />
          <ul className="grid grid-cols-1 gap-2 px-3 pb-3">
            {!board && <li className="text-theme-sm text-muted">{t("prs.reading")}</li>}
            {lines.map((l, i) => (
              <li key={i} className={`rounded-xl border px-3 py-1.5 ${TONE_BG[l.tone]}`}>
                <div className={`text-theme-sm font-medium ${TONE_TEXT[l.tone]}`}>{l.text}</div>
                {l.prs && l.prs.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {l.prs.slice(0, 30).map((n) => (
                      <PrLink key={n} n={n} />
                    ))}
                    {l.prs.length > 30 && <span className="text-theme-xs text-muted">+{l.prs.length - 30}</span>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHead title={t("prs.byStage.title")} desc={t("prs.byStage.desc")} >
            {stage && (
              <button type="button" className="text-theme-xs text-brand-600 dark:text-brand-400" onClick={() => setStage(null)}>
                {t("prs.clearFilter")}
              </button>
            )}
          </CardHead>
          <div className="px-3 pb-2.5">{board && <StageChart prs={scope} dark={dark} onPick={(s) => setStage((x) => (x === s ? null : s))} />}</div>
        </Card>
      </div>

      <ConflictView prs={scope.filter((p) => p.stage === "code-conflict").sort((a, b) => a.number - b.number)} />

      <div className="grid grid-cols-1 gap-3 2xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="min-w-0">
          <CardHead title={t("prs.table.title")} desc={t("prs.table.desc")}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("prs.search")}
              className="h-9 w-full rounded-lg sm:w-56 border border-line bg-transparent px-3 text-theme-sm outline-none focus:border-brand-500"
            />
          </CardHead>
          <div className="px-3 pb-3 sm:px-3">
            <div className="no-scrollbar overflow-x-auto">
            <Seg
              className="min-w-max"
              label={t("prs.waitingOn")}
              value={view}
              onChange={setView}
              items={(
                [
                  ["all", t("prs.view.all")],
                  ["us", t("prs.view.us")],
                  ["local", t("prs.view.local")],
                  ...(noReviewer ? [] : [["reviewer", t("who.reviewer")] as [View, string]]),
                  ["ci", "CI / GitHub"],
                  ["wait", t("prs.view.wait")],
                  ["held", t("prs.view.held")],
                ] as [View, string][]
              ).map(([v, label]) => ({ v, label, n: count(VIEW_OF[v]), tone: v === "us" && count(VIEW_OF.us) ? "error" : "gray" }))}
            />
            </div>
            {stage && (
              <div className="mt-2 text-theme-xs text-muted">
                {t("prs.stageFilter")} <StageBadgeLabel s={stage} />
              </div>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-start">
              <thead>
                <tr className="text-start text-[11.5px] tracking-wider text-muted uppercase">
                  <th className="px-3 py-2 text-start font-medium">PR</th>
                  <th className="px-2 py-2 text-start font-medium">{t("prs.col.title")}</th>
                  <th className="px-2 py-2 text-start font-medium">{t("prs.col.stageWho")}</th>
                  <th className="px-2 py-2 text-start font-medium">CI</th>
                  <th className="px-2 py-2 text-start font-medium">GitHub</th>
                  <th className="px-3 py-2 text-start font-medium">{t("prs.col.updated")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p, i) => (
                  <Fragment key={p.number}>
                    {view === "local" && p.batch && p.batch.n !== rows[i - 1]?.batch?.n && (
                      <tr className="border-t border-line bg-strip/40">
                        <td colSpan={6} className="px-3 py-2 text-theme-xs font-semibold text-brand-600 dark:text-brand-400">
                          {p.batch.track === "owner" ? t("prs.batchOwner") : t("prs.batchN", { n: p.batch.n })} · <span dir="ltr">{p.batch.name}</span>
                          <span className="ms-2 font-normal text-muted">{rows.filter((r) => r.batch?.n === p.batch?.n).length} PR</span>
                        </td>
                      </tr>
                    )}
                    <PrRow pr={p} open={openRow === p.number} toggle={() => setOpenRow((x) => (x === p.number ? null : p.number))} />
                  </Fragment>
                ))}
              </tbody>
            </table>
            {board && !rows.length && (
              <div className="p-3">
                <Empty icon="circle-check">{t("prs.empty")}</Empty>
              </div>
            )}
          </div>
        </Card>

        <div className="grid min-w-0 grid-cols-1 content-start gap-3">
          <Card>
            <CardHead title={t("prs.events.title")} desc={t("prs.events.desc")}>
              <CountBadge>{events.length}</CountBadge>
            </CardHead>
            <ol className="max-h-[520px] min-w-0 overflow-y-auto px-3 pb-3">
              {!events.length && <li className="text-theme-sm text-muted">{t("prs.events.none")}</li>}
              {events.slice(0, 120).map((e, i) => {
                const ev = EVENT_TEXT[e.k];
                if (!ev) return null;
                return (
                  <li key={`${e.t}-${i}`} className="toast-in flex min-w-0 gap-2 border-s border-line ps-3 pb-2.5 relative">
                    <span className={`absolute -start-[7px] top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-line bg-card ${TONE_TEXT[ev.tone]}`}>
                      <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-theme-xs">
                        <span className={`font-semibold ${TONE_TEXT[ev.tone]}`}>{eventLabel(t, e.k, { branch })}</span>
                        {e.n && <PrLink n={e.n} />}
                        {e.sha && (
                          <span className="mono text-muted" dir="ltr">
                            {e.sha}
                          </span>
                        )}
                        <span className="ms-auto text-muted">
                          <RelTime at={e.t} />
                        </span>
                      </div>
                      {(e.title || e.msg) && (
                        <div className="mt-0.5 truncate text-[12px] text-gray-600 dark:text-gray-300" dir="ltr" title={e.title || e.msg}>
                          {e.title || e.msg}
                        </div>
                      )}
                      {(e.failed?.length || e.files?.length) ? (
                        <div className="mono mt-0.5 truncate text-[11px] text-error-500" dir="ltr">
                          {(e.failed ?? e.files ?? []).join(" · ")}
                        </div>
                      ) : null}
                      {e.by && <div className="text-[11px] text-muted" dir="ltr">by {e.by}</div>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </Card>

          <Card>
            <CardHead title={t("prs.chart.merged14")} desc={t("prs.merged.desc", { n: board?.merged.length ?? 0 })} />
            <div className="px-3">{board && <MergedChart perDay={board.perDay} dark={dark} />}</div>
            <ul className="grid grid-cols-1 gap-2 px-3 pt-2 pb-3">
              {(board?.merged ?? []).slice(0, 12).map((m) => (
                <li key={m.number} className="flex items-center gap-2 text-[12px]">
                  <PrLink n={m.number} url={m.url} />
                  <span className="min-w-0 flex-1 truncate" dir="ltr" title={m.title}>
                    {m.title}
                  </span>
                  <span className="shrink-0 text-muted">
                    <RelTime at={ms(m.at)} />
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          {board?.holds && Object.keys(board.holds).length > 0 && (
            <Card>
              <CardHead title={t("prs.held.title")} desc={t("prs.held.desc")} />
              <ul className="grid grid-cols-1 gap-1.5 px-3 pb-3">
                {Object.entries(board.holds).map(([n, why]) => (
                  <li key={n} className="flex items-center gap-2 text-[12px]">
                    <PrLink n={Number(n)} />
                    <span className="text-muted" dir="ltr">
                      {why}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {board?.rl && (
            <p className="px-2 text-[11px] text-muted" dir="ltr">
              GitHub GraphQL: {board.rl.remaining} points left · {board.measuring ? "measuring conflicts…" : "conflicts measured"}
            </p>
          )}
        </div>
      </div>
    </>
  );
}

function StageBadgeLabel({ s }: { s: string }) {
  const t = useT();
  const st = STAGES.find((x) => x.s === s);
  return <span className={TONE_TEXT[st?.tone ?? "gray"]}>{st ? stageLabel(t, st.s) : s}</span>;
}
