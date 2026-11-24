"use client";
// One job as a row of a list; a click opens its details in place: the steps (from GitHub, every 10 s while it runs)
// and the log (the runner's live log while it runs on this machine, GitHub's log once it completed).
import React, { useEffect, useRef, useState } from "react";
import { ANSI, Job, Step, allRunners, cut, fmtDate, repoShort, shortSha, stKey } from "@/lib/ci/model";
import { Icon } from "@/components/inbox/IconSprite";
import { Dur } from "./Tick";
import { Pill, StatusIcon, Who } from "./bits";
import { useCi } from "./CiContext";

export const prLabel = (j: Job) => (j.pr ? `PR #${j.pr}${j.prTitle ? ` ${cut(j.prTitle, 60)}` : ""}` : "");

/** trigger, actor, PR author: the owners of a run. */
export function Owners({ j }: { j: Job }) {
  const tr = j.trigger || j.actor;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2">
      <Who p={tr} tag="triggered by" />
      {j.actor && j.trigger && j.actor.login !== j.trigger.login && <Who p={j.actor} tag="actor" />}
      {j.prAuthor && (!tr || j.prAuthor.login !== tr.login) && (
        <span className="text-muted">
          PR by <Who p={j.prAuthor} tag="PR author" />
        </span>
      )}
    </span>
  );
}

function Steps({ steps }: { steps: Step[] }) {
  if (!steps.length) return <p className="text-theme-xs text-muted">No steps reported yet.</p>;
  return (
    <ol className="flex flex-col gap-1.5">
      {steps.map((s, i) => (
        <li key={`${i}:${s.name}`} className="flex items-center gap-2 text-theme-xs text-gray-700 dark:text-gray-300">
          <StatusIcon kind={s.status === "completed" ? s.conclusion || "neutral" : s.status} className="h-3.5 w-3.5" />
          <span className="min-w-0 flex-1 truncate" title={s.name}>
            {s.name}
          </span>
          <span className="text-muted">
            <Dur from={s.startedAt} to={s.completedAt} />
          </span>
        </li>
      ))}
    </ol>
  );
}

function LogView({ j, mine, runnerContainer }: { j: Job; mine: boolean; runnerContainer?: string }) {
  const ref = useRef<HTMLPreElement>(null);
  const [text, setText] = useState("");
  const mode = j.status === "completed" ? "final" : runnerContainer ? "tail" : "remote";
  useEffect(() => {
    let off = false;
    let es: EventSource | null = null;
    let t: ReturnType<typeof setTimeout> | null = null;
    if (mode === "remote") {
      setText("This job runs on another machine: its log comes from GitHub after the job completes.");
    } else if (mode === "final") {
      setText("Fetching the job log from GitHub...");
      let tries = 0;
      const url = mine ? `/api/ci/real/jobs/${j.id}/log` : `/api/ci/org/jobs/${j.id}/log`;
      const get = () =>
        fetch(url)
          .then(async (r) => {
            if (off) return;
            if (r.ok) return setText((await r.text()).replace(ANSI, ""));
            if (++tries < 15) t = setTimeout(get, 4000);
            else setText(await r.text());
          })
          .catch(() => {
            if (!off && ++tries < 15) t = setTimeout(get, 4000);
          });
      get();
    } else {
      setText("");
      es = new EventSource(`/api/ci/real/tail/${encodeURIComponent(runnerContainer!)}`);
      es.onmessage = (e) => {
        const el = ref.current;
        const stick = !el || el.scrollTop + el.clientHeight >= el.scrollHeight - 20;
        setText((p) => (p + String(JSON.parse(e.data)).replace(ANSI, "") + "\n").slice(-200000));
        if (stick) requestAnimationFrame(() => el && (el.scrollTop = el.scrollHeight));
      };
    }
    return () => {
      off = true;
      es?.close();
      if (t) clearTimeout(t);
    };
  }, [j.id, mode, mine, runnerContainer]);
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center justify-between gap-2 text-theme-xs text-muted">
        <span>Log</span>
        <span className="truncate">{mode === "tail" ? "runner log (live, docker logs -f) · steps on open and when the job changes" : "GitHub job log"}</span>
      </div>
      <pre ref={ref} dir="ltr" className="mono m-0 max-h-[60vh] overflow-auto rounded-xl border border-line bg-strip p-3 text-[12px] leading-5 whitespace-pre-wrap text-gray-800 dark:text-gray-200">
        {text}
      </pre>
    </div>
  );
}

/** The opened row: its steps are fetched once on open (and again, at most every 3 s, when the socket reports a change of this job
 *  while it is not completed); the log is the runner's live tail or GitHub's final log. */
export function JobDetail({ j }: { j: Job }) {
  const { state, onJobs } = useCi();
  const [steps, setSteps] = useState<Step[] | null>(null);
  const id = j.id;
  useEffect(() => {
    let off = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const get = () =>
      fetch(`/api/ci/real/jobs/${id}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => !off && d && setSteps(d.steps || []))
        .catch(() => {});
    get();
    const unsub = onJobs((rows) => {
      if (timer || !rows.some((r) => r.id === id && r.status !== "completed")) return;
      timer = setTimeout(() => {
        timer = null;
        get();
      }, 3000);
    });
    return () => {
      off = true;
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, [id, onJobs]);
  const runner = allRunners(state).find((r) => r.runnerName === j.runner);
  const mine = !!(j.mine || runner);
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
      <div className="min-w-0">
        <div className="mb-2 flex items-center justify-between text-theme-xs text-muted">
          <span>Steps</span>
          {j.url && (
            <a href={j.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-gray-700 underline-offset-2 hover:underline dark:text-gray-200">
              GitHub <Icon name="external" className="s14" />
            </a>
          )}
        </div>
        {steps ? <Steps steps={steps} /> : <p className="text-theme-xs text-muted">Loading...</p>}
      </div>
      <LogView j={j} mine={mine} runnerContainer={runner?.container} />
    </div>
  );
}

export function JobRow({ j, org, ghost, extra }: { j: Job; org?: boolean; ghost?: boolean; extra?: React.ReactNode }) {
  const { state } = useCi();
  const [open, setOpen] = useState(false);
  const k = stKey(j);
  const queued = k === "queued" || k === "pending" || k === "waiting";
  const note = j.local && j.status !== "completed";
  return (
    <li className={`border-t border-line first:border-t-0 ${ghost ? "opacity-70" : ""}`}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && (e.preventDefault(), setOpen((v) => !v))}
        className="flex cursor-pointer items-start gap-2 px-3 py-1.5 transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.02]"
      >
        <span className="mt-0.5">
          <StatusIcon kind={k} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-theme-sm font-semibold text-gray-900 dark:text-white">
            {j.workflow} · {j.job}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-theme-xs text-muted">
            <span>{repoShort(j.repo)}</span>
            {j.pr ? <span title={j.prTitle || ""}>{prLabel(j)}</span> : null}
            {j.branch && <span className="mono max-w-60 truncate">{j.branch}</span>}
            <code className="mono">{shortSha(j.sha)}</code>
            <span className={queued ? "" : "font-semibold text-gray-700 dark:text-gray-300"}>{j.runner || (queued ? "waiting for a runner" : "")}</span>
            {org && j.event && <Pill>{j.event}</Pill>}
            {j.gone && <Pill title="GitHub no longer knows this job">gone</Pill>}
            {allRunners(state).some((r) => r.runnerName === j.runner) && <Pill>our machines</Pill>}
          </div>
          <div className="mt-0.5 text-theme-xs text-muted">
            <Owners j={j} />
          </div>
          {extra && <div className="mt-1 text-theme-xs">{extra}</div>}
          {note && (
            <div className="mt-0.5 text-theme-xs" style={{ color: "var(--st-run)" }}>
              finished on the runner · GitHub confirming
            </div>
          )}
        </div>
        <div className="shrink-0 text-end text-theme-xs text-muted">
          {queued ? (
            <b className="font-semibold" style={{ color: "var(--st-you)" }}>
              <Dur from={j.createdAt} pre="waiting" />
            </b>
          ) : (
            <>
              <div>{fmtDate(j.startedAt)}</div>
              <Dur from={j.startedAt} to={j.completedAt || j.local?.at} />
            </>
          )}
        </div>
        <Icon name="chevron-down" className={`s16 mt-0.5 shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </div>
      {open && (
        <div className="border-t border-line bg-page/50 px-3 py-2 dark:bg-white/[0.015]">
          <JobDetail j={j} />
        </div>
      )}
    </li>
  );
}
