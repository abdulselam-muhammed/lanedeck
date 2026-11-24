"use client";
// The list column of /inbox (Aurora chat-list idea): tabs All / Active / Waiting on you, then sections that fold —
// unread (accent dot), waiting for you, the agents (a tree: subagents under their agent, folded by the
// caret), general files, and agents with no file (last 12 hours, folded by default).
import React from "react";
import Link from "next/link";
import { activeDeep, byActivity, Filter, hrefOf, isReadme, isRun, titleOf, TreeNode, waitingDeep, waitingSelf, whenOf } from "@/lib/inbox/model";
import { RelTime } from "@/components/common/RelTime";
import { useInbox } from "./InboxContext";
import { Icon } from "./IconSprite";
import { Chip, CountBadge, Led, QPill, Seg } from "./bits";
import { useProject, useT } from "@/context/ConfigContext";

function Item({ n, noDim }: { n: TreeNode; noDim?: boolean }) {
  const { selected, filter, unreadOf } = useInbox();
  const { base } = useProject();
  const t = useT();
  const f = n.file,
    a = n.agent;
  const unread = !!f && unreadOf(f);
  const qn = f && !isReadme(f) ? f.questions.length : 0;
  const dim = !noDim && ((filter === "active" && !isRun(n)) || (filter === "waiting" && !waitingSelf(n)));
  const active = selected === n.key;
  const step = a && (a.state === "run" || a.state === "wait") && a.step ? a.step : "";
  return (
    <Link
      href={hrefOf(n.key, base)}
      data-key={n.key}
      aria-current={active ? "page" : undefined}
      className={`relative grid w-full min-w-0 gap-1 rounded-lg px-2.5 py-2 text-start transition-colors ${
 active ? "bg-strip" : "hover:bg-gray-100 dark:hover:bg-white/5"
 } ${dim ? "opacity-45" : ""}`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Led n={n} />
        <span dir="auto" className={`min-w-0 flex-1 truncate text-theme-sm ${active ? "font-semibold text-gray-900 dark:text-white" : "font-medium text-gray-800 dark:text-gray-200"}`}>
          {titleOf(n)}
        </span>
        {qn > 0 && <QPill n={qn} />}
        {unread && <span title={t("inbox.list.changedSince")} aria-label={t("inbox.list.unread")} className="h-2 w-2 shrink-0 rounded-full bg-brand-500" />}
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-1.5 ps-3">
        <Chip n={n} />
        {a?.model && <span className="tag">{a.model}</span>}
        {n.children.length > 0 && (
          <span className="text-[11.5px] text-gray-500 dark:text-gray-400">
            <b className="mono">{n.children.length}</b> subagent
          </span>
        )}
        <span className="ms-auto text-[11.5px] text-gray-500 tnum dark:text-gray-400"><RelTime at={whenOf(n)} /></span>
      </span>
      {f && !step && (
        <span dir="ltr" className="truncate ps-3 text-end text-[11.5px] text-gray-400 mono">
          {f.name}
        </span>
      )}
      {step && (
        <span dir="auto" title={step} className="truncate ps-3 text-[12px] text-gray-500 mono dark:text-gray-400">
          {step}
        </span>
      )}
    </Link>
  );
}

function Node({ n }: { n: TreeNode }) {
  const { filter, collapsed, toggleCollapsed } = useInbox();
  const t = useT();
  const kids = [...n.children].sort(byActivity).filter((k) => (filter === "active" ? activeDeep(k) : filter === "waiting" ? waitingDeep(k) : true));
  const shut = filter === "all" && collapsed[n.key] === true;
  const hasCaret = filter === "all" ? n.children.length > 0 : kids.length > 0;
  return (
    <div>
      <div className="flex items-start gap-0.5">
        {hasCaret ? (
          <button
            type="button"
            onClick={() => toggleCollapsed(n.key)}
            aria-expanded={!shut}
            title={t(shut ? "inbox.list.showSubs" : "inbox.list.hideSubs")}
            className="mt-2 grid h-6 w-5 place-items-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/5"
          >
            <Icon name="chevron-down" className={`s14 transition-transform ${shut ? "rotate-90" : ""}`} />
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <Item n={n} />
        </div>
      </div>
      {kids.length > 0 && !shut && (
        <div className="ms-2.5 border-s border-line ps-1.5 ">
          {kids.map((k) => (
            <Node key={k.key} n={k} />
          ))}
        </div>
      )}
    </div>
  );
}

/** A section that folds: its title, a counter, a caret. "__others" is shut by default, the rest open. */
function Section({ id, title, count, tone, dot, children }: { id: string; title: string; count: number; tone?: "gray" | "brand" | "warning"; dot?: boolean; children: React.ReactNode }) {
  const { collapsed, toggleCollapsed } = useInbox();
  const open = id === "__others" ? collapsed.__others === false : collapsed[id] !== true;
  return (
    <section className="border-b border-line last:border-b-0 ">
      <button
        type="button"
        onClick={() => toggleCollapsed(id)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-theme-xs font-semibold text-gray-500 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-white/[0.02]"
      >
        <Icon name="chevron-down" className={`s14 transition-transform ${open ? "" : "rotate-90"}`} />
        {dot && <span className="h-2 w-2 rounded-full bg-brand-500" />}
        <span className="flex-1 text-start">{title}</span>
        <CountBadge tone={tone}>{count}</CountBadge>
      </button>
      {open && <div className="px-2 pb-3">{children}</div>}
    </section>
  );
}

export default function InboxList() {
  const { tree, filter, setFilter, counts, unreadOf } = useInbox();
  const t = useT();
  const keep = (n: TreeNode) => filter === "all" || (filter === "active" ? activeDeep(n) : waitingDeep(n));
  const unreadNodes = [...tree.nodes.values()].filter((n) => n.file && unreadOf(n.file)).sort(byActivity);
  const waitingNodes = [...tree.nodes.values()].filter(waitingSelf).sort(byActivity);
  const work = tree.work.filter(keep).sort(byActivity);
  const others = tree.others.filter(keep);
  const flat = (list: TreeNode[]) =>
    list.map((n) => (
      <div key={"f:" + n.key} className="flex items-start gap-0.5">
        <span className="w-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <Item n={n} noDim />
        </div>
      </div>
    ));
  return (
    <div className="flex min-h-0 flex-col">
      <div className="grid gap-2 border-b border-line p-3 ">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-gray-800 dark:text-white/90">{t("inbox.title")}</h1>
          <span className="text-theme-xs text-gray-500 dark:text-gray-400">
            <span className="mono">{tree.nodes.size}</span> {t("inbox.list.items")}
          </span>
        </div>
        <Seg<Filter>
          label={t("inbox.list.filter")}
          value={filter}
          onChange={setFilter}
          items={[
            { v: "all", label: t("inbox.list.all"), n: counts.all },
            { v: "active", label: t("inbox.list.active"), n: counts.active, tone: "info" },
            { v: "waiting", label: t("inbox.list.waiting"), n: counts.waiting, tone: "warning" },
          ]}
        />
      </div>
      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
        {unreadNodes.length > 0 && (
          <Section id="__sec:unread" title={t("inbox.list.unread")} count={unreadNodes.length} tone="brand" dot>
            {flat(unreadNodes)}
          </Section>
        )}
        {filter === "all" && waitingNodes.length > 0 && (
          <Section id="__sec:waiting" title={t("inbox.list.waiting")} count={waitingNodes.length} tone="warning">
            {flat(waitingNodes)}
          </Section>
        )}
        <Section id="__sec:work" title={t(filter === "active" ? "inbox.list.agentsActive" : filter === "waiting" ? "inbox.list.agentsWaiting" : "inbox.list.agents")} count={work.length}>
          {work.map((n) => (
            <Node key={n.key} n={n} />
          ))}
          {!work.length && (
            <div className="flex items-center gap-2 px-2 py-2 text-theme-sm text-gray-500 dark:text-gray-400">
              <Icon name={filter === "active" ? "activity" : filter === "waiting" ? "check" : "inbox"} />
              {t(filter === "active" ? "inbox.list.noneActive" : filter === "waiting" ? "inbox.list.noneWaiting" : "inbox.list.noFiles")}
            </div>
          )}
        </Section>
        {filter === "all" && tree.general.length > 0 && (
          <Section id="__sec:general" title={t("inbox.list.general")} count={tree.general.length}>
            {tree.general.map((n) => (
              <Node key={n.key} n={n} />
            ))}
          </Section>
        )}
        {filter !== "waiting" && others.length > 0 && (
          <Section id={filter === "active" ? "__sec:others-active" : "__others"} title={t(filter === "active" ? "inbox.list.others" : "inbox.list.others12")} count={others.length}>
            {others.map((n) => (
              <Node key={n.key} n={n} />
            ))}
          </Section>
        )}
      </div>
    </div>
  );
}
