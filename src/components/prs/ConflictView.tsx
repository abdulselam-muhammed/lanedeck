"use client";
// The code-conflict section of /prs (2026-11-11): pick a PR that conflicts with its base in code, see ONLY the
// conflicting hunks of each file — the base side (the default branch) beside the PR side, with three lines of context —
// instead of whole files. Data: GET /api/prs/conflict?n=N (git merge-tree in the hub clone, cached per head + base).
import React, { useEffect, useState } from "react";
import { Card, CardHead } from "@/components/inbox/bits";
import { isBoardFile, type Pr } from "@/lib/prs/model";
import { useBranch, useConfig, useProject, useT } from "@/context/ConfigContext";

type Hunk = { start: number; before: string[]; base: string[]; pr: string[]; after: string[] };
type FileHunks = { path: string; hunks: Hunk[]; total: number; note?: string };
type Answer = { n: number; base?: string; baseSha?: string; head?: string; files: FileHunks[]; board: string[]; note?: string };

function Lines({ lines, from, tone }: { lines: string[]; from?: number; tone: "ctx" | "base" | "pr" }) {
  const cls =
    tone === "base"
      ? "bg-error-500/10 text-gray-800 dark:text-gray-100"
      : tone === "pr"
        ? "bg-success-500/10 text-gray-800 dark:text-gray-100"
        : "text-muted";
  return (
    <>
      {lines.map((l, i) => (
        <div key={i} className={`flex ${cls}`}>
          <span className="w-12 shrink-0 select-none pe-2 text-end text-[10.5px] text-muted/70">{from != null ? from + i : ""}</span>
          <span className="whitespace-pre">{l || " "}</span>
        </div>
      ))}
    </>
  );
}

function HunkView({ h, n, base }: { h: Hunk; n: number; base: string }) {
  const t = useT();
  const afterFrom = h.start + h.base.length;
  return (
    <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
      {(
        [
          ["base", t("prs.cf.base", { base }), h.base, "border-error-500/40"],
          ["pr", t("prs.cf.pr", { n }), h.pr, "border-success-500/40"],
        ] as const
      ).map(([k, label, body, border]) => (
        <div key={k} className={`min-w-0 overflow-hidden rounded-lg border ${border}`}>
          <div className="border-b border-line bg-strip/60 px-3 py-1 text-[11px] font-semibold text-gray-700 dark:text-gray-200">{label}</div>
          <div className="mono overflow-x-auto py-1 text-[11.5px] leading-5" dir="ltr">
            <Lines lines={h.before} from={h.start - h.before.length} tone="ctx" />
            {body.length ? (
              <Lines lines={body} from={k === "base" ? h.start : undefined} tone={k} />
            ) : (
              <div className="px-3 text-[11px] italic text-muted">{t("prs.cf.empty")}</div>
            )}
            <Lines lines={h.after} from={k === "base" ? afterFrom : undefined} tone="ctx" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ConflictView({ prs }: { prs: Pr[] }) {
  const t = useT();
  const branch = useBranch();
  const BOARD_FILE = isBoardFile(useConfig().project.boardFiles);
  const projectId = useProject().id;
  const [pick, setPick] = useState<number | null>(null);
  const [ans, setAns] = useState<Answer | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const current = prs.find((p) => p.number === pick) ?? prs[0];
  const n = current?.number;
  const head = current?.head;

  useEffect(() => {
    if (!n) return;
    let gone = false;
    setLoading(true);
    setErr(null);
    fetch(`/api/p/${projectId}/prs/conflict?n=${n}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((a: Answer) => {
        if (gone) return;
        setAns(a);
        setOpen(Object.fromEntries(a.files.map((f, i) => [f.path, i === 0])));
      })
      .catch((e) => !gone && setErr(String(e.message || e)))
      .finally(() => !gone && setLoading(false));
    return () => {
      gone = true;
    };
  }, [n, head, projectId]);

  if (!prs.length) return null;
  const files = ans && ans.n === n ? ans.files : [];

  return (
    <Card className="mb-3">
      <CardHead title={t("prs.cf.title")} desc={t("prs.cf.desc", { branch })} />
      <div className="px-3 pb-3 sm:px-3">
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          {prs.map((p) => (
            <button
              key={p.number}
              type="button"
              onClick={() => setPick(p.number)}
              title={p.title}
              className={`mono rounded-lg border px-2.5 py-1 text-[12px] transition-colors ${
                p.number === n
                  ? "border-error-500 bg-error-500/15 text-error-600 dark:text-error-400"
                  : "border-line text-gray-700 hover:border-error-500/60 dark:text-gray-200"
              }`}
            >
              #{p.number}
              <span className="ms-1 text-[10.5px] text-muted">{p.conflictFiles.filter((f) => !BOARD_FILE(f)).length}f</span>
            </button>
          ))}
        </div>

        {current && (
          <div className="mb-3 truncate text-theme-sm text-gray-800 dark:text-gray-100" dir="ltr" title={current.title}>
            <a href={current.url} target="_blank" rel="noreferrer" className="mono me-2 text-brand-600 dark:text-brand-400">
              #{current.number}
            </a>
            {current.title}
            <span className="ms-2 text-[11.5px] text-muted">
              {current.headRef} → {current.base}
            </span>
          </div>
        )}

        {loading && <p className="text-theme-sm text-muted">{t("prs.cf.loading")}</p>}
        {err && <p className="text-theme-sm text-error-500">{t("prs.cf.error", { err: err ?? "" })}</p>}
        {!loading && ans && ans.n === n && ans.note && <p className="text-theme-sm text-muted">{ans.note}</p>}
        {!loading && ans && ans.n === n && ans.board.length > 0 && (
          <p className="mb-3 text-[11.5px] text-warning-500" dir="rtl">
            {t("conflict.boardNote", { files: ans.board.map((f) => f.split("/").pop()).join(t("prs.cf.listSep")) })}
          </p>
        )}

        <div className="grid gap-2">
          {files.map((f) => {
            const isOpen = !!open[f.path];
            return (
              <div key={f.path} className="rounded-xl border border-line">
                <button
                  type="button"
                  onClick={() => setOpen((o) => ({ ...o, [f.path]: !o[f.path] }))}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-start"
                >
                  <span className="text-muted">{isOpen ? "▾" : "▸"}</span>
                  <span className="mono min-w-0 flex-1 truncate text-[12.5px] text-error-500" dir="ltr" title={f.path}>
                    {f.path}
                  </span>
                  <span className="shrink-0 text-[11.5px] text-muted">
                    {f.note ? f.note : t("prs.cf.hunks", { n: f.total })}
                    {f.total > f.hunks.length ? t("prs.cf.shown", { n: f.hunks.length }) : ""}
                  </span>
                </button>
                {isOpen && f.hunks.length > 0 && (
                  <div className="grid gap-3 border-t border-line px-3 py-1.5">
                    {f.hunks.map((h, i) => (
                      <div key={i}>
                        <div className="mb-1 text-[11px] text-muted">
                          {t("prs.cf.hunk", { i: i + 1, start: h.start, base: ans?.base ?? branch })}
                        </div>
                        <HunkView h={h} n={n!} base={ans?.base ?? branch} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

