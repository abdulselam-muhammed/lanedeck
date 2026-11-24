"use client";
import React, { useState } from "react";
import { inline, md } from "@/lib/inbox/markdown";
import { hrefOf, InboxFile, openQuestions, Question } from "@/lib/inbox/model";
import { useInbox } from "./InboxContext";
import { Icon } from "./IconSprite";
import { Card, CardHead, CountBadge, Empty, MoreLink, PageHeader } from "./bits";
import { useProject, useT } from "@/context/ConfigContext";

export function CopyButton({ text, short }: { text: string; short?: boolean }) {
  const t = useT();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text + " ");
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {}
      }}
      className="ms-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-card px-3 text-theme-xs font-medium text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.03]"
    >
      <Icon name={done ? "check" : "copy"} className="s14" />
      <span>{done ? t("inbox.q.copied") : short ? t("inbox.q.copy") : t("inbox.q.copyId", { id: text })}</span>
    </button>
  );
}

/** One open question: an amber TailAdmin card with its id, a copy button for answering by id, and its body. */
export function QuestionCard({ f, q }: { f: InboxFile; q: Question }) {
  const { freshQ } = useInbox();
  const isNew = freshQ.has(f.name + "|" + q.id);
  return (
    <section
      className={`my-3 rounded-xl border bg-card px-3 pb-3 ${isNew ? "border-gray-400 dark:border-gray-500" : "border-line"}`}
    >
      <h2 className="flex flex-wrap items-center gap-2.5 pt-3 pb-1 text-[15.5px] font-semibold text-gray-800 dark:text-white/90">
        <span className="rounded-md bg-strip px-2 py-1 text-theme-xs font-semibold text-gray-700 mono dark:text-gray-200" dir="ltr">
          {q.id}
        </span>
        <span className="min-w-0 flex-[1_1_240px]" dangerouslySetInnerHTML={{ __html: inline(q.title.replace(/^[A-Z]{1,8}\d{1,3}\s*[—–-]?\s*/, "")) }} />
        <CopyButton text={q.id + ":"} />
      </h2>
      <div className="md-doc" dangerouslySetInnerHTML={{ __html: md(q.lines.slice(1).join("\n")) }} />
    </section>
  );
}

/** /questions: every open question grouped by its file, one card per file; filter by file. */
export default function QuestionsView() {
  const { files, updatedAt } = useInbox();
  const { base } = useProject();
  const t = useT();
  const [only, setOnly] = useState<string>("");
  const qs = openQuestions(files);
  const answered = files.flatMap((f) => f.answeredQs.map((q) => ({ f, q })));
  const groups: { f: InboxFile; qs: Question[] }[] = [];
  for (const { f, q } of qs) {
    const g = groups.find((x) => x.f.name === f.name);
    if (g) g.qs.push(q);
    else groups.push({ f, qs: [q] });
  }
  const shown = only && groups.some((g) => g.f.name === only) ? groups.filter((g) => g.f.name === only) : groups;
  const chip = (v: string, label: React.ReactNode, n: number) => (
    <button
      key={v || "all"}
      type="button"
      aria-pressed={(only || "") === v}
      onClick={() => setOnly(v)}
      className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-theme-xs font-medium transition ${
 (only || "") === v
 ? "border-gray-400 bg-strip text-gray-900 dark:border-gray-500 dark:text-white"
 : "border-line bg-card text-gray-600 hover:bg-gray-50 dark:text-gray-300"
 }`}
    >
      {label}
      <CountBadge>{n}</CountBadge>
    </button>
  );
  return (
    <>
      <PageHeader
        crumbs={[{ label: t("inbox.q.crumb") }]}
        title={
          <span className="inline-flex items-center gap-2.5">
            {t("inbox.q.openTitle")} <CountBadge>{qs.length}</CountBadge>
          </span>
        }
        desc={t("inbox.q.desc")}
      />
      {!updatedAt ? (
        <Empty icon="loader">{t("inbox.connecting")}</Empty>
      ) : !qs.length && !answered.length ? (
        <Card>
          <Empty icon="check-check">{t("inbox.q.none")}</Empty>
        </Card>
      ) : (
        <>
          {!qs.length && (
            <Card className="mb-3">
              <Empty icon="check-check">{t("inbox.q.none")}</Empty>
            </Card>
          )}
          {groups.length > 1 && (
            <div role="group" aria-label={t("inbox.q.filterByFile")} className="mb-5 flex flex-wrap gap-2">
              {chip("", t("inbox.q.allFiles"), qs.length)}
              {groups.map((g) => chip(g.f.name, <span dir="auto">{g.f.title}</span>, g.qs.length))}
            </div>
          )}
          <div className="grid gap-3 [&>*]:min-w-0">
            {shown.map((g) => (
              <Card key={g.f.name} className="w-full">
                <CardHead
                  title={<span dir="auto">{g.f.title}</span>}
                  desc={
                    <span dir="ltr" className="mono">
                      {g.f.name}
                    </span>
                  }
                >
                  <MoreLink href={hrefOf(g.f.name, base)}>{t("inbox.q.openFile")}</MoreLink>
                </CardHead>
                <div className="px-3 pb-3">
                  {g.qs.map((q) => (
                    <QuestionCard key={g.f.name + "|" + q.id} f={g.f} q={q} />
                  ))}
                </div>
              </Card>
            ))}
          </div>
          {answered.length > 0 && (
            <Card className="mt-3 w-full">
              <CardHead title={<span className="inline-flex items-center gap-2.5">{t("inbox.q.answeredTitle")} <CountBadge>{answered.length}</CountBadge></span>} desc={t("inbox.q.answeredDesc")} />
              <ul className="divide-y divide-line px-3 pb-3">
                {answered.map(({ f, q }) => (
                  <li key={f.name + "|" + q.id} className="grid gap-1 py-2">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="rounded-md bg-strip px-2 py-1 text-theme-xs font-semibold text-gray-700 mono dark:text-gray-200" dir="ltr">{q.id}</span>
                      <span className="min-w-0 flex-1 text-theme-sm font-medium text-gray-800 dark:text-white/90" dangerouslySetInnerHTML={{ __html: inline(q.title.replace(/^[A-Z]{1,8}\d{1,3}\s*[—–-]?\s*/, "")) }} />
                      <span className="rounded-full bg-strip px-2 py-0.5 text-theme-xs text-muted">{t("inbox.q.answeredPill")}</span>
                      <MoreLink href={hrefOf(f.name, base)}>{f.name}</MoreLink>
                    </div>
                    <div className="md-doc" dangerouslySetInnerHTML={{ __html: md(q.lines.slice(1).join("\n")) }} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </>
  );
}
