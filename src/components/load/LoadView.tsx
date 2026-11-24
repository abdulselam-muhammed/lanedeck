"use client";
// "Machine load": live gauges, the last ~30 min, the processes grouped, docker in WSL, the CI runner. Read-only.
import { useConfig, useT, type TFn } from "@/context/ConfigContext";
import React from "react";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardHead, Empty, PageHeader } from "@/components/inbox/bits";
import { etaText } from "./LoadBanner";
import { LoadData, MachineRef, RemoteContainer, RemoteProc, useLoad, useRemoteLoad } from "./LoadContext";

const fmtGB = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`);
const fmtAge = (t: TFn, s: number | null | undefined) => {
  if (s == null) return "—";
  if (s < 90) return t("load.sec", { n: Math.round(s) });
  if (s < 5400) return t("load.min", { n: Math.round(s / 60) });
  if (s < 172800) return t("load.hour", { n: (s / 3600).toFixed(1) });
  return t("load.day", { n: Math.round(s / 86400) });
};

function Gauge({ label, value, limit, sub }: { label: string; value: number; limit: number; sub?: string }) {
  const t = useT();
  const hot = value >= limit;
  const r = 44, c = 2 * Math.PI * r;
  return (
    <div className="grid justify-items-center gap-1 px-3 py-2">
      <svg viewBox="0 0 110 110" className="h-28 w-28" role="img" aria-label={`${label} ${value}%`}>
        <circle cx="55" cy="55" r={r} fill="none" strokeWidth="10" className="stroke-gray-200 dark:stroke-white/10" />
        <circle cx="55" cy="55" r={r} fill="none" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(c * Math.min(100, value)) / 100} ${c}`}
          transform="rotate(-90 55 55)" className={hot ? "stroke-error-500" : value >= limit - 15 ? "stroke-warning-500" : "stroke-brand-500"} />
        <text x="55" y="62" textAnchor="middle" className="mono fill-gray-900 text-[18px] font-semibold dark:fill-white">{value}%</text>
      </svg>
      <p className="text-theme-sm font-semibold text-gray-900 dark:text-white">{label}</p>
      <p dir="ltr" className="text-end mono text-theme-xs text-muted">{sub ?? t("load.alertAt", { n: limit })}</p>
    </div>
  );
}

function History({ d }: { d: LoadData }) {
  const t = useT();
  const h = d.history ?? [];
  if (h.length < 2) return <p className="px-3 pb-3 text-theme-sm text-muted">{t("load.collecting")}</p>;
  const W = 600, H = 140;
  const t0 = h[0][0], span = Math.max(1, h[h.length - 1][0] - t0);
  // RTL page, but time in a chart reads left to right: wrap in dir=ltr.
  const line = (i: number) => h.map((p) => `${(((p[0] - t0) / span) * W).toFixed(1)},${(H - (Math.min(100, p[i]) / 100) * H).toFixed(1)}`).join(" ");
  const series: [string, number, string][] = [["CPU", 1, "stroke-brand-500"], ["RAM", 2, "stroke-error-500"], ["Disk", 3, "stroke-warning-500"]];
  return (
    <div className="px-3 pb-3">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-40 w-full" role="img" aria-label={t("load.last30aria")}>
        {[25, 50, 75, 100].map((g) => <line key={g} x1="0" x2={W} y1={H - (g / 100) * H} y2={H - (g / 100) * H} className="stroke-gray-200 dark:stroke-white/10" strokeDasharray="3 4" />)}
        {series.map(([n, i, cls]) => <polyline key={n} points={line(i)} fill="none" strokeWidth="2" vectorEffect="non-scaling-stroke" className={cls} />)}
      </svg>
      <div className="mt-2 flex flex-wrap gap-3 text-theme-xs text-muted">
        {series.map(([n, , cls]) => (
          <span key={n} className="inline-flex items-center gap-1.5"><svg width="14" height="4" aria-hidden="true"><line x1="0" x2="14" y1="2" y2="2" strokeWidth="3" className={cls} /></svg>{n}</span>
        ))}
        <span>{t("load.spanCount", { m: Math.round(span / 60000), n: h.length })}</span>
      </div>
    </div>
  );
}

/** Per-feature "not available on <platform>" states: shown instead of a blank or broken section. */
function PlatformNote({ d }: { d: LoadData }) {
  const notes = [d.features?.note, d.status?.sampler.reason && d.status.sampler.reason !== "starting" ? d.status.sampler.reason : null, d.status?.docker.reason && d.status.docker.reason !== "starting" ? `docker: ${d.status.docker.reason}` : null].filter(Boolean) as string[];
  if (!notes.length) return null;
  return (
    <div className="mb-3 rounded-lg border border-line px-3 py-2 text-theme-xs text-gray-600 dark:text-gray-300" dir="ltr">
      {notes.map((n) => <div key={n}>{n}</div>)}
    </div>
  );
}

function LocalView({ selector }: { selector: React.ReactNode }) {
  const t = useT();
  const { machine } = useConfig();
  const { data: d, error } = useLoad();
  if (!d) return (
    <>
      <PageHeader crumbs={[{ label: t("load.machine") }]} title={t("load.title")}>{selector}</PageHeader>
      <Card><Empty icon="gauge">{error ? t("load.unreachableApi") : t("load.readingLocal")}</Empty></Card>
    </>
  );
  if (!d.ready || !d.current) return (
    <>
      <PageHeader crumbs={[{ label: t("load.machine") }]} title={t("load.title")}>{selector}</PageHeader>
      <PlatformNote d={d} />
      <Card><Empty icon="gauge">{t("load.firstSample")}</Empty></Card>
    </>
  );
  const c = d.current, th = d.thresholds, a = d.alert!;
  const dk = d.docker;
  return (
    <>
      <PageHeader crumbs={[{ label: t("load.machine") }]} title={t("load.title")} desc={t("load.desc")}>
        {selector}
        <span className={`rounded-full px-3 py-1 text-theme-xs font-medium ${a.high ? "bg-error-50 text-error-600 dark:bg-error-500/15" : "bg-gray-100 text-gray-600 dark:bg-white/5 dark:text-gray-300"}`}>
          {a.high ? t("load.high") : t("load.normal")}
        </span>
      </PageHeader>

      <PlatformNote d={d} />
      <Card className="mb-3">
        <div className="grid grid-cols-1 divide-line sm:grid-cols-3 sm:divide-x sm:divide-x-reverse">
          <Gauge label="CPU" value={c.cpu} limit={th.cpu} sub={t("load.alertAt30", { n: th.cpu })} />
          <Gauge label="RAM" value={c.ram} limit={th.ram} sub={`${fmtGB(c.ramUsedMB)} / ${fmtGB(c.ramTotalMB)}`} />
          <Gauge label={t("load.diskActivity")} value={c.disk} limit={th.disk} sub={t("load.alertAt30", { n: th.disk })} />
        </div>
      </Card>

      {d.kernel && (() => {
        const k = d.kernel, lim = (th.pagedPoolGB ?? 4) * 1024, leak = k.pagedMB >= lim;
        return (
          <Card className="mb-3">
            <CardHead title={t("load.kernel.title")} desc={t("load.kernel.desc")} />
            <div className="grid gap-2 px-3 pb-3 text-theme-sm">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div><p className="text-theme-xs text-muted">Paged pool</p><p dir="ltr" className={`text-end mono text-lg font-semibold ${leak ? "text-error-600" : "text-gray-900 dark:text-white"}`}>{fmtGB(k.pagedMB)}</p></div>
                <div><p className="text-theme-xs text-muted">Nonpaged pool</p><p dir="ltr" className="text-end mono text-lg font-semibold text-gray-900 dark:text-white">{fmtGB(k.nonpagedMB)}</p></div>
                <div><p className="text-theme-xs text-muted">{t("load.kernel.procs")}</p><p dir="ltr" className="text-end mono text-lg font-semibold text-gray-900 dark:text-white">{fmtGB(k.procsWsMB)}</p></div>
                <div><p className="text-theme-xs text-muted">{t("load.kernel.uptime")}</p><p className="mono text-lg font-semibold text-gray-900 dark:text-white">{k.uptimeS < 86400 ? t("load.hours", { n: (k.uptimeS / 3600).toFixed(1) }) : t("load.days", { n: (k.uptimeS / 86400).toFixed(1) })}</p></div>
              </div>
              <p className={leak ? "font-medium text-error-600" : "text-theme-xs text-muted"}>
                {leak ? t("load.kernel.leak") : t("load.kernel.leakHint")}
              </p>
            </div>
          </Card>
        );
      })()}

      <Card className="mb-3">
        <CardHead title={t("load.cause.title")} desc={t("load.cause.desc")} />
        <div className="grid gap-2 px-3 pb-3 text-theme-sm">
          <p><b>{t("load.cause")}</b> {a.cause}</p>
          <p><b>{t("load.eta")}</b> {etaText(t, a.eta)}{t("load.etaBy", { why: a.eta.why })}</p>
          <p className="text-theme-xs text-muted">
            {t("load.basis", { e2e: Math.round((d.typical?.e2e ?? 480) / 60), tool: Math.round((d.typical?.tool ?? 240) / 60) })} {d.agents ? t("load.agentsWt", { n: d.agents.worktrees, a: d.agents.active }) : ""}
          </p>
        </div>
      </Card>

      <Card className="mb-3">
        <CardHead title={t("load.last30")} desc={t("load.last30desc")} />
        <History d={d} />
      </Card>

      <Card className="mb-3">
        <CardHead title={t("load.procs.title")} desc={t("load.procs.desc", { n: d.nodeCount ?? 0 })} />
        <div className="overflow-x-auto px-2 pb-2.5">
          <Table>
            <TableHeader>
              <TableRow>
                <TableCell isHeader className="px-3 py-2 text-start text-theme-xs text-muted">{t("load.col.group")}</TableCell>
                <TableCell isHeader className="px-3 py-2 text-start text-theme-xs text-muted">{t("load.col.count")}</TableCell>
                <TableCell isHeader className="px-3 py-2 text-start text-theme-xs text-muted">{t("load.col.mem")}</TableCell>
                <TableCell isHeader className="px-3 py-2 text-start text-theme-xs text-muted">CPU (cores)</TableCell>
                <TableCell isHeader className="px-3 py-2 text-start text-theme-xs text-muted">{t("load.col.tools")}</TableCell>
                <TableCell isHeader className="px-3 py-2 text-start text-theme-xs text-muted">{t("load.col.oldest")}</TableCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(d.groups ?? []).map((g) => (
                <TableRow key={g.key}>
                  <TableCell className="px-3 py-2 text-theme-sm"><span dir="ltr" className="mono">{g.label}</span></TableCell>
                  <TableCell className="px-3 py-2 text-theme-sm mono">{g.count}</TableCell>
                  <TableCell className="px-3 py-2 text-theme-sm mono">{fmtGB(g.memMB)}</TableCell>
                  <TableCell className="px-3 py-2 text-theme-sm mono">{g.cores.toFixed(2)}</TableCell>
                  <TableCell className="px-3 py-2 text-theme-xs text-muted"><span dir="ltr" className="mono">{g.tools.join(", ") || "—"}</span></TableCell>
                  <TableCell className="px-3 py-2 text-theme-sm">{fmtAge(t, g.ageS)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Card className="mb-3">
        <CardHead title={t("load.docker.title")} desc={dk?.ok ? (dk.stale ? t("load.docker.stale") : t("load.docker.every30")) : t("load.docker.none")} />
        <div className="grid gap-2 px-3 pb-3">
          {dk?.ok && machine.ciContainer && (
            <p className="text-theme-sm">
              <b>CI runner</b> (<span dir="ltr" className="mono">{machine.ciContainer}</span>):{" "}
              {!dk.ci.running ? t("load.runner.off") : dk.ci.job ? t("load.runner.job", { age: fmtAge(t, dk.ci.busyFor) }) : t("load.runner.idle")}
            </p>
          )}
          {dk?.ok && dk.containers.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableCell isHeader className="px-3 py-2 text-start text-theme-xs text-muted">container</TableCell>
                    <TableCell isHeader className="px-3 py-2 text-start text-theme-xs text-muted">compose project</TableCell>
                    <TableCell isHeader className="px-3 py-2 text-start text-theme-xs text-muted">{t("load.col.age")}</TableCell>
                    <TableCell isHeader className="px-3 py-2 text-start text-theme-xs text-muted">{t("load.col.type")}</TableCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dk.containers.map((x) => (
                    <TableRow key={x.name}>
                      <TableCell className="px-3 py-2 text-theme-sm"><span dir="ltr" className="mono break-all">{x.name}</span></TableCell>
                      <TableCell className="px-3 py-2 text-theme-sm"><span dir="ltr" className="mono">{x.project ?? "—"}</span></TableCell>
                      <TableCell className="px-3 py-2 text-theme-sm">{fmtAge(t, x.ageS)}</TableCell>
                      <TableCell className="px-3 py-2 text-theme-xs text-muted">{x.e2e ? t("load.type.e2e") : x.project === "runner" ? "runner" : t("load.type.other")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : dk?.ok ? <p className="text-theme-sm text-muted">{t("load.noContainers")}</p> : null}
        </div>
      </Card>
    </>
  );
}

const fmtTime = (lang: string, ts: number | null) => (ts ? new Date(ts).toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—");

function MachineSelect({ machines, value, onChange }: { machines: MachineRef[]; value: string; onChange: (id: string) => void }) {
  const t = useT();
  const items: MachineRef[] = [{ id: "local", label: t("load.me") }, ...machines];
  return (
    <div role="tablist" aria-label={t("load.machine")} className="inline-flex rounded-full border border-line bg-card p-0.5 text-theme-xs font-medium">
      {items.map((m) => (
        <button key={m.id} type="button" role="tab" aria-selected={value === m.id} onClick={() => onChange(m.id)}
          className={`rounded-full px-3 py-1 ${value === m.id ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900" : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5"}`}>
          <span dir={m.id === "local" ? undefined : "ltr"} className={m.id === "local" ? "" : "mono"}>{m.label}</span>
        </button>
      ))}
    </div>
  );
}

const th = "px-3 py-2 text-start text-theme-xs text-muted";
function RemoteView({ machine, selector }: { machine: string; selector: React.ReactNode }) {
  const t = useT();
  const lang = useConfig().ui.lang;
  const { data: d, error } = useRemoteLoad(machine);
  const head = (desc?: string) => <PageHeader crumbs={[{ label: t("load.machine") }]} title={t("load.title")} desc={desc}>{selector}</PageHeader>;
  if (!d || !d.ready || !d.current) {
    return (
      <>
        {head()}
        <Card>
          <Empty icon="gauge">
            {error ? t("load.unreachableApi") : d && !d.reachable && !d.ready ? t("load.remote.wait") : t("load.remote.reading")}
          </Empty>
        </Card>
      </>
    );
  }
  const c = d.current, lim = d.thresholds, a = d.alert!;
  const ci = d.ci;
  const procs = d.procs ?? [], cons = d.containers ?? [];
  const groups: [string, RemoteProc[]][] = [
    ["CI runner", procs.filter((p) => p.group === "ci")],
    ["Docker", procs.filter((p) => p.group === "docker")],
    [t("load.group.other"), procs.filter((p) => p.group === "other")],
  ];
  const cgroups: [string, RemoteContainer[]][] = [
    ["CI runner", cons.filter((x) => x.group === "runner")],
    ["CI job", cons.filter((x) => x.group === "job")],
    ["Docker compose", cons.filter((x) => x.group === "project")],
    [t("load.group.other"), cons.filter((x) => x.group === "other")],
  ];
  return (
    <>
      {head(t("load.remote.desc"))}
      {!d.reachable && (
        <div role="alert" className="mb-3 rounded-xl border border-line bg-error-50 px-3 py-1.5 text-theme-sm text-error-600 dark:bg-error-500/15">
          {t("load.remote.offline", { time: fmtTime(lang, d.lastSeen) })}
        </div>
      )}
      <Card className="mb-3">
        <div className="grid grid-cols-1 divide-line sm:grid-cols-3 sm:divide-x sm:divide-x-reverse">
          <Gauge label="CPU" value={c.cpu} limit={lim.cpu} sub={d.cpuKnown ? t("load.alertAt30", { n: lim.cpu }) : t("load.remote.waitSecond")} />
          <Gauge label="RAM" value={c.ram} limit={lim.ram} sub={`${fmtGB(c.ramUsedMB)} / ${fmtGB(c.ramTotalMB)}`} />
          <Gauge label={t("load.diskActivity")} value={c.disk} limit={lim.disk} sub={t("load.alertAt30", { n: lim.disk })} />
        </div>
        <div className="flex flex-wrap gap-x-8 gap-y-1 border-t border-line px-3 py-1.5 text-theme-sm">
          <span>{t("load.remote.root")} <b dir="ltr" className="mono">{d.root ? `${d.root.pct}% (${fmtGB(d.root.usedB / 1048576)} / ${fmtGB(d.root.totalB / 1048576)})` : "—"}</b></span>
          <span>load average: <b dir="ltr" className="mono">{d.load ? d.load.map((x) => x.toFixed(2)).join(" · ") : "—"}</b></span>
          <span className={a.high ? "text-error-600" : "text-muted"}>{a.high ? t("load.remote.highWhy", { why: a.reasons.join(" · ") }) : t("load.normal")}</span>
          <span className="text-muted">{t("load.remote.lastRead", { time: fmtTime(lang, d.lastSeen) })}</span>
        </div>
      </Card>

      <Card className="mb-3">
        <CardHead title="CI runner" desc={t("load.remote.ciDesc")} />
        <p className="px-3 pb-3 text-theme-sm">
          {!ci?.running ? t("load.remote.runnerOff") : ci.job ? t("load.runner.job", { age: fmtAge(t, ci.busyFor) }) : t("load.runner.idle")}
        </p>
      </Card>

      <Card className="mb-3">
        <CardHead title={t("load.last30")} desc={t("load.last30desc")} />
        <History d={d as unknown as LoadData} />
      </Card>

      <Card className="mb-3">
        <CardHead title={t("load.remote.topTitle")} desc={t("load.remote.topDesc")} />
        <div className="overflow-x-auto px-2 pb-2.5">
          <Table>
            <TableHeader>
              <TableRow>
                <TableCell isHeader className={th}>{t("load.col.group")}</TableCell>
                <TableCell isHeader className={th}>process</TableCell>
                <TableCell isHeader className={th}>pid</TableCell>
                <TableCell isHeader className={th}>CPU %</TableCell>
                <TableCell isHeader className={th}>MEM %</TableCell>
                <TableCell isHeader className={th}>{t("load.col.age")}</TableCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.flatMap(([label, list]) => list.map((p, i) => (
                <TableRow key={p.pid}>
                  <TableCell className="px-3 py-2 text-theme-xs text-muted">{i === 0 ? label : ""}</TableCell>
                  <TableCell className="px-3 py-2 text-theme-sm"><span dir="ltr" className="mono">{p.comm}</span></TableCell>
                  <TableCell className="px-3 py-2 text-theme-sm mono">{p.pid}</TableCell>
                  <TableCell className="px-3 py-2 text-theme-sm mono">{p.cpu.toFixed(1)}</TableCell>
                  <TableCell className="px-3 py-2 text-theme-sm mono">{p.mem.toFixed(1)}</TableCell>
                  <TableCell className="px-3 py-2 text-theme-sm">{fmtAge(t, p.ageS)}</TableCell>
                </TableRow>
              )))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Card className="mb-3">
        <CardHead title="Docker" desc={t("load.remote.dockerDesc")} />
        <div className="overflow-x-auto px-2 pb-2.5">
          {cons.length === 0 ? <p className="px-3 text-theme-sm text-muted">{t("load.noContainers")}</p> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableCell isHeader className={th}>{t("load.col.group")}</TableCell>
                  <TableCell isHeader className={th}>container</TableCell>
                  <TableCell isHeader className={th}>compose project</TableCell>
                  <TableCell isHeader className={th}>{t("load.col.state")}</TableCell>
                  <TableCell isHeader className={th}>{t("load.col.age")}</TableCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cgroups.flatMap(([label, list]) => list.map((x, i) => (
                  <TableRow key={x.name}>
                    <TableCell className="px-3 py-2 text-theme-xs text-muted">{i === 0 ? label : ""}</TableCell>
                    <TableCell className="px-3 py-2 text-theme-sm"><span dir="ltr" className="mono break-all">{x.name}</span></TableCell>
                    <TableCell className="px-3 py-2 text-theme-sm"><span dir="ltr" className="mono">{x.project ?? "—"}</span></TableCell>
                    <TableCell className="px-3 py-2 text-theme-xs text-muted"><span dir="ltr" className="mono">{x.status}</span></TableCell>
                    <TableCell className="px-3 py-2 text-theme-sm">{fmtAge(t, x.ageS)}</TableCell>
                  </TableRow>
                )))}
              </TableBody>
            </Table>
          )}
        </div>
      </Card>
    </>
  );
}

export default function LoadView() {
  const [machine, setMachine] = React.useState("local");
  const { data: local } = useLoad();
  const machines = local?.machines ?? [];
  const selector = machines.length ? <MachineSelect machines={machines} value={machine} onChange={setMachine} /> : null;
  return machine === "local" ? <LocalView selector={selector} /> : <RemoteView key={machine} machine={machine} selector={selector} />;
}

/** One device's load, docker and runner containers (the /devices/<id> page): "local" or an SSH machine id. */
export function DeviceLoad({ machine }: { machine: string }) {
  return machine === "local" ? <LocalView selector={null} /> : <RemoteView key={machine} machine={machine} selector={null} />;
}
