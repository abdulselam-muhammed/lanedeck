"use client";
// /p/<project>/mine — "Your work": what waits for you on the project's repo, in plain words. The summary tiles are the
// tabs (needs you, your issues, your PRs grouped by what they wait for, asked of you); only the chosen one is shown. Read-only: every row
// has one action, open it on GitHub. Data: useMine() (server/mine/mine.mjs), shared with the sidebar badge.
import React, { useEffect, useState } from "react";
import { Card, CardHead, PageHeader } from "@/components/inbox/bits";
import { Icon } from "@/components/inbox/IconSprite";
import { RelTime } from "@/components/common/RelTime";
import { useProject, useT } from "@/context/ConfigContext";
import { useInbox } from "@/components/inbox/InboxContext";
import { useMine, type Mine, type MineAsk, type MineIssue, type MinePr } from "@/lib/mine/useMine";

const at = (iso: string | null | undefined) => (iso ? Date.parse(iso) : null);

type ChipTone = "attn" | "new" | "ok" | "calm";
const CHIP: Record<ChipTone, string> = {
  attn: "border-warning-500/30 bg-warning-500/10 text-warning-700 dark:text-warning-300",
  new: "border-brand-500/35 bg-brand-500/10 text-brand-700 dark:text-brand-300",
  ok: "border-success-500/30 bg-success-500/10 text-success-700 dark:text-success-400",
  calm: "border-line bg-strip text-gray-600 dark:text-gray-300",
};
function Chip({ tone, children, title }: { tone: ChipTone; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-theme-xs font-medium whitespace-nowrap ${CHIP[tone]}`}>
      {(tone === "new" || tone === "attn") && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/** The one action of a row. */
function OpenButton({ url, n }: { url: string; n: number }) {
  const t = useT();
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title={t("mine.openTitle", { n })}
      aria-label={t("mine.openTitle", { n })}
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 text-theme-xs font-medium text-gray-700 transition-colors hover:border-brand-500 hover:text-brand-600 dark:text-gray-200 dark:hover:text-brand-400"
    >
      {t("mine.open")}
      <Icon name="external" className="s14" />
    </a>
  );
}

/** "#123  Title" — the number stays left-to-right, the title follows its own direction. */
function Heading({ n, title, strong }: { n: number; title: string; strong?: boolean }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="mono shrink-0 text-theme-xs text-muted" dir="ltr">#{n}</span>
      <span dir="auto" title={title} className={`line-clamp-2 min-w-0 break-words text-theme-sm sm:line-clamp-1 ${strong ? "font-semibold text-gray-900 dark:text-white" : "font-medium text-gray-800 dark:text-gray-100"}`}>
        {title}
      </span>
    </div>
  );
}

function Row({ children, action, fresh }: { children: React.ReactNode; action: React.ReactNode; fresh?: boolean }) {
  return (
    <li className="relative flex items-center gap-3 border-t border-line px-3 py-2.5 first:border-t-0 sm:px-4">
      {fresh && <span aria-hidden="true" className="absolute inset-y-2.5 start-0 w-[3px] rounded-e-full bg-brand-500" />}
      <div className="grid min-w-0 flex-1 gap-1">{children}</div>
      {action}
    </li>
  );
}

const Meta = ({ children }: { children: React.ReactNode }) => <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-theme-xs text-muted">{children}</div>;
const Dot = () => <span aria-hidden="true">·</span>;
const Login = ({ who }: { who: string }) => <span dir="ltr" className="font-medium text-gray-600 dark:text-gray-300">{who}</span>;

function Labels({ labels }: { labels: MineIssue["labels"] }) {
  if (!labels.length) return null;
  const shown = labels.slice(0, 2);
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {shown.map((l) => (
        <span key={l.name} dir="auto" className="inline-flex max-w-36 items-center gap-1 truncate rounded-full border border-line px-1.5 leading-5">
          <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: `#${l.color}` }} />
          <span className="truncate">{l.name}</span>
        </span>
      ))}
      {labels.length > 2 && <span title={labels.slice(2).map((l) => l.name).join(", ")}>+{labels.length - 2}</span>}
    </span>
  );
}

function Linked({ linked }: { linked: MineIssue["linked"] }) {
  const t = useT();
  if (!linked.length) return null;
  const tone = (s: string) => (s === "MERGED" ? "text-success-600 dark:text-success-400" : s === "OPEN" ? "text-brand-600 dark:text-brand-400" : "text-muted line-through");
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon name="git-fork" className="s14" />
      <span className="sr-only">{t("mine.linked")}</span>
      {linked.slice(0, 3).map((p) => (
        <a key={p.number} href={p.url} target="_blank" rel="noreferrer" dir="ltr" title={`${p.state.toLowerCase()} · ${p.closes ? t("mine.closes") : t("mine.refs")}`} className={`mono hover:underline ${tone(p.state)}`}>
          #{p.number}
        </a>
      ))}
      {linked.length > 3 && <span>+{linked.length - 3}</span>}
    </span>
  );
}

function IssueRow({ i }: { i: MineIssue }) {
  const t = useT();
  return (
    <Row fresh={i.newReply} action={<OpenButton url={i.url} n={i.number} />}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <div className="min-w-0 basis-full sm:basis-0 sm:flex-1"><Heading n={i.number} title={i.title} strong={i.newReply} /></div>
        {i.newReply && <Chip tone="new" title={t("mine.newReplyBy", { who: i.replyBy ?? "" })}>{t("mine.newReply")}</Chip>}
      </div>
      <Meta>
        {i.last ? (
          <span>
            {t("mine.lastBy")} <Login who={i.last.by} /> <Dot /> <RelTime at={at(i.last.at)} />
          </span>
        ) : (
          <span>{t("mine.noComments")}</span>
        )}
        <Labels labels={i.labels} />
        <Linked linked={i.linked} />
      </Meta>
    </Row>
  );
}

const PR_TONE: Record<MinePr["group"], ChipTone> = { needs: "attn", waiting: "calm", ready: "ok" };
function PrRow({ p }: { p: MinePr }) {
  const t = useT();
  const total = p.ci.pass + p.ci.fail + p.ci.run;
  return (
    <Row fresh={p.reason === "reply"} action={<OpenButton url={p.url} n={p.number} />}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <div className="min-w-0 basis-full sm:basis-0 sm:flex-1"><Heading n={p.number} title={p.title} strong={p.group === "needs"} /></div>
        <Chip tone={p.reason === "reply" ? "new" : PR_TONE[p.group]}>
          {t(`mine.reason.${p.reason}`)}
          {p.reason === "stacked" && p.parent ? <span className="mono" dir="ltr">#{p.parent}</span> : null}
        </Chip>
      </div>
      <Meta>
        <span>
          {t("mine.updatedAgo")} <RelTime at={at(p.updated)} />
        </span>
        {p.reason === "reply" && p.replyBy && (
          <>
            <Dot />
            <span>
              {t("mine.replyBy")} <Login who={p.replyBy} />
            </span>
          </>
        )}
        {total > 0 && (
          <>
            <Dot />
            <span className={p.ci.fail ? "text-error-600 dark:text-error-400" : ""}>{t("mine.checks", { pass: p.ci.pass, total })}</span>
          </>
        )}
      </Meta>
    </Row>
  );
}

function AskRow({ a }: { a: MineAsk }) {
  const t = useT();
  return (
    <Row fresh action={<OpenButton url={a.url} n={a.number} />}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <div className="min-w-0 basis-full sm:basis-0 sm:flex-1"><Heading n={a.number} title={a.title} strong /></div>
        <Chip tone="new">{a.kind === "review" ? t("mine.kind.review") : t("mine.kind.mention", { who: a.by ?? "" })}</Chip>
      </div>
      <Meta>
        <span>{t(`mine.type.${a.type}`)}</span>
        {a.kind === "review" && a.by && (
          <>
            <Dot />
            <Login who={a.by} />
          </>
        )}
        <Dot />
        <RelTime at={at(a.at)} />
      </Meta>
    </Row>
  );
}

/** A list that shows the first few rows and folds the rest behind one quiet button. */
function Folded<T>({ items, limit, render }: { items: T[]; limit: number; render: (x: T) => React.ReactNode }) {
  const t = useT();
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, limit);
  return (
    <>
      <ul>{shown.map(render)}</ul>
      {items.length > limit && (
        <div className="border-t border-line px-3 py-2 sm:px-4">
          <button type="button" onClick={() => setAll(!all)} className="inline-flex items-center gap-1 text-theme-xs font-medium text-gray-600 hover:text-brand-600 dark:text-gray-300 dark:hover:text-brand-400">
            {all ? t("mine.less") : t("mine.more", { n: items.length })}
            <Icon name="chevron-down" className={`s14 transition-transform ${all ? "rotate-180" : ""}`} />
          </button>
        </div>
      )}
    </>
  );
}

function Quiet({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-t border-line px-3 py-6 text-theme-sm text-muted sm:px-4">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-success-500/10 text-success-600 dark:text-success-400">
        <Icon name={icon} className="s16" />
      </span>
      {children}
    </div>
  );
}

function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <ul aria-hidden="true">
      {Array.from({ length: rows }, (_, k) => (
        <li key={k} className="grid gap-2 border-t border-line px-3 py-3 sm:px-4">
          <span className="h-3.5 w-2/3 animate-pulse rounded bg-strip motion-reduce:animate-none" />
          <span className="h-3 w-1/3 animate-pulse rounded bg-strip motion-reduce:animate-none" />
        </li>
      ))}
    </ul>
  );
}

type Tab = "needs" | "issues" | "prs" | "asked";
const TABS: Tab[] = ["needs", "issues", "prs", "asked"];
const isTab = (x: unknown): x is Tab => typeof x === "string" && (TABS as string[]).includes(x);

/**
 * The summary row IS the tab bar: four tiles (needs you, your issues, your PRs, asked of you), each with its count and one
 * line; the selected one is marked and owns the panel below. Arrow keys, Home and End move between them (roving tabindex).
 */
function TabBar({ m, tab, onPick }: { m: Mine | null; tab: Tab; onPick: (t: Tab) => void }) {
  const t = useT();
  const c = m?.counts;
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const needs = c?.needsYou ?? 0;
  const tiles: Record<Tab, { label: string; value: React.ReactNode; sub: React.ReactNode }> = {
    needs: { label: t("mine.sum.needs"), value: c ? needs : "–", sub: c ? (needs ? t("mine.sum.needsSub") : t("mine.sum.needsNone")) : "…" },
    issues: { label: t("mine.sum.issues"), value: c ? c.issues : "–", sub: c ? (c.issuesNew ? t("mine.sum.newN", { n: c.issuesNew }) : t("mine.sum.quiet")) : "…" },
    prs: { label: t("mine.sum.prs"), value: m?.prs && c ? c.prs : "–", sub: m?.prs && c ? (c.needs ? t("mine.sum.needsN", { n: c.needs }) : t("mine.sum.quiet")) : "…" },
    asked: { label: t("mine.sum.asked"), value: c ? c.asked : "–", sub: c ? (c.asked ? t("mine.sum.needsN", { n: c.asked }) : t("mine.sum.quiet")) : "…" },
  };
  const key = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
    const moves: Record<string, number> = { ArrowRight: rtl ? i - 1 : i + 1, ArrowLeft: rtl ? i + 1 : i - 1, ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: TABS.length - 1 };
    const next = moves[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const j = (next + TABS.length) % TABS.length;
    onPick(TABS[j]);
    refs.current[j]?.focus();
  };
  return (
    <div role="tablist" aria-label={t("mine.sum.label")} className="mb-3 grid grid-cols-2 gap-2.5 sm:px-1.5 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
      {TABS.map((k, i) => {
        const x = tiles[k];
        const on = tab === k;
        const hot = k === "needs" && needs > 0;
        return (
          <button
            key={k}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`mine-tab-${k}`}
            aria-selected={on}
            aria-controls="mine-panel"
            tabIndex={on ? 0 : -1}
            onClick={() => onPick(k)}
            onKeyDown={(e) => key(e, i)}
            style={{ ["--tile-accent" as string]: hot ? "var(--color-brand-500)" : k === "needs" ? "var(--color-success-500)" : "var(--color-gray-400)" } as React.CSSProperties}
            className={`tile-smoke tile-slant relative min-w-0 rounded-xl border bg-card px-3 py-2 text-start shadow-theme-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 ${
              k === "needs" ? "col-span-2 md:col-span-1" : ""
            } ${on ? "border-brand-500/60 ring-1 ring-brand-500/40" : "border-line/60 hover:border-brand-500/40"}`}
          >
            {on && <span aria-hidden="true" className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-brand-500" />}
            <span className="tile-upright flex min-w-0 items-center gap-3">
            {k === "needs" && (
              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${hot ? "bg-brand-500 text-white" : "bg-success-500/15 text-success-600 dark:text-success-400"}`}>
                <Icon name={hot ? "bell-ring" : "check"} className="s18" />
              </span>
            )}
            <span className="grid min-w-0 gap-0.5">
              <span className={`truncate text-theme-xs font-medium ${on ? "text-brand-700 dark:text-brand-300" : "text-muted"}`}>{x.label}</span>
              <span className={`leading-8 text-gray-900 tnum dark:text-white ${k === "needs" ? "text-[26px] font-bold" : "text-[20px] font-semibold"}`}>{x.value}</span>
              <span className="truncate text-theme-xs text-muted">{x.sub}</span>
            </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** A small heading inside a panel (the PR groups, the parts of "needs you"). */
function GroupHead({ label, n }: { label: string; n: number }) {
  return (
    <h3 className="flex items-center gap-2 border-t border-line bg-strip/50 px-3 py-1.5 text-[11.5px] font-semibold tracking-wide text-gray-600 sm:px-4 dark:text-gray-300">
      {label}
      <span className="mono font-normal text-muted">{n}</span>
    </h3>
  );
}

const PR_GROUPS: MinePr["group"][] = ["needs", "waiting", "ready"];

function Notice({ tone, children }: { tone: "warn" | "error"; children: React.ReactNode }) {
  return (
    <div role="status" className={`mb-3 flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-theme-sm ${tone === "error" ? "border-error-500/30 bg-error-500/10 text-error-700 dark:text-error-300" : "border-warning-500/30 bg-warning-500/10 text-warning-800 dark:text-warning-200"}`}>
      <Icon name="alert" className="s16 mt-0.5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </div>
  );
}

export default function MinePage() {
  const t = useT();
  const { id, projects } = useProject();
  const { pstore } = useInbox();
  const repo = projects.find((p) => p.id === id)?.repo ?? null;
  const { data: m, failed, refresh } = useMine(id);
  const [asked, setAsked] = useState(false);
  const [tab, setTab] = useState<Tab>("needs");
  // ?tab= in the URL wins (links, notifications), then the last tab used in this project, then "needs you".
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("tab");
    const saved = pstore.get<string>("mine.tab", "needs");
    setTab(isTab(q) ? q : isTab(saved) ? saved : "needs");
  }, [pstore]);
  const pick = (k: Tab) => {
    setTab(k);
    pstore.set("mine.tab", k);
    try {
      const u = new URL(window.location.href);
      u.searchParams.set("tab", k);
      window.history.replaceState(window.history.state, "", u);
    } catch {
      /* the URL stays as it is */
    }
  };
  const loading = !m || (!m.counts && !m.error);
  const go = () => {
    if (asked) return;
    setAsked(true);
    refresh().finally(() => setTimeout(() => setAsked(false), 20000));
  };

  const askRows = (xs: MineAsk[]) => <Folded items={xs} limit={30} render={(a) => <AskRow key={`${a.kind}${a.number}`} a={a} />} />;
  let title: string;
  let desc: string;
  let body: React.ReactNode;
  if (tab === "needs") {
    title = t("mine.sum.needs");
    desc = t("mine.needs.desc");
    if (loading) body = <Skeleton rows={4} />;
    else {
      const prNeeds = (m.prs ?? []).filter((p) => p.group === "needs");
      const issueNew = m.issues.filter((i) => i.newReply);
      body =
        m.asked.length || prNeeds.length || issueNew.length ? (
          <>
            {m.asked.length > 0 && (
              <>
                <GroupHead label={t("mine.asked.title")} n={m.asked.length} />
                {askRows(m.asked)}
              </>
            )}
            {prNeeds.length > 0 && (
              <>
                <GroupHead label={t("mine.prs.title")} n={prNeeds.length} />
                <Folded items={prNeeds} limit={30} render={(p) => <PrRow key={p.number} p={p} />} />
              </>
            )}
            {issueNew.length > 0 && (
              <>
                <GroupHead label={t("mine.issues.title")} n={issueNew.length} />
                <Folded items={issueNew} limit={30} render={(i) => <IssueRow key={i.number} i={i} />} />
              </>
            )}
            {!m.prs && <p className="border-t border-line px-3 py-2 text-theme-xs text-muted sm:px-4">{t("mine.prs.loading")}</p>}
          </>
        ) : (
          <Quiet icon="check">{t("mine.sum.needsNone")}</Quiet>
        );
    }
  } else if (tab === "issues") {
    title = t("mine.issues.title");
    desc = t("mine.issues.desc");
    body = loading ? <Skeleton rows={4} /> : m.issues.length ? <Folded items={m.issues} limit={15} render={(i) => <IssueRow key={i.number} i={i} />} /> : <Quiet icon="check">{t("mine.issues.empty")}</Quiet>;
  } else if (tab === "prs") {
    title = t("mine.prs.title");
    desc = t("mine.prs.desc");
    if (loading || !m.prs)
      body = (
        <>
          {m && !m.prs && <p className="border-t border-line px-3 pt-2 text-theme-xs text-muted sm:px-4">{t("mine.prs.loading")}</p>}
          <Skeleton rows={3} />
        </>
      );
    else if (!m.prs.length) body = <Quiet icon="check">{t("mine.prs.empty")}</Quiet>;
    else
      body = PR_GROUPS.map((g) => {
        const rows = m.prs!.filter((p) => p.group === g);
        if (!rows.length) return null;
        return (
          <section key={g} aria-label={t(`mine.group.${g}`)}>
            <GroupHead label={t(`mine.group.${g}`)} n={rows.length} />
            <Folded items={rows} limit={g === "needs" ? 30 : 10} render={(p) => <PrRow key={p.number} p={p} />} />
          </section>
        );
      });
  } else {
    title = t("mine.asked.title");
    desc = t("mine.asked.desc");
    body = loading ? <Skeleton rows={3} /> : m.asked.length ? askRows(m.asked) : <Quiet icon="check">{t("mine.asked.empty")}</Quiet>;
  }

  return (
    <>
      <PageHeader title={t("mine.title")} desc={repo ? t("mine.desc", { repo }) : t("mine.descNoRepo")}>
        <span className="text-theme-xs text-muted">
          {m?.at ? (
            <>
              {t("mine.updated")} <RelTime at={m.at} />
            </>
          ) : (
            t("mine.reading")
          )}
        </span>
        <button
          type="button"
          onClick={go}
          disabled={asked}
          className="inline-flex items-center gap-2 rounded-lg border border-line bg-card px-3 py-1.5 text-theme-xs font-medium hover:border-brand-500 disabled:opacity-50"
        >
          <Icon name="refresh" className={`s14 ${asked ? "animate-spin motion-reduce:animate-none" : ""}`} /> {t("mine.refresh")}
        </button>
      </PageHeader>

      {m?.error && <Notice tone={m.error.code === "budget" || m.error.code === "network" ? "warn" : "error"}>{t(`mine.err.${m.error.code}`)}</Notice>}
      {!m?.error && failed && <Notice tone="warn">{t("mine.err.failed")}</Notice>}
      {m?.boardError && (tab === "prs" || tab === "needs") && <Notice tone="warn">{t("mine.err.board", { text: m.boardError })}</Notice>}

      <TabBar m={loading ? null : m} tab={tab} onPick={pick} />

      <Card className="min-w-0 overflow-hidden">
        <div role="tabpanel" id="mine-panel" aria-labelledby={`mine-tab-${tab}`}>
          <CardHead title={title} desc={desc} />
          {body}
        </div>
      </Card>
    </>
  );
}
