"use client";
// «Whole org»: the self-hosted runners seen in the last 24 h (from the socket's runner list), then every job queued /
// running / finished in that window (all repos, any runner), one page of 50 at a time. Filters and paging are done by the
// server (/api/ci/org); the socket patches rows in place and offers "N new - show" for the ones that arrive.
import React, { useMemo, useState } from "react";
import { Group, OrgOptions, RunnerEntry, people, repoShort, stGroup } from "@/lib/ci/model";
import { Card, CardHead, Empty } from "@/components/inbox/bits";
import { useCi } from "./CiContext";
import { Dot, FilterSelect, Hourglass, MoreBar, NewBar, Pill } from "./bits";
import { JobRow, Owners, prLabel } from "./JobRow";
import { useCiList } from "./useCiList";
import { fmtDate } from "@/lib/ci/model";

type F = { repo: string; runner: string; person: string; status: "" | Group };

function RunnerChip({ r }: { r: RunnerEntry }) {
  const s = r.busyState || (r.busy ? "busy" : "idle");
  const label = s === "busy" ? "Busy" : s === "unknown" ? "Busy (job unknown)" : r.mine ? "Idle" : "Idle (as far as seen)";
  const rj = r.job || null;
  return (
    <div className={`min-w-0 rounded-xl border p-3 ${r.mine ? "border-gray-300 dark:border-gray-600" : "border-line"}`}>
      <div className="flex items-center gap-2">
        <Dot hue={s === "idle" ? "ok" : "run"} pulse={s !== "idle"} />
        <b className="min-w-0 truncate text-theme-sm text-gray-900 dark:text-white" title={r.name}>
          {r.name}
        </b>
        {r.mine && <Pill>our machines</Pill>}
      </div>
      <div className="mt-1 text-theme-xs text-muted">
        {label} · {r.jobs} jobs / 24h
      </div>
      <div className="mt-1 min-h-8 text-theme-xs text-gray-700 dark:text-gray-300">
        {rj ? (
          <>
            <div className="truncate" title={`${rj.workflow} · ${rj.job}`}>
              {rj.workflow} · {rj.job} <span className="text-muted">{repoShort(rj.repo)}</span>
            </div>
            {(rj.trigger || rj.actor) && (
              <div className="text-muted">
                <Owners j={rj} />
                {rj.pr ? <span className="ms-2">{prLabel(rj)}</span> : null}
              </div>
            )}
          </>
        ) : r.jobName ? (
          <div className="truncate">{r.jobName}</div>
        ) : r.busy ? (
          <span className="text-muted">linking to the GitHub job...</span>
        ) : (
          <span className="text-muted">{fmtDate(r.lastSeen)}</span>
        )}
      </div>
    </div>
  );
}

export default function OrgTab() {
  const { runners } = useCi();
  const [f, setF] = useState<F>({ repo: "", runner: "", person: "", status: "" });
  const params = useMemo(() => Object.fromEntries((["repo", "runner", "person", "status"] as const).filter((k) => f[k]).map((k) => [k, f[k]])), [f]);
  const L = useCiList<OrgOptions>({
    path: "/api/ci/org",
    params,
    dir: "desc",
    member: (j) => (!f.repo || j.repo === f.repo) && (!f.runner || j.runner === f.runner) && (!f.person || people(j).includes(f.person)) && (!f.status || stGroup(j) === f.status),
  });
  const o = L.options || { repos: [], runners: [], people: [] };
  const set = (k: keyof F) => (v: string) => setF((p) => ({ ...p, [k]: v }));
  return (
    <>
      <Card className="mb-3">
        <CardHead title="Active runners" desc="Self-hosted runners only. Idle or offline runners of other machines are invisible here: seeing them needs org-admin access. Only runners that ran a job in the last 24 h appear." />
        <div className="grid gap-2 px-3 pb-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {runners && runners.length ? runners.map((r) => <RunnerChip key={r.name} r={r} />) : <span className="text-theme-sm text-muted">{runners ? "No runner seen in the last 24 h." : "Loading..."}</span>}
        </div>
      </Card>

      <div className="mb-2.5 flex flex-wrap gap-2">
        <FilterSelect label="Repository" value={f.repo} onChange={set("repo")} first="All repos" options={o.repos.map((r) => [r, r])} />
        <FilterSelect label="Runner" value={f.runner} onChange={set("runner")} first="All runners" options={o.runners.map((r) => [r, r])} />
        <FilterSelect label="Person" value={f.person} onChange={set("person")} first="All people" options={o.people.map((r) => [r, r])} />
        <FilterSelect
          label="Status"
          value={f.status}
          onChange={set("status")}
          first="All statuses"
          options={[
            ["running", "running"],
            ["queued", "queued"],
            ["ok", "success"],
            ["fail", "failed"],
            ["other", "cancelled / skipped"],
          ]}
        />
      </div>

      <Card>
        <CardHead title="Every job of the last 24 h" desc="Queued, running or finished · all repos, any runner · click a job for its steps and log">
          <Pill>
            {L.rows.length}/{L.total}
          </Pill>
        </CardHead>
        <NewBar n={L.newCount} onShow={L.showNew} />
        {L.rows.length ? (
          <ul className="border-t border-line">
            {L.rows.map((j) => (
              <JobRow key={j.id} j={j} org />
            ))}
          </ul>
        ) : L.loading ? (
          <Hourglass label="Reading the whole org" />
        ) : L.error ? (
          <Empty icon="search">Could not read the jobs ({L.error}).</Empty>
        ) : (
          <Empty icon="search">No jobs match.</Empty>
        )}
        <MoreBar shown={L.rows.length} total={L.total} busy={L.more} capped={L.capped} hasMore={!!L.next} onMore={L.loadMore} />
      </Card>
    </>
  );
}
