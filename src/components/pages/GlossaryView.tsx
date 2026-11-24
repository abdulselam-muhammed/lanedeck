"use client";
// The glossary page. Terms come from the project profile (profiles/<name>/profile.json) or a short generic list.
// Every term we use in chat, grouped. A row with several related terms is one framed row
// split into sub-rows, one term each, so related terms stay together but each gets its own meaning.
import React from "react";
import { Card, CardHead, PageHeader } from "@/components/inbox/bits";
import { useT } from "@/context/ConfigContext";

// Profiles written in Arabic spell the scope in Arabic; those spellings map to the three kinds (escaped so the source stays Arabic-free).
const PUBLIC = ["public", "\u0639\u0627\u0645\u0629"];
const PRIVATE = ["private", "\u062e\u0627\u0635\u0629"];
const RULE = ["rule", "\u0639\u0627\u0645\u0629\u060c \u0648\u0627\u0644\u0642\u0627\u0639\u062f\u0629 \u0639\u0646\u0627"];
export type Scope = string;
export type Term = { term: string; meaning: string; scope?: Scope };
type Entry = { title?: string; scope?: Scope; terms: Term[] };
export type Group = { title: string; desc: string; entries: Entry[] };


function ScopeTag({ s }: { s?: Scope }) {
  const t = useT();
  if (!s) return null;
  const kind = PUBLIC.includes(s) ? "public" : PRIVATE.includes(s) ? "private" : RULE.includes(s) ? "rule" : null;
  const cls =
    kind === "public"
      ? "bg-gray-100 text-gray-700 dark:bg-white/[0.06] dark:text-gray-300"
      : kind === "private"
        ? "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
        : "bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-300";
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-theme-xs ${cls}`}>{kind ? t(`pages.glossary.scope.${kind}`) : s}</span>;
}

function TermLine({ t, scope }: { t: Term; scope?: Scope }) {
  return (
    <div className="grid grid-cols-1 gap-1 px-3 py-1.5 sm:grid-cols-[minmax(150px,220px)_1fr_auto] sm:items-center sm:gap-3">
      <span dir="ltr" className="mono text-start font-semibold text-gray-900 dark:text-white sm:text-end">{t.term}</span>
      <span className="text-theme-sm text-gray-700 dark:text-gray-300">{t.meaning}</span>
      <span><ScopeTag s={t.scope ?? scope} /></span>
    </div>
  );
}

export default function GlossaryView({
  crumbs, title, desc, groups, placeholder, children,
}: { crumbs: { label: string; href?: string }[]; title: string; desc: React.ReactNode; groups: Group[]; placeholder: string; children?: React.ReactNode }) {
  const [q, setQ] = React.useState("");
  const needle = q.trim().toLowerCase();
  const match = (t: Term) => !needle || t.term.toLowerCase().includes(needle) || t.meaning.toLowerCase().includes(needle);
  return (
    <>
      <PageHeader crumbs={crumbs} title={title} desc={desc}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          className="h-10 w-64 rounded-lg border border-gray-200 bg-transparent px-3 text-theme-sm text-gray-900 outline-none focus:border-brand-400 dark:border-gray-800 dark:text-white"
        />
      </PageHeader>
      {children}
      {groups.map((g) => {
        const entries = g.entries.map((e) => ({ ...e, terms: e.terms.filter(match) })).filter((e) => e.terms.length);
        if (!entries.length) return null;
        return (
          <Card key={g.title} className="mb-3">
            <CardHead title={g.title} desc={g.desc} />
            <div className="grid gap-2 px-3 pb-3">
              {entries.map((e, i) =>
                e.terms.length === 1 && !e.title ? (
                  <div key={i} className="rounded-xl border border-gray-200 dark:border-gray-800">
                    <TermLine t={e.terms[0]} scope={e.scope} />
                  </div>
                ) : (
                  <div key={i} className="overflow-hidden rounded-xl border border-gray-300 dark:border-gray-700">
                    {e.title && (
                      <div className="border-b border-gray-200 bg-gray-50 px-3 py-2 text-theme-xs font-medium text-gray-600 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-400">
                        {e.title}
                      </div>
                    )}
                    <div className="divide-y divide-gray-200 dark:divide-gray-800">
                      {e.terms.map((t) => (
                        <TermLine key={t.term} t={t} scope={e.scope} />
                      ))}
                    </div>
                  </div>
                ),
              )}
            </div>
          </Card>
        );
      })}
    </>
  );
}
