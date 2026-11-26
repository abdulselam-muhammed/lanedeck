"use client";
// The live box of a file/agent (moved from the old liveHtml): crumbs to the parent, the file bar,
// the agent card, its progress estimate and last actions, and its subagents.
import React, { useRef, useState } from "react";
import Link from "next/link";
import { Agent, byActivity, isReadme, Progress, titleOf, TreeNode, whenOf } from "@/lib/inbox/model";
import { RelTime } from "@/components/common/RelTime";
import { useInbox } from "./InboxContext";
import { Icon } from "./IconSprite";
import { Chip, CountBadge, Led, QPill } from "./bits";
import { useT } from "@/context/ConfigContext";

// ---------- progress ----------
// An ESTIMATE: the plan's finished steps (checked or committed) plus the live phase of the current step,
// read from the agent's latest tool calls; the server never lets it go back, and 100 waits for the hand-back.
const PROG_PHASES = ["orient", "tests", "impl", "green", "docs", "checks", "commit"];

function PhaseLine({ p }: { p: Progress }) {
  const t = useT();
  const ph = p.phase;
  if (!ph) return null;
  const verify = ph.id === "verify";
  return (
    <div className="prog-phase">
      <span className="k">{t("inbox.live.now")}</span>
      <span className="lbl">{ph.label}</span>
      {!verify && (
        <span className="of">
          · {t("inbox.live.phaseOf", { i: ph.index + 1, n: PROG_PHASES.length })}
        </span>
      )}
      <span className="prog-steps" aria-hidden="true">
        {PROG_PHASES.map((id, i) => (
          <i key={id} className={verify || i < ph.index ? "on" : i === ph.index ? "now" : ""} title={t("inbox.phase." + id)} />
        ))}
        {verify && <i className="now v" title={ph.label} />}
      </span>
    </div>
  );
}

export function ProgressCard({ n }: { n: TreeNode }) {
  const t = useT();
  const a = n.agent!,
    p = a.progress;
  const [open, setOpen] = useState(false);
  if (!p) return null;
  const blocked = n.file && n.file.status === "blocked" && a.state !== "run" && a.state !== "wait";
  const stopped = a.state === "stopped";
  const cls = blocked || stopped ? "blocked" : a.state === "run" || a.state === "wait" ? "run" : a.state === "idle" ? "idle" : "done";
  const plan = p.source === "plan" && p.total > 0;
  const solo = p.source === "phase"; // no plan: one step, estimated from its phases
  const finished = a.state === "done";
  const known = plan || solo || finished;
  const pct = finished ? 100 : p.pct;
  const exact = finished ? 100 : typeof p.pctExact === "number" ? p.pctExact : p.pct;
  const items = plan && Array.isArray(p.items) ? p.items : [];
  const cur = items.find((x) => !x.done);
  const valueText = known ? `${pct}%${stopped ? " — " + t("inbox.live.stopped") : p.phase && !finished ? ` — ${p.phase.label}` : ""}` : t("inbox.live.unknown");
  const how = t("inbox.live.how." + (plan ? "plan" : solo ? "phase" : "none"));
  return (
    <section className={`prog ${cls}`} aria-label={t("inbox.live.progLabel")}>
      <div className="prog-head">
        <Icon name="gauge" className="s14" />
        {t("inbox.live.progress")}
        <span className="prog-est" tabIndex={0} title={how} aria-label={`${t("inbox.live.estimate")}: ${how}`}>
          {solo ? t("inbox.live.estimateNoPlan") : t("inbox.live.estimate")}
        </span>
      </div>
      <div className="prog-body">
        <div className="prog-top">
          {plan || solo ? (
            <>
              <span className="prog-num">
                {pct}
                <small>%</small>
              </span>
              <span className="prog-count">{stopped ? t("inbox.live.stoppedEarly") : plan ? t("inbox.live.stepsOf", { done: p.done, total: p.total }) : finished ? t("inbox.live.done") : t("inbox.live.oneStep")}</span>
            </>
          ) : (
            <span className="prog-word">{stopped ? t("inbox.live.stopped") : finished ? t("inbox.live.done") : t("inbox.live.unknown")}</span>
          )}
        </div>
        <div
          className={`prog-track${known ? "" : " indet"}`}
          role="progressbar"
          aria-label={t("inbox.live.workProgress")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={known ? pct : undefined}
          aria-valuetext={valueText}
        >
          {/* the width transitions from the last drawn value (CSS transition on width) */}
          <div className="prog-fill" style={{ width: `${exact}%` }} />
        </div>
        {!finished && !stopped && <PhaseLine p={p} />}
        {!plan ? (
          solo || finished ? null : (
            <div className="prog-cur">
              <span className="t">{t("inbox.live.how.none")}</span>
            </div>
          )
        ) : cur ? (
          <div className="prog-cur">
            <span className="k">{t("inbox.live.curStep")}</span>
            <span className="t" title={cur.text}>
              {cur.text}
            </span>
          </div>
        ) : (
          <div className="prog-cur">
            <span className="k">{t("inbox.live.allDone")}</span>
          </div>
        )}
        {plan && (
          <>
            <button type="button" className="prog-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              <Icon name="list-checks" className="s14" />
              {t("inbox.live.allSteps")}
              <Icon name="chevron-down" className="s14" />
            </button>
            <ol className={`prog-items${open ? " open" : ""}`}>
              {items.map((x, i) => (
                <li key={i} className={x.done ? "ok" : x === cur ? "cur" : ""}>
                  <Icon name={x.done ? "circle-check" : "circle"} />
                  <span>{x.text}</span>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </section>
  );
}

// ---------- the agent's last actions (from the snapshot's `recent`: { tool, desc, at }, oldest first) ----------
const ACT_ICONS: [RegExp, string][] = [
  [/^(Bash|PowerShell|BashOutput|KillShell|Monitor)$/, "terminal"],
  [/^Read$/, "file-text"],
  [/^(Edit|MultiEdit|Write|NotebookEdit)$/, "pencil"],
  [/^(Grep|Glob|ToolSearch|WebSearch)$/, "search"],
  [/^(Agent|Task)$/, "bot"],
  [/^SendMessage$/, "message"],
  [/^WebFetch$/, "globe"],
  [/^SubagentHandback$/, "check-check"],
];
const actIcon = (tool: string) => ACT_ICONS.find(([re]) => re.test(tool))?.[1] ?? "wrench";
const actName = (tool: string) => (/^mcp__/.test(tool) ? tool.split("__").pop()! : tool); // an MCP tool: its own name
const ACT_STATE: Record<string, [string, string]> = {
  run: ["run", "inbox.state.run"],
  wait: ["wait", "inbox.state.wait"],
  done: ["done", "inbox.state.done"],
  idle: ["idle", "inbox.state.idle"],
  stopped: ["blocked", "inbox.state.blocked"],
};

export function Acts({ a }: { a: Agent }) {
  const t = useT();
  const last = useRef<Map<string, string>>(new Map()); // agent id -> its newest action, so only a new one animates in
  const rec = Array.isArray(a.recent) ? a.recent.filter((x) => x && typeof x.tool === "string") : [];
  if (!rec.length) return null;
  const shown = rec.slice(-3),
    newest = shown[shown.length - 1];
  const sig = newest.tool + "|" + newest.desc + "|" + newest.at;
  const fresh = last.current.has(a.id) && last.current.get(a.id) !== sig;
  last.current.set(a.id, sig);
  const [cls, label] = ACT_STATE[a.state] || ACT_STATE.done;
  return (
    <aside className={`acts ${cls}`} aria-label={t("inbox.live.actsLabel")}>
      <div className="acts-head">
        <Icon name="activity" className="s14" />
        {t("inbox.live.acts")}
        <span className="acts-state">
          <span className="dot" />
          {t(label)}
        </span>
      </div>
      <ol className="acts-list">
        {rec.length > 3 && (
          <li className="acts-more" title={t("inbox.live.moreActsTip")} aria-label={t("inbox.live.moreActs")}>
            <Icon name="more-v" />
          </li>
        )}
        {shown.map((x, i) => {
          const now = i === shown.length - 1;
          return (
            <li key={i + "|" + x.tool + "|" + x.at} className={`act${now ? " now" : ""}${now && fresh ? " enter" : ""}`} aria-current={now ? "step" : undefined}>
              <span className="ai">
                <Icon name={actIcon(x.tool)} />
              </span>
              <span className="tx">
                <b className="tn" title={x.tool}>
                  {actName(x.tool)}
                </b>
                {x.desc && (
                  <span className="d" dir="auto" title={x.desc}>
                    {x.desc}
                  </span>
                )}
              </span>
              {now ? (
                <span className="end">
                  {x.at ? <time><RelTime at={x.at} /></time> : null}
                  {a.state === "done" && <Icon name="check" />}
                </span>
              ) : x.at ? (
                <time><RelTime at={x.at} /></time>
              ) : null}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

export function SubCard({ n, hrefOf }: { n: TreeNode; hrefOf?: (n: TreeNode) => string | null }) {
  const { select } = useInbox();
  const a = n.agent;
  const line = a && a.step ? a.step : n.file ? n.file.statusText : "";
  const href = hrefOf?.(n) ?? null;
  const cls = "flex w-full items-center gap-2 border-b border-line px-3 py-1.5 text-start last:border-b-0 hover:bg-gray-50 dark:hover:bg-white/[0.03]";
  const body = (
    <>
      <Led n={n} />
      <span className="grid min-w-0 flex-1">
        <b dir="auto" className="truncate text-theme-sm font-medium text-gray-800 dark:text-white/90">
          {titleOf(n)}
        </b>
        <span dir="auto" title={line} className="truncate text-theme-xs text-gray-500 dark:text-gray-400">
          {line}
        </span>
      </span>
      <Chip n={n} />
      {n.file && n.file.questions.length > 0 && <QPill n={n.file.questions.length} />}
      <span className="whitespace-nowrap text-[11.5px] text-gray-500 tnum"><RelTime at={whenOf(n)} /></span>
    </>
  );
  return href ? (
    <Link href={href} className={cls}>{body}</Link>
  ) : (
    <button type="button" onClick={() => select(n.key)} className={cls}>{body}</button>
  );
}

/** A small titled block of the side column. */
function SideBlock({ title, icon, children, count }: { title: string; icon: string; children: React.ReactNode; count?: number }) {
  return (
    <section className="grid gap-2.5">
      <h3 className="flex items-center gap-2 text-[11px] font-semibold tracking-wider text-gray-500 uppercase dark:text-gray-400">
        <Icon name={icon} className="s14" />
        {title}
        {count !== undefined && <CountBadge>{count}</CountBadge>}
      </h3>
      {children}
    </section>
  );
}

/**
 * The agent column of /inbox/[file] (was the live box above the document): the progress estimate,
 * the agent's details (state, model, type, step, started, last activity, branch, id), its last actions,
 * and its subagents. A file with no live agent shows the file's own details.
 */
export default function AgentSide({ n, subHref }: { n: TreeNode; subHref?: (n: TreeNode) => string | null }) {
  const t = useT();
  const a = n.agent;
  const kids = [...n.children].sort(byActivity);
  const qn = n.file && !isReadme(n.file) ? n.file.questions.length : 0;
  const rows = (
    a
      ? [
          [t("inbox.live.status"), <Chip key="c" n={n} />, false],
          a.model ? ["model", a.model, true] : null,
          a.type && a.type !== "general-purpose" ? [t("inbox.live.type"), a.type, true] : null,
          a.branch ? [t("inbox.live.branch"), a.branch, true] : null,
          [t(a.state === "run" ? "inbox.live.runningSince" : "inbox.live.startedOrResumed"), <RelTime key="s" at={a.startedAt} />, false],
          [t("inbox.live.lastActivity"), <RelTime key="l" at={a.lastAt} />, false],
          [t("inbox.live.id"), a.id, true],
        ]
      : [
          [t("inbox.live.status"), n.file && !n.file.general ? <Chip key="c" n={n} /> : t("inbox.list.general"), false],
          n.file ? [t("inbox.live.file"), n.file.name, true] : null,
          n.file ? [t("inbox.live.lastUpdate"), <RelTime key="m" at={n.file.mtime} />, false] : null,
          qn ? [t("inbox.q.open"), <QPill key="q" n={qn} />, false] : null,
        ]
  ).filter(Boolean) as [string, React.ReactNode, boolean][];
  return (
    <div className="grid content-start gap-3">
      {a && a.progress && <ProgressCard n={n} />}
      <SideBlock title={a ? t("inbox.live.agent") : t("inbox.live.file")} icon={a ? "bot" : "file-text"}>
        {a && (
          <b dir="auto" className="text-theme-sm font-semibold text-gray-800 dark:text-white/90">
            {a.name}
          </b>
        )}
        <dl className="grid gap-2 text-theme-sm">
          {rows.map(([k, v, ltr]) => (
            <div key={k} className="flex min-w-0 items-baseline justify-between gap-2">
              <dt className="shrink-0 text-theme-xs text-gray-500 dark:text-gray-400">{k}</dt>
              <dd dir={ltr ? "ltr" : undefined} className={`min-w-0 text-end text-gray-800 [overflow-wrap:anywhere] dark:text-gray-200 ${ltr ? "text-[12.5px] mono" : "tnum"}`}>
                {v}
              </dd>
            </div>
          ))}
        </dl>
        {a && a.step && (
          <div className="rounded-lg bg-strip px-3 py-2 ">
            <div className="text-theme-xs font-medium text-gray-500">{t(a.state === "run" ? "inbox.live.now" : "inbox.live.lastStep")}</div>
            <div dir="auto" className="text-[12.5px] leading-6 text-gray-800 mono [overflow-wrap:anywhere] dark:text-gray-200">
              {a.step}
            </div>
          </div>
        )}
        {!a && (
          <p className="text-theme-xs leading-6 text-gray-500 dark:text-gray-400">{t("inbox.live.noAgent")}</p>
        )}
      </SideBlock>
      {a && a.recent && a.recent.length > 0 && <Acts a={a} />}
      {kids.length > 0 && (
        <SideBlock title={t("inbox.live.subagents")} icon="git-fork" count={kids.length}>
          <div className="overflow-hidden rounded-xl border border-line">
            {kids.map((k) => (
              <SubCard key={k.key} n={k} hrefOf={subHref} />
            ))}
          </div>
        </SideBlock>
      )}
    </div>
  );
}
