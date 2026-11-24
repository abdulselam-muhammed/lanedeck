"use client";
// «Our machines»: the org runners of every machine of ours - this PC (WSL) and the remote ones linked over ssh
// (server/ci/machines.json) - one group per machine (busy / idle / unknown, from the runner's own log), and the jobs
// they ran, newest first.
import { useConfig } from "@/context/ConfigContext";
import React, { useMemo } from "react";
import { Job, LocalRunner, MachineState, allRunners, cut, repoShort } from "@/lib/ci/model";
import { Card, CardHead, Empty } from "@/components/inbox/bits";
import { useCi } from "./CiContext";
import { Callout, Dot, Hourglass, MoreBar, NewBar, Pill } from "./bits";
import { Dur } from "./Tick";
import { JobRow, Owners } from "./JobRow";
import { fmtDate } from "@/lib/ci/model";
import { useCiList } from "./useCiList";

function RunnerCard({ r }: { r: LocalRunner }) {
  const s = r.busyState || (r.busy ? "busy" : "idle");
  const rec = r.job?.id ? (r.job as unknown as Job) : undefined; // the card's job already carries its owners and PR
  // docker's own word wins when the container is not "Up" (e.g. "Restarting (1) 5 seconds ago"): shown as it is, not guessed
  const down = r.docker && !/^Up\b/i.test(r.docker) ? r.docker : "";
  const label = down ? down.replace(/\s*\(.*$/, "") : s === "busy" ? "Busy" : s === "unknown" ? "Busy (job unknown)" : "Idle";
  return (
    <div className={`rounded-xl border border-line p-3 ${s === "idle" ? "ci-card-idle" : "ci-card-busy"}`}>
      <div className="flex items-center gap-2">
        <span className={`ci-ring ${s !== "idle" ? "on ci-glow-amber" : "ci-glow-teal"}`}><Dot hue={s === "idle" ? "ok" : "run"} /></span>
        <b className="min-w-0 truncate text-theme-sm text-gray-900 dark:text-white" title={r.runnerName}>
          {r.runnerName}
        </b>
        <span className="ms-auto text-theme-xs font-medium" style={s === "idle" ? undefined : { color: "var(--st-run)" }}>
          <span className={down ? "text-error-600 dark:text-error-400" : s === "idle" ? "text-muted" : ""} title={down || undefined}>{label}</span>
          {r.busy && r.since && (
            <>
              {" "}
              <Dur from={r.since} />
            </>
          )}
        </span>
      </div>
      <div className="mt-3 min-h-10 text-theme-xs text-gray-700 dark:text-gray-300">
        {r.job ? (
          <>
            <div className="truncate font-medium" title={r.job.name}>
              {r.job.workflow ? `${r.job.workflow} · ` : ""}
              {r.job.name}
              {r.job.repo && <span className="ms-1 font-normal text-muted">{repoShort(r.job.repo)}</span>}
            </div>
            {rec && (rec.trigger || rec.actor) ? (
              <div className="mt-1 text-muted">
                <Owners j={rec} />
                {rec.pr ? <span className="ms-2">PR #{rec.pr}{rec.prTitle ? ` ${cut(rec.prTitle, 40)}` : ""}</span> : null}
              </div>
            ) : (
              <div className="mt-1 text-muted">linking to the GitHub job...</div>
            )}
          </>
        ) : r.lastDone ? (
          <div className="text-muted">
            Last: {r.lastDone.name} · {r.lastDone.result} · {fmtDate(r.lastDone.at)}
          </div>
        ) : (
          <div className="text-muted">Nothing seen yet.</div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line pt-3 text-theme-xs text-muted">
        <span className="mono">{r.cpu || "-"}</span>
        <span className="mono">{r.mem || "-"}</span>
        <span>
          uptime <Dur from={r.startedAt} />
        </span>
        <span className="ms-auto">{r.source === "log" ? "from the runner log" : "from GitHub"}</span>
      </div>
      {r.log && !r.log.ok && r.log.error && <div className="mt-2 text-theme-xs text-error-600 dark:text-error-400">{r.log.error}</div>}
    </div>
  );
}

/** Docker in WSL did not answer: show this machine's known runners from what GitHub says they run (the server's runner list). */
function KnownRunners({ names, compact = false }: { names: string[]; compact?: boolean }) {
  const { runners } = useCi();
  // A retired name (re-registered under a new one, or removed from GitHub) stays known for the job history but is not
  // shown as a runner of this machine: only names GitHub still lists (once its list has loaded).
  const rows = useMemo(() => names
    .filter((n) => !runners || runners.some((x) => x.name === n))
    .map((n) => {
      const r = (runners || []).find((x) => x.name === n);
      const now = r?.busy ? r.job : null;
      return { n, busy: !!r?.busy, now, last: r?.last };
    }), [names, runners]);
  return (
    <>
      <p className="mb-3 text-theme-xs text-muted">Docker in WSL is not answering, so these come from GitHub (runner name on each job). Live log tail returns when WSL answers.</p>
      <div className={compact ? "grid gap-3" : "grid gap-3 md:grid-cols-2 2xl:grid-cols-3"}>
        {rows.map(({ n, busy, now, last }) => {
          const x = now || last;
          return (
            <div key={n} className="min-w-0 overflow-hidden rounded-xl border border-line p-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${busy ? "bg-warning-500 animate-pulse" : "bg-success-500"}`} />
                <b className="truncate text-theme-sm text-gray-800 dark:text-white/90">{n}</b>
                <span className="ms-auto shrink-0 text-theme-xs text-muted">{busy ? "Busy" : "Idle (as far as seen)"}</span>
              </div>
              {x && (
                <div className="mt-2 truncate text-theme-xs text-muted" title={`${x.workflow || ""} · ${x.job || ""}`}>
                  {busy ? "running" : "last"}: {x.workflow} · {x.job}{x.pr ? ` · PR #${x.pr}` : ""}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/** One machine of ours: its label, its own status line (reachable / stale / error) and its runner cards. */
function MachineGroup({ m, local, compact = false }: { m: MachineState; local: boolean; compact?: boolean }) {
  const { machine } = useConfig();
  const distro = machine.wslDistro ?? "the WSL distro";
  const label = m.label || (local ? machine.localLabel : m.id || "machine");
  const busy = m.runners.filter((r) => r.busy).length;
  return (
    <section className={compact ? "min-w-0" : "mt-3 first:mt-0"} aria-label={label}>
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-theme-sm font-semibold text-gray-800 dark:text-white/90">{label}</h3>
        {m.checkedAt && m.runners.length > 0 && <Pill>{busy} of {m.runners.length} busy</Pill>}
        <span className="ms-auto text-theme-xs text-muted">{local ? "docker in WSL" : "docker over ssh"}</span>
      </div>
      {m.stale && <Callout>{m.stale}</Callout>}
      {m.error && <Callout tone="error">{m.error}</Callout>}
      {!m.checkedAt ? (
        <Hourglass label={`Reading ${label}`} />
      ) : local && !m.installed ? (
        <p className="text-theme-sm text-muted">Not installed yet (WSL distro {distro} not found). The owner installs them; this panel only watches.</p>
      ) : local && !m.running ? (
        <p className="text-theme-sm text-muted">{distro} exists but is not running. It is never started from here.</p>
      ) : !m.runners.length && local && m.known?.length ? (
        <KnownRunners names={m.known} compact={compact} />
      ) : !m.runners.length ? (
        m.error ? null : <p className="text-theme-sm text-muted">No runner containers found.</p>
      ) : (
        <div className={compact ? "grid gap-3" : "grid gap-3 md:grid-cols-2 2xl:grid-cols-3"}>
          {m.runners.map((r) => (
            <RunnerCard key={r.container} r={r} />
          ))}
        </div>
      )}
    </section>
  );
}

/** Machines with at most one runner sit side by side in one row; a machine with several runners gets its own block
 *  below them (2026-11-13, Abdulselam). */
function MachineGroups({ machines }: { machines: { m: MachineState; local: boolean }[] }) {
  const single = machines.filter(({ m }) => (m.runners?.length || 0) <= 1);
  const multi = machines.filter(({ m }) => (m.runners?.length || 0) > 1);
  return (
    <>
      {single.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {single.map(({ m, local }) => (
            <MachineGroup key={local ? "local" : m.id} m={m} local={local} compact />
          ))}
        </div>
      )}
      {multi.map(({ m, local }) => (
        <div key={local ? "local" : m.id} className={single.length ? "mt-3" : ""}>
          <MachineGroup m={m} local={local} />
        </div>
      ))}
    </>
  );
}

export function RunnersCard() {
  const { state } = useCi();
  const all = allRunners(state);
  const busy = all.filter((r) => r.busy).length;
  const desc = !state || !state.checkedAt ? "Loading..." : all.length ? `${busy} of ${all.length} busy · ${state.repoCount || 0} repos watched · read-only` : "Org runners on our machines";
  return (
    <Card className="mb-3">
      <CardHead title="Org runners on our machines" desc={desc} />
      <div className="px-3 pb-3">
        {!state ? (
          <Hourglass label="Reading our machines" />
        ) : (
          <MachineGroups machines={[{ m: state, local: true }, ...(state.machines || []).map((m) => ({ m, local: false }))]} />
        )}
      </div>
    </Card>
  );
}

export default function MineTab() {
  const { github } = useConfig();
  const { state } = useCi();
  const names = useMemo(() => new Set([...allRunners(state).map((r) => r.runnerName), ...(state?.known || []), ...(state?.machines || []).flatMap((m) => m.known || [])]), [state]);
  const L = useCiList({ path: "/api/ci/real", params: {}, dir: "desc", member: (j) => !!(j.mine || (j.runner && names.has(j.runner))) });
  return (
    <>
      <RunnersCard />
      <Card>
        <CardHead title="Jobs run by our machines" desc={`All ${github.org ?? "org"} repos · newest first · click a job for its steps and log`}>
          <Pill>{L.total}</Pill>
        </CardHead>
        <NewBar n={L.newCount} onShow={L.showNew} />
        {L.rows.length ? (
          <ul className="border-t border-line">
            {L.rows.map((j) => (
              <JobRow key={j.id} j={j} />
            ))}
          </ul>
        ) : L.loading ? (
          <Hourglass label="Reading the jobs of our machines" />
        ) : L.error ? (
          <Empty icon="activity">Could not read the jobs ({L.error}).</Empty>
        ) : (
          <Empty icon="activity">{state && state.installed === false ? "Not installed yet." : "No jobs yet."}</Empty>
        )}
        <MoreBar shown={L.rows.length} total={L.total} busy={L.more} capped={L.capped} hasMore={!!L.next} onMore={L.loadMore} />
      </Card>
    </>
  );
}
