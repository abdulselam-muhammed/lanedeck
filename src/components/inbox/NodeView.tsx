"use client";
// A file or an agent on screen: the live box, then the document — as text, or (a file with a
// ```flow block) as the flow map canvas.
import React, { useMemo } from "react";
import { inline, md } from "@/lib/inbox/markdown";
import { FLOW_RE, parseFlow } from "@/lib/inbox/flow";
import Link from "next/link";
import { hrefOf, InboxFile, isReadme, QID, titleOf, TreeNode } from "@/lib/inbox/model";
import { RelTime } from "@/components/common/RelTime";
import { useInbox } from "./InboxContext";
import { Icon } from "./IconSprite";
import { Chip, QPill } from "./bits";
import { QuestionCard } from "./QuestionsView";
import FlowCanvas from "./FlowCanvas";
import { useProject, useT } from "@/context/ConfigContext";
import { SetupActions } from "@/components/setup/Setup";

/** The text of a file: markdown, with every "## ID" question drawn as a question card (as the old renderDoc). */
export function DocText({ f }: { f: InboxFile }) {
 const parts = useMemo(() => {
 const lines = f.text.replace(FLOW_RE, "").replace(/\r\n?/g, "\n").split("\n");
 const out: ({ t: "md"; html: string } | { t: "q"; id: string })[] = [];
 let buf: string[] = [],
 inQ = false;
 const drawn = new Set<string>();
 const flush = () => {
 if (buf.length) out.push({ t: "md", html: md(buf.join("\n")) });
 buf = [];
 };
 for (const l of lines) {
 if (/^\*\*[^*\n]*agent[^*\n]*:\*\*/i.test(l)) continue; // the live box above shows the agent
 if (/^\s*<!--\s*lanedeck protocol:\s*\d+\s*-->\s*$/.test(l)) continue; // the protocol marker line is not content
 const m = l.match(QID);
 if (m) {
 flush();
 const q = f.questions.find((x) => x.id === m[1] && !drawn.has(x.id));
 inQ = !!q;
 if (q) {
 drawn.add(q.id);
 out.push({ t: "q", id: q.id });
 }
 continue;
 }
 if (inQ && !/^#{1,2}\s/.test(l)) continue;
 inQ = false;
 buf.push(l);
 }
 flush();
 return out;
 }, [f]);
 return (
 <div className="md-doc">
 {parts.map((p, i) =>
 p.t === "md" ? (
 <div key={i} dangerouslySetInnerHTML={{ __html: p.html }} />
 ) : (
 <QuestionCard key={i} f={f} q={f.questions.find((q) => q.id === p.id)!} />
 ),
 )}
 </div>
 );
}

export function ModeSwitch({ f, mode }: { f: InboxFile; mode: string }) {
 const { setMode } = useInbox();
 const t = useT();
 const btn = (m: string, icon: string, label: string) => (
 <button
 type="button"
 role="tab"
 aria-selected={mode === m}
 onClick={() => setMode(f.name, m)}
 className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-theme-xs font-medium transition ${
        mode === m ? "bg-card text-gray-900 shadow-theme-xs dark:bg-white/10 dark:text-white" : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white"
      }`}
 >
 <Icon name={icon} className="s14" />
 {label}
 </button>
 );
 return (
 <div role="tablist" aria-label={t("inbox.node.viewMode")} className="inline-flex shrink-0 gap-0.5 rounded-lg bg-strip p-0.5">
 {btn("text", "file-text", t("inbox.node.text"))}
 {btn("flow", "map", t("inbox.node.flowMap"))}
 </div>
 );
}

/**
 * The middle column of /inbox/[file]: the crumbs to the parent agents, the file's name and title, its
 * state, the text / map switch, then the document — as text (with its question cards) or, for a file
 * with a ```flow block in map mode, the flow canvas.
 */
export default function NodeView({ n }: { n: TreeNode }) {
  const { modes, tree, unreadOf, protocol } = useInbox();
  const { base, id: projectId } = useProject();
  const t = useT();
  const f = n.file;
  const flow = useMemo(() => (f && !protocol?.map ? parseFlow(f.text) : null), [f, protocol]);
  const mode = f && flow && modes[f.name] === "flow" ? "flow" : "text";
  const title = f ? (f.text.match(/^#\s+(.+)$/m)?.[1] ?? f.name) : (n.agent?.name ?? "");
  const chain: TreeNode[] = [];
  for (let p = tree.parentOf.get(n.key); p && chain.length < 6; p = tree.parentOf.get(p.key)) chain.unshift(p);
  const qn = f && !isReadme(f) ? f.questions.length : 0;

  return (
    <div className="flex min-h-0 min-w-0 flex-col">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-3 py-2 ">
        <div className="grid min-w-0 gap-0.5">
          <nav aria-label={t("inbox.node.path")} className="flex flex-wrap items-center gap-1 text-theme-xs text-gray-500 dark:text-gray-400">
            <Link href={base + "/inbox"} className="hover:text-gray-800 dark:hover:text-gray-200">
              {t("inbox.title")}
            </Link>
            <span aria-hidden="true">/</span>
            {chain.map((p) => (
              <React.Fragment key={p.key}>
                <Link href={hrefOf(p.key, base)} dir="auto" className="max-w-[220px] truncate font-medium text-gray-700 hover:underline dark:text-gray-200">
                  {titleOf(p)}
                </Link>
                <span aria-hidden="true">/</span>
              </React.Fragment>
            ))}
            {f ? (
              <span dir="ltr" className="mono">
                {f.name}
              </span>
            ) : (
              <span>{t("inbox.node.agentNoFile")}</span>
            )}
          </nav>
          <h1 className="text-xl font-semibold text-gray-800 dark:text-white/90" dir="auto" dangerouslySetInnerHTML={{ __html: inline(title) }} />
          <div className="mt-1 flex flex-wrap items-center gap-2 text-theme-xs text-gray-500 dark:text-gray-400">
            <Chip n={n} />
            {qn > 0 && <QPill n={qn} />}
            {f?.plan && (
              <span className="tnum" title="## Steps">
                {t("inbox.node.steps")} {f.plan.done}/{f.plan.total} · {Math.floor((f.plan.done / f.plan.total) * 100)}%
              </span>
            )}
            {f && f.answeredQs.length > 0 && <span className="tnum">{t("inbox.node.answered", { n: f.answeredQs.length })}</span>}
            {f && unreadOf(f) && <span className="rounded-full bg-strip px-1.5 text-[11px] leading-[18px] font-semibold text-gray-700 dark:text-gray-200">{t("inbox.node.new")}</span>}
            {f && <span className="tnum">{t("inbox.node.updated")} <RelTime at={f.mtime} /></span>}
          </div>
        </div>
        {f && flow && (
          <div className="flex items-center gap-2">
            <ModeSwitch f={f} mode={mode} />
            {mode === "flow" && (
              <Link href={base + "/flow/" + encodeURIComponent(f.name)} className="header-icon-btn h-9! w-9!" title={t("inbox.node.fullMap")} aria-label={t("inbox.node.fullMap")}>
                <Icon name="expand" className="s14" />
              </Link>
            )}
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 px-3 py-2 md:px-7">
        {f && protocol && f.name === "00-setup.md" && <div className="mb-3"><SetupActions projectId={projectId} /></div>}
        {!f ? (
          <p className="text-theme-sm leading-7 text-gray-500 dark:text-gray-400">
            {t("inbox.node.noMessageFile")}
          </p>
        ) : mode === "flow" && flow ? (
          <FlowCanvas key={f.name} file={f.name} flow={flow} />
        ) : (
          <DocText f={f} />
        )}
      </div>
    </div>
  );
}
