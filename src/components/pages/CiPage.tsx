"use client";
// /ci (Runners): the local CI runners panel.
// Read-only. Three tabs: Our machines (the org runners on this PC and on the machines linked over ssh, and the jobs they ran), Whole org
// (every job of the last 24 h) and Queue (what waits for a runner). English only, always left-to-right
// inside the RTL app. Data: ONE WebSocket (/api/ci/ws) carries the server-computed numbers and the live changes;
// the job lists are fetched a page at a time by the tabs (/api/ci/*, server/ci/http.mjs). Nothing here polls.
import React, { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { EChartsCoreOption } from "echarts/core";
import "@/app/ci.css";
import { Kpi, KpiStrip, PageHeader, Seg } from "@/components/inbox/bits";
import { CiProvider, useCi } from "@/components/ci/CiContext";
import { Dur } from "@/components/ci/Tick";
import { Callout, Hourglass } from "@/components/ci/bits";
import MineTab from "@/components/ci/MineTab";
import OrgTab from "@/components/ci/OrgTab";
import QueueTab from "@/components/ci/QueueTab";
import { Card, CardHead } from "@/components/inbox/bits";
import { lsRead } from "@/lib/storage";
import type { QdPoint } from "@/lib/ci/model";

const EChart = dynamic(() => import("@/components/charts/EChart"), { ssr: false });

const AXIS = "#8fb3c9";
function Spark({ data, labels, color, name }: { data: number[]; labels: string[]; color: string; name: string }) {
  const option: EChartsCoreOption = {
    animation: false,
    grid: { left: 8, right: 8, top: 12, bottom: 22 },
    tooltip: { trigger: "axis", confine: true, backgroundColor: "#0a1a2f", borderColor: "rgba(56,189,248,0.4)", textStyle: { color: "#e2f3ff", fontSize: 12 } },
    xAxis: { type: "category", data: labels, boundaryGap: false, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: AXIS, fontSize: 10, interval: Math.max(0, Math.floor(labels.length / 6) - 1) } },
    yAxis: { type: "value", show: false, min: 0 },
    series: [{ name, type: "line", data, smooth: true, showSymbol: false, lineStyle: { color, width: 2, shadowColor: color, shadowBlur: 8 }, areaStyle: { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: color + "66" }, { offset: 1, color: color + "00" }] } } }],
  };
  return <EChart option={option} height={150} label={name} />;
}

type Tab = "mine" | "org" | "queue";
const TAB_KEY = "laneDeck.ci.tab";
const hhmm = (t: number) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

function Kpis({ go }: { go: (t: Tab) => void }) {
  const { agg } = useCi();
  // The numbers are the server's: the three runner tiles use the same rule as "Runners by label" (Queue tab) over every
  // self-hosted runner of the org: busy = a job in progress on it (or this machine's runner log says so), maybe offline =
  // not busy and not seen for 1 h (never ours), idle = the rest.
  const ready = !!agg;
  const off = agg?.off ?? 0;
  const items: Kpi[] = [
    { key: "busy", label: "Runners busy", value: ready ? agg.busy : "-", sub: ready ? `of ${agg.total} · ours ${agg.oursBusy}/${agg.oursTotal} busy` : "reading...", icon: "bot", tone: "run", onClick: () => go("queue") },
    { key: "idle", label: "Runners idle", value: ready ? agg.idle : "-", sub: "ready for a job", icon: "circle-check", tone: "success", onClick: () => go("queue") },
    { key: "off", label: "Maybe offline", value: ready ? off : "-", sub: "no job seen for 1 h+", icon: "alert", tone: off ? "error" : "gray", onClick: () => go("queue") },
    { key: "queued", label: "Jobs queued", value: ready ? agg.queued : "-", sub: "waiting for a runner", icon: "hourglass", tone: "warning", onClick: () => go("queue") },
    { key: "oldest", label: "Oldest wait", value: agg?.oldest ? <Dur from={agg.oldest} /> : "-", sub: agg?.oldest ? "first queued job" : "nothing waiting", icon: "clock", tone: "warning", onClick: () => go("queue") },
    { key: "day", label: "Jobs, last 24 h", value: ready ? agg.jobs24 : "-", sub: "whole org", icon: "activity", tone: "gray", onClick: () => go("org") },
  ];
  return <KpiStrip items={items} cols="grid-cols-2 md:grid-cols-3 xl:grid-cols-6" />;
}

/** The queue-depth series on a regular 5-minute grid (the LAST sample of each slot, gaps carried forward; at most
 *  288 points for 24 h), and its right end is the live count - the same number as the Queue tab and the KPI tile. */
function depthSeries(qd: QdPoint[], live: number | null) {
  const SLOT = 300e3;
  const by = new Map<number, number>();
  for (const [t, n] of qd) {
    const k = Math.floor(t / SLOT);
    by.set(k, n); // samples arrive in time order: the last one in the slot wins
  }
  const keys = [...by.keys()].sort((a, b) => a - b);
  if (!keys.length) return { data: [] as number[], labels: [] as string[] };
  const data: number[] = [];
  const labels: string[] = [];
  let prev = 0;
  for (let k = keys[0]; k <= keys[keys.length - 1]; k++) {
    prev = by.get(k) ?? prev;
    data.push(prev);
    labels.push(hhmm(k * SLOT));
  }
  if (live != null) {
    data.push(live);
    labels.push("now");
  }
  return { data, labels };
}

function Charts() {
  const { agg, qd } = useCi();
  const hours = useMemo(() => {
    if (!agg) return null;
    const H = 3600e3;
    return { bins: agg.bins, labels: agg.bins.map((_, i) => hhmm(agg.binsEnd - (23 - i) * H)) };
  }, [agg]);
  // Queue depth: the server samples every 30 s and keeps 24 h; the socket sends the history once, then each new sample.
  const depth = useMemo(() => (qd ? depthSeries(qd, agg ? agg.queued : null) : null), [qd, agg]);
  return (
    <div className="mb-3 grid gap-3 lg:grid-cols-2">
      <Card>
        <CardHead title="Jobs per hour" desc="Started in the last 24 h, whole org" />
        <div className="px-3 pb-2.5">
          {hours ? <Spark data={hours.bins} labels={hours.labels} color="#22d3ee" name="jobs per hour" /> : <Hourglass label="Reading the last 24 h" />}
        </div>
      </Card>
      <Card>
        <CardHead title="Queue depth" desc="Sampled every 30 s by the server, last 24 h (5-minute slots, the peak of each)" />
        <div className="px-3 pb-2.5">
          {depth && depth.data.length > 1 ? (
            <Spark data={depth.data} labels={depth.labels} color="#fbbf24" name="queued jobs" />
          ) : (
            <Hourglass label={depth ? "Collecting the first samples" : "Loading"} />
          )}
        </div>
      </Card>
    </div>
  );
}

function Footer() {
  const { meta } = useCi();
  if (!meta) return null;
  const rq = meta.requests;
  return (
    <p className="mt-3 text-theme-xs text-muted">
      {meta.rate != null && (
        <>
          API rate limit left: <b className="tnum">{meta.rate}</b>
          {meta.rateLimit ? `/${meta.rateLimit}` : ""} ·{" "}
        </>
      )}
      <span className="tnum">{rq.lastHour}</span> requests in the last hour · <b className={`tnum ${rq.countedPerHour > rq.budget ? "text-error-600 dark:text-error-400" : ""}`}>{rq.counted}</b> billed (non-304) · pace ≈
      <span className="tnum">{rq.countedPerHour}</span>/h, budget {rq.budget} · level {meta.pace}
      {meta.paused && <span className="text-error-600 dark:text-error-400"> · GitHub paused (rate limit)</span>} · {meta.repoCount} repos
    </p>
  );
}

function Live() {
  const { live, updatedAt } = useCi();
  const time = updatedAt ? new Date(updatedAt).toLocaleTimeString("en-GB") : "-";
  return (
    <span className="inline-flex items-center gap-2 text-theme-xs text-muted" title="WebSocket /api/ci/ws">
      <span className={`h-2 w-2 rounded-full ${live ? "bg-success-500 breathe" : "bg-error-500"}`} />
      {live ? "live" : "reconnecting"} · <span className="tnum">{time}</span>
    </span>
  );
}

function Inner() {
  // null until the remembered tab is read, so a tab that is not the open one never fetches its list
  const [tab, setTab] = useState<Tab | null>(null);
  const { meta, agg } = useCi();
  useEffect(() => {
    try {
      const t = lsRead(TAB_KEY);
      setTab(t === "org" || t === "queue" ? t : "mine");
    } catch {
      setTab("mine"); // private mode
    }
  }, []);
  const go = (t: Tab) => {
    setTab(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* private mode */
    }
  };
  return (
    <div dir="ltr" lang="en" className="ci-room text-start">
      <PageHeader crumbs={[{ label: "Monitoring" }]} title="Runners" desc="The org's GitHub Actions runners on our machines and the jobs of every repo of the org. Read-only.">
        <Live />
      </PageHeader>
      {meta?.paused && <Callout tone="error">GitHub is paused because of the rate limit; the data is the last reading.</Callout>}
      <Kpis go={go} />
      <Charts />
      <Seg<Tab>
        label="Runners views"
        value={tab ?? "mine"}
        onChange={go}
        className="mb-3 max-w-md"
        items={[
          { v: "mine", label: "Our machines" },
          { v: "org", label: "Whole org" },
          { v: "queue", label: "Queue", n: agg?.queued ?? 0 },
        ]}
      />
      {tab === "mine" && <MineTab />}
      {tab === "org" && <OrgTab />}
      {tab === "queue" && <QueueTab />}
      <Footer />
    </div>
  );
}

export default function CiPage() {
  return (
    <CiProvider>
      <Inner />
    </CiProvider>
  );
}
