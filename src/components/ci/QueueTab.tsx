"use client";
// «Queue»: the jobs waiting for a runner now (oldest first, 50 a page), the runners grouped by the label sets the queued
// jobs ask for (idle / busy / maybe offline), and the "ghost" orphans listed apart (queued for 6 h+ while their run
// already finished: GitHub never hands them out, so they are not counted as waiting). The numbers come from the server's
// aggregates and runner list over the socket; the job rows are fetched on demand and patched from the socket.
import { useConfig } from "@/context/ConfigContext";
import React, { useMemo, useState } from "react";
import { Job, QSTAT, QueueOptions, RunnerEntry, isGhost, needsSelfHosted, people } from "@/lib/ci/model";
import { Card, CardHead, Empty } from "@/components/inbox/bits";
import { Icon } from "@/components/inbox/IconSprite";
import { useCi } from "./CiContext";
import { Dot, FilterSelect, Hourglass, MoreBar, NewBar, Pill } from "./bits";
import { Dur, useNow } from "./Tick";
import { JobRow } from "./JobRow";
import { useCiList } from "./useCiList";

type Grp = { idle: RunnerEntry[]; busy: RunnerEntry[]; off: RunnerEntry[] };
const labelKey = (j: Job) => (j.status === "waiting" ? "waiting" : j.labels && j.labels.length ? j.labels.join(", ") : "-");
const isQueued = (j: Job) => QSTAT.has(j.status) && !j.local;

function Summary({ g }: { g: Grp }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 text-theme-xs text-muted">
      <span className="inline-flex items-center gap-1">
        <Dot hue="run" />
        {g.busy.length} busy
      </span>
      <span className="inline-flex items-center gap-1">
        <Dot hue="ok" />
        {g.idle.length} idle
      </span>
      <span className="inline-flex items-center gap-1">
        <Dot hue="off" />
        {g.off.length} maybe offline
      </span>
    </span>
  );
}
function PillGrid({ g }: { g: Grp }) {
  const prefix = useConfig().ui.runnerPrefix;
  const items: [RunnerEntry, "idle" | "busy" | "off"][] = [...g.idle.map((r) => [r, "idle"] as const), ...g.busy.map((r) => [r, "busy"] as const), ...g.off.map((r) => [r, "off"] as const)].map((x) => [x[0], x[1]]);
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {items.map(([r, k]) => (
        <span key={r.name} title={`${r.name} · ${k === "off" ? "maybe offline" : k}`} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-0.5 text-theme-xs text-gray-700 dark:text-gray-300">
          <Dot hue={k === "idle" ? "ok" : k === "busy" ? "run" : "off"} />
          <span className="mono">{prefix && r.name.startsWith(prefix) ? r.name.slice(prefix.length) : r.name}</span>
          {r.mine && <span className="text-muted">our machines</span>}
        </span>
      ))}
    </div>
  );
}
const Chips = ({ ls }: { ls: string[] }) => (
  <span className="inline-flex flex-wrap gap-1">
    {ls.map((l) => (
      <Pill key={l}>{l}</Pill>
    ))}
  </span>
);

/** The orphans, fetched only once the card is opened. */
function GhostList() {
  const keep = (j: Job) => isQueued(j) && isGhost(j);
  const L = useCiList({ path: "/api/ci/queue/jobs", params: { ghosts: "1" }, dir: "asc", member: keep, stay: keep });
  return (
    <>
      <NewBar n={L.newCount} onShow={L.showNew} />
      {L.rows.length ? (
        <ul className="border-t border-line">
          {L.rows.map((j) => (
            <JobRow key={j.id} j={j} ghost />
          ))}
        </ul>
      ) : (
        <Hourglass label="Reading the orphans" />
      )}
      <MoreBar shown={L.rows.length} total={L.total} busy={L.more} capped={L.capped} hasMore={!!L.next} onMore={L.loadMore} />
    </>
  );
}

export default function QueueTab() {
  const { agg, runners } = useCi();
  const now = useNow();
  const [f, setF] = useState({ repo: "", person: "", labels: "" });
  const [openSet, setOpenSet] = useState<Set<string>>(new Set());
  const [ghostOpen, setGhostOpen] = useState(false);
  const params = useMemo(() => Object.fromEntries(Object.entries({ repo: f.repo, person: f.person, label: f.labels }).filter(([, v]) => v)), [f]);
  const keep = (j: Job) => isQueued(j) && !isGhost(j);
  const L = useCiList<QueueOptions>({
    path: "/api/ci/queue/jobs",
    params,
    dir: "asc",
    member: (j) => keep(j) && (!f.repo || j.repo === f.repo) && (!f.person || people(j).includes(f.person)) && (!f.labels || labelKey(j) === f.labels),
    stay: keep,
  });

  const groups = (ls: string[]): Grp => {
    const g: Grp = { idle: [], busy: [], off: [] };
    for (const r of (runners || []).filter((x) => ls.every((l) => x.labels.includes(l)))) {
      const busy = !!r.busy;
      const off = !busy && !r.mine && (!r.lastSeen || now - Date.parse(r.lastSeen) > 3600000);
      g[busy ? "busy" : off ? "off" : "idle"].push(r);
    }
    return g;
  };
  const toggle = (k: string) =>
    setOpenSet((p) => {
      const n = new Set(p);
      if (!n.delete(k)) n.add(k);
      return n;
    });

  const waitingFor = (j: Job) => {
    if (j.status === "waiting") return <span style={{ color: "var(--st-you)" }}>waiting for environment approval / concurrency</span>;
    const ls = (j.labels || []).map((l) => l.toLowerCase());
    if (!ls.length) return <span className="text-muted">labels unknown</span>;
    if (!needsSelfHosted(ls)) return <><Chips ls={ls} /> <span className="text-muted">GitHub-hosted runner (no local runner needed)</span></>;
    const g = groups(ls);
    const n = g.idle.length + g.busy.length + g.off.length;
    if (runners && !n) return <><Chips ls={ls} /> <span className="text-error-600 dark:text-error-400">no known runner has these labels</span></>;
    const key = ls.join(", ");
    return (
      <>
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          <Chips ls={ls} />
          <span className="text-muted">· {n} runners</span>
          <Summary g={g} />
          <button type="button" aria-expanded={openSet.has(key)} aria-label="Show the runners" onClick={(e) => (e.stopPropagation(), toggle(key))} className="rounded p-0.5 text-gray-500 hover:bg-strip">
            <Icon name="chevron-down" className={`s14 transition-transform ${openSet.has(key) ? "rotate-180" : ""}`} />
          </button>
        </span>
        {openSet.has(key) && <PillGrid g={g} />}
      </>
    );
  };

  const o = L.options || { repos: [], people: [], labels: [] };
  const waiting = agg?.queued ?? 0;
  const per = agg?.per ?? {};
  const sets = agg?.sets ?? [];
  const ghosts = agg?.ghosts ?? 0;

  return (
    <>
      <Card className="mb-3">
        <CardHead title="Waiting for a runner now" desc="Every queued job of every repo, oldest first">
          <Pill>{waiting}</Pill>
        </CardHead>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 pb-3 text-theme-sm text-gray-700 dark:text-gray-300">
          {!agg ? (
            <span className="text-muted">Loading...</span>
          ) : waiting ? (
            <>
              <span>
                Queued: <b className="tnum">{waiting}</b>
              </span>
              {Object.entries(per).map(([k, n]) => (
                <span key={k} className="inline-flex items-center gap-1.5">
                  <Pill>{k}</Pill>
                  <span className="tnum">{n}</span>
                </span>
              ))}
              {agg.oldest && (
                <span>
                  Oldest wait: <b style={{ color: "var(--st-you)" }}><Dur from={agg.oldest} /></b>
                </span>
              )}
            </>
          ) : (
            <span className="text-muted">Nothing is waiting.</span>
          )}
        </div>
      </Card>

      {sets.length > 0 && runners && (
        <Card className="mb-3">
          <CardHead title="Runners by label" desc="Who can take the queued jobs, by the labels they ask for" />
          <div className="divide-y divide-line border-t border-line">
            {sets.map((ls) => {
              const g = groups(ls);
              return (
                <div key={ls.join(", ")} className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Chips ls={ls} />
                    <span className="text-theme-xs text-muted">· {g.idle.length + g.busy.length + g.off.length} runners</span>
                    <Summary g={g} />
                  </div>
                  <PillGrid g={g} />
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <div className="mb-2.5 flex flex-wrap gap-2">
        <FilterSelect label="Repository" value={f.repo} onChange={(v) => setF({ ...f, repo: v })} first="All repos" options={o.repos.map((r) => [r, r])} />
        <FilterSelect label="Person" value={f.person} onChange={(v) => setF({ ...f, person: v })} first="All people" options={o.people.map((r) => [r, r])} />
        <FilterSelect label="Labels" value={f.labels} onChange={(v) => setF({ ...f, labels: v })} first="All label sets" options={o.labels.map((r) => [r, r])} />
      </div>

      <Card>
        <NewBar n={L.newCount} onShow={L.showNew} />
        {L.rows.length ? (
          <ul>
            {L.rows.map((j) => (
              <JobRow key={j.id} j={j} extra={waitingFor(j)} />
            ))}
          </ul>
        ) : L.loading ? (
          <Hourglass label="Reading the queue" />
        ) : (
          <Empty icon="check-check">{L.total || waiting ? "No jobs match." : "Nothing is waiting."}</Empty>
        )}
        <MoreBar shown={L.rows.length} total={L.total} busy={L.more} capped={L.capped} hasMore={!!L.next} onMore={L.loadMore} />
      </Card>

      {ghosts > 0 && (
        <Card className="mt-3">
          <CardHead title="Orphans" desc="Queued for 6 h or more while their run already finished: GitHub never hands these out, so they are not counted as waiting.">
            <button type="button" onClick={() => setGhostOpen((v) => !v)} className="text-theme-xs font-medium text-gray-700 underline-offset-4 hover:underline dark:text-gray-200">
              {ghostOpen ? "Hide" : `Show (${ghosts})`}
            </button>
          </CardHead>
          {ghostOpen && <GhostList />}
        </Card>
      )}
    </>
  );
}
