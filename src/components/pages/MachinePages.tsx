"use client";
// Machine level (not tied to a project): the machine overview at "/" and the devices pages (/devices, /devices/<id>).
// Data: /api/load (this PC), /api/load?machine=<id> (SSH devices), the shared ci.runners summary, /api/agents (every project), /api/machine (per-project counters).
import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardHead, Empty, KpiStrip, PageHeader } from "@/components/inbox/bits";
import { useInbox } from "@/components/inbox/InboxContext";
import { useConfig, useT } from "@/context/ConfigContext";
import { useLoad, type RemoteLoad } from "@/components/load/LoadContext";
import { DeviceLoad } from "@/components/load/LoadView";
import { useAllAgents } from "@/components/pages/AgentsPage";

type Summary = { id: string; name: string; questions: number; files: number; behind: number | null; branch: string };
type MachineInfo = { projects: Summary[]; github: { used: number; limit: number; denied: number } };

function useMachineInfo() {
  const [info, setInfo] = useState<MachineInfo | null>(null);
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (!document.hidden) {
        try { const r = await fetch("/api/machine", { cache: "no-store" }); if (!stop && r.ok) setInfo(await r.json()); } catch { /* retry */ }
      }
      if (!stop) timer = setTimeout(tick, 10000);
    };
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, []);
  return info;
}

/** Reachability of every SSH device (the server samples a remote only while someone polls it). */
function useRemotes(ids: string[]) {
  const key = ids.join(",");
  const [state, setState] = useState<Record<string, RemoteLoad | null>>({});
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const list = key ? key.split(",") : [];
    const tick = async () => {
      if (!document.hidden) {
        const rs = await Promise.all(list.map(async (id) => {
          try { const r = await fetch(`/api/load?machine=${encodeURIComponent(id)}`, { cache: "no-store" }); return [id, r.ok ? ((await r.json()) as RemoteLoad) : null] as const; } catch { return [id, null] as const; }
        }));
        if (!stop) setState(Object.fromEntries(rs));
      }
      if (!stop) timer = setTimeout(tick, 8000);
    };
    if (list.length) tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [key]);
  return state;
}

const pct = (v: number | undefined) => (v == null ? "—" : `${Math.round(v)}%`);

function Meter({ label, value, limit }: { label: string; value?: number; limit?: number }) {
  const hot = value != null && limit != null && value >= limit;
  return (
    <div className="grid gap-1">
      <div className="flex items-baseline justify-between text-theme-xs text-muted"><span>{label}</span><b className={`mono ${hot ? "text-error-600 dark:text-error-400" : "text-gray-800 dark:text-white/90"}`}>{pct(value)}</b></div>
      <div className="h-1.5 overflow-hidden rounded-full bg-strip"><div className={`h-full rounded-full ${hot ? "bg-error-500" : "bg-brand-500"}`} style={{ width: `${Math.min(100, value ?? 0)}%` }} /></div>
    </div>
  );
}

/* ------------------------------------------------------------------ "/" */
export function MachineOverview() {
  const cfg = useConfig();
  const t = useT();
  const { data: load } = useLoad();
  const { ci, updatedAt } = useInbox();
  const { data: agents } = useAllAgents();
  const info = useMachineInfo();
  const remotes = useRemotes(load?.machines?.map((m) => m.id) ?? []);
  const cur = load?.current;
  const th = load?.thresholds;
  const remoteList = load?.machines ?? [];
  const online = 1 + remoteList.filter((m) => remotes[m.id]?.reachable).length;
  const active = useMemo(() => (agents?.agents ?? []).filter((a) => a.state === "run" || a.state === "wait"), [agents]);
  const byProject = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of active) m.set(a.project, (m.get(a.project) ?? 0) + 1);
    return m;
  }, [active]);
  const names = new Map(cfg.projects.map((p) => [p.id, p.name]));
  const questions = info ? info.projects.reduce((n, p) => n + p.questions, 0) : null;
  const hot = !!(cur && th && (cur.ram >= th.ram || cur.cpu >= th.cpu || cur.disk >= th.disk));
  void updatedAt;

  return (
    <>
      <PageHeader title={t("pages.machine.title")} desc={t("pages.machine.desc")}>
        {info && (
          <span className="text-theme-xs text-muted" title="GitHub requests this hour / budget">
            GitHub <span className="mono" dir="ltr">{info.github.used}/{info.github.limit}</span>
          </span>
        )}
      </PageHeader>
      <KpiStrip
        cols="grid-cols-2 md:grid-cols-3 xl:grid-cols-5"
        items={[
          { key: "load", label: t("pages.machine.load"), value: cur ? pct(cur.ram) : "—", sub: cur ? t("pages.machine.loadSub", { cpu: pct(cur.cpu), disk: pct(cur.disk) }) : t("pages.machine.reading"), see: t("pages.machine.details"), icon: "gauge", tone: hot ? "error" : "success", hot, href: "/load" },
          { key: "dev", label: t("pages.machine.devices"), value: `${online}/${1 + remoteList.length}`, sub: remoteList.length ? t("pages.machine.devicesSubSsh") : t("pages.machine.devicesSubLocal"), see: t("pages.machine.devicesSee"), icon: "monitor", tone: "gray", href: "/devices" },
          { key: "run", label: t("pages.machine.runners"), value: !ci ? "—" : `${ci.busy}/${ci.total}`, sub: !ci ? t("pages.machine.reading") : t("pages.machine.runnersSub", { n: ci.queued }), see: t("pages.machine.details"), icon: "terminal", tone: ci && ci.queued >= 20 ? "warning" : "brand", hot: !!ci && ci.busy > 0, href: "/ci" },
          { key: "ag", label: t("pages.machine.agents"), value: agents ? active.length : "—", sub: byProject.size ? [...byProject].map(([p, n]) => `${names.get(p) ?? p} ${n}`).join(" · ") + " ·" : t("pages.machine.noActivity"), see: t("pages.machine.allAgents"), icon: "bot", tone: "run", hot: active.length > 0, href: "/agents" },
          { key: "q", label: t("pages.machine.questions"), value: questions ?? "—", sub: t("pages.machine.questionsSub"), see: t("pages.machine.byProject"), icon: "help", tone: "gray", hot: !!questions },
        ]}
      />
      <div className="grid gap-3 xl:grid-cols-3 [&>*]:min-w-0">
        <Card className="xl:col-span-2">
          <CardHead title={t("pages.machine.projects")} desc={t("pages.machine.projectsDesc")} />
          <ul className="divide-y divide-line border-t border-line">
            {cfg.projects.map((p) => {
              const s = info?.projects.find((x) => x.id === p.id);
              return (
                <li key={p.id}>
                  <Link href={`/p/${p.id}`} className="flex flex-wrap items-center gap-2 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-white/[0.02]">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-strip text-theme-sm font-semibold">{p.name.slice(0, 1).toUpperCase()}</span>
                    <span className="grid min-w-0 flex-1">
                      <b className="truncate text-theme-sm font-medium text-gray-900 dark:text-white">{p.name}</b>
                      <span className="mono truncate text-theme-xs text-muted" dir="ltr">{p.repo ?? p.id}</span>
                    </span>
                    <span className="text-theme-xs text-muted">agents <b className="mono text-gray-800 dark:text-white/90">{byProject.get(p.id) ?? 0}</b></span>
                    <span className="text-theme-xs text-muted">{t("pages.machine.qShort")} <b className="mono text-gray-800 dark:text-white/90">{s ? s.questions : "—"}</b></span>
                    <span className="text-theme-xs text-muted"><span dir="ltr" className="mono">{p.defaultBranch}</span> {s?.behind == null ? "" : s.behind ? t("pages.machine.behind", { n: s.behind }) : "✓"}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card>
          <CardHead title={t("pages.machine.thisMachine")} desc={cfg.machine.localLabel} />
          <div className="grid gap-2 border-t border-line px-3 py-2">
            <Meter label="RAM" value={cur?.ram} limit={th?.ram} />
            <Meter label="CPU" value={cur?.cpu} limit={th?.cpu} />
            <Meter label="DISK" value={cur?.disk} limit={th?.disk} />
            {!cur && <Empty icon="gauge">{t("pages.machine.reading")}</Empty>}
          </div>
        </Card>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ /devices */
function DeviceCard({ id, label, kind }: { id: string; label: string; kind: "local" | "ssh" }) {
  const t = useT();
  const { data: local } = useLoad();
  const [remote, setRemote] = useState<RemoteLoad | null>(null);
  useEffect(() => {
    if (kind === "local") return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (!document.hidden) { try { const r = await fetch(`/api/load?machine=${encodeURIComponent(id)}`, { cache: "no-store" }); if (!stop && r.ok) setRemote(await r.json()); } catch { /* offline */ } }
      if (!stop) timer = setTimeout(tick, 8000);
    };
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [id, kind]);
  const cur = kind === "local" ? local?.current : remote?.current;
  const th = kind === "local" ? local?.thresholds : remote?.thresholds;
  const up = kind === "local" ? !!local?.ready : !!remote?.reachable;
  const containers = kind === "local" ? local?.docker?.containers.length : remote?.containers?.length;
  return (
    <Link href={`/devices/${encodeURIComponent(id)}`} className="panel-smoke block rounded-xl border border-line/70 bg-card p-3 shadow-theme-xs transition hover:border-gray-400 dark:hover:border-gray-600">
      <div className="mb-3 flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${up ? "bg-success-500" : "bg-gray-400"}`} />
        <b className="min-w-0 flex-1 truncate text-theme-sm font-semibold text-gray-900 dark:text-white">{label}</b>
        <span className="rounded-full bg-strip px-2 py-0.5 text-theme-xs text-muted">{kind === "local" ? "local" : "ssh"}</span>
      </div>
      <div className="grid gap-2.5">
        <Meter label="RAM" value={cur?.ram} limit={th?.ram} />
        <Meter label="CPU" value={cur?.cpu} limit={th?.cpu} />
        <Meter label="DISK" value={cur?.disk} limit={th?.disk} />
      </div>
      <p className="mt-3 text-theme-xs text-muted">{up ? `containers ${containers ?? "—"}` : kind === "ssh" ? t("pages.machine.notConnected") : t("pages.machine.reading")}</p>
    </Link>
  );
}

export function DevicesPage() {
  const cfg = useConfig();
  const t = useT();
  const { data: load } = useLoad();
  const machines = load?.machines ?? [];
  return (
    <>
      <PageHeader crumbs={[{ label: t("pages.machine.crumb") }]} title={t("pages.machine.devicesTitle")} desc={t("pages.machine.devicesDesc")}>
        <Link href="/settings" className="text-theme-sm font-medium text-gray-700 underline-offset-4 hover:underline dark:text-gray-200">{t("pages.machine.manageDevices")}</Link>
      </PageHeader>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <DeviceCard id="local" label={cfg.machine.localLabel} kind="local" />
        {machines.map((m) => <DeviceCard key={m.id} id={m.id} label={m.label} kind="ssh" />)}
      </div>
    </>
  );
}

export function DevicePage({ id }: { id: string }) {
  const t = useT();
  return (
    <>
      <div className="mb-3 text-theme-sm"><Link href="/devices" className="font-medium text-gray-700 underline-offset-4 hover:underline dark:text-gray-200">{t("pages.machine.backDevices")}</Link></div>
      <DeviceLoad machine={id} />
    </>
  );
}
