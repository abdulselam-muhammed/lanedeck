"use client";
// "Set up lanedeck in this project": the confirm dialog shown after a new project is added, the copy-prompt buttons
// (task page of 00-setup.md and the overview card) and the AGENTS.md / CLAUDE.md preview dialog. Nothing is written
// before a confirm; the writes themselves are in server/setup.mjs.
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Modal } from "@/components/ui/modal";
import { Icon } from "@/components/inbox/IconSprite";
import { useConfig } from "@/context/ConfigContext";
import { setupApi, setupText, type InstructionsResult, type SetupResult, type SetupStatus } from "@/lib/setup";

const btn = "btn";
const btnPrimary = `${btn} btn-tonal`;
const btnSolid = `${btn} btn-solid`;
const btnGhost = `${btn} btn-ghost`;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function useStatus(id: string, on = true) {
  const [s, setS] = useState<SetupStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const reload = useCallback(() => setupApi.status(id).then(setS).catch((e) => setErr(msg(e))), [id]);
  useEffect(() => { if (on) void reload(); }, [on, reload]);
  return { s, setS, err, reload };
}

/** The confirm dialog: lists exactly what will be written, with the .gitignore change as its own checkbox. */
export function SetupDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const t = setupText(useConfig().ui.lang);
  const { s, err } = useStatus(projectId);
  const [ignore, setIgnore] = useState(true);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<SetupResult | null>(null);
  const [e2, setE2] = useState<string | null>(null);
  const go = async () => {
    setBusy(true); setE2(null);
    try { setRes(await setupApi.run(projectId, ignore)); } catch (e) { setE2(msg(e)); } finally { setBusy(false); }
  };
  const row = (path: string, why: string, there: boolean) => (
    <li key={path} className="flex flex-wrap items-baseline gap-x-2 rounded-lg bg-strip px-3 py-1.5">
      <code dir="ltr" className="mono text-theme-sm text-gray-900 dark:text-white">{path}</code>
      <span className="text-theme-xs text-muted">{why}{there ? ` · ${t("dlg.exists")}` : ""}</span>
    </li>
  );
  return (
    <Modal isOpen onClose={onClose} className="max-w-xl p-4 sm:p-5">
      <div role="dialog" aria-label={t("dlg.title")} data-testid="setup-dialog" className="grid gap-3">
        <h2 className="px-10 text-lg font-semibold text-gray-900 dark:text-white">{res ? t("dlg.done") : t("dlg.title")}</h2>
        {res ? (
          <>
            <ul className="grid gap-1.5" dir="ltr">{res.created.map((f) => <li key={f} className="mono text-theme-sm">+ {f}</li>)}{res.existed.map((f) => <li key={f} className="mono text-theme-sm text-muted">= {f} ({t("dlg.exists")})</li>)}{res.gitignore === "added" && <li className="mono text-theme-sm">+ .gitignore: {res.status.gitignore.line}</li>}</ul>
            <p className="text-theme-sm text-gray-700 dark:text-gray-300">{t("dlg.next")}</p>
            <div className="flex justify-end gap-2">
              <button className={btnGhost} onClick={onClose}>{t("ins.close")}</button>
              <Link className={btnPrimary} href={`/p/${projectId}/inbox/00-setup.md`} onClick={onClose}>{t("card.task")}</Link>
            </div>
          </>
        ) : !s ? (
          <p className="text-theme-sm text-muted" dir="ltr">{err ?? "…"}</p>
        ) : (
          <>
            <p className="text-theme-sm text-gray-700 dark:text-gray-300">{t("dlg.lead")}</p>
            <ul className="grid gap-1.5">
              {row(".lanedeck/PROTOCOL.md", t("dlg.protocol"), s.files.protocol)}
              {row(".lanedeck/inbox/00-setup.md", t("dlg.setup"), s.files.setup)}
            </ul>
            <label className="flex items-start gap-2 text-theme-sm text-gray-800 dark:text-gray-200">
              <input type="checkbox" className="mt-1" checked={ignore} onChange={(e) => setIgnore(e.target.checked)} data-testid="setup-ignore" />
              <span>{t("dlg.ignore")}</span>
            </label>
            {ignore && (
              <div>
                <div className="mb-1 text-theme-xs text-muted">{t("dlg.diff")}{s.gitignore.hasLine ? ` · ${t("dlg.exists")}` : ""}</div>
                <pre dir="ltr" className="mono m-0 overflow-auto rounded-lg border border-line bg-strip p-2 text-[12px] leading-5" data-testid="setup-diff">{`--- a/.gitignore\n+++ b/.gitignore\n${s.gitignore.hasLine ? " " + s.gitignore.line + "  (already present, no change)" : "+" + s.gitignore.line}`}</pre>
              </div>
            )}
            {e2 && <p role="alert" className="text-theme-sm text-error-600 dark:text-error-400" dir="ltr">{t("err")}: {e2}</p>}
            <div className="flex justify-end gap-2">
              <button className={btnGhost} onClick={onClose} disabled={busy}>{t("dlg.later")}</button>
              <button className={btnSolid} onClick={go} disabled={busy} data-testid="setup-go">{busy ? t("dlg.working") : t("dlg.go")}</button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/** Preview + confirm for the AGENTS.md / CLAUDE.md block. */
export function InstructionsDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const t = setupText(useConfig().ui.lang);
  const { s, setS, err } = useStatus(projectId);
  const [pick, setPick] = useState<Record<string, boolean>>({});
  const [create, setCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<InstructionsResult | null>(null);
  const [e2, setE2] = useState<string | null>(null);
  useEffect(() => { if (s) setPick((p) => (Object.keys(p).length ? p : Object.fromEntries(s.instructions.filter((i) => i.exists && !i.hasBlock).map((i) => [i.name, true])))); }, [s]);
  const files = s ? s.instructions.filter((i) => (i.exists && !i.hasBlock && pick[i.name]) || (create && i.name === "AGENTS.md" && !i.exists)).map((i) => i.name) : [];
  const go = async () => {
    setBusy(true); setE2(null);
    try { const r = await setupApi.instructions(projectId, files, create); setOut(r); setS(r.status); } catch (e) { setE2(msg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal isOpen onClose={onClose} className="max-w-xl p-4 sm:p-5">
      <div role="dialog" aria-label={t("ins.title")} data-testid="instructions-dialog" className="grid gap-3">
        <h2 className="px-10 text-lg font-semibold text-gray-900 dark:text-white">{t("ins.title")}</h2>
        {!s ? (
          <p className="text-theme-sm text-muted" dir="ltr">{err ?? "…"}</p>
        ) : (
          <>
            <p className="text-theme-sm text-gray-700 dark:text-gray-300">{t("ins.lead")}</p>
            <pre dir="ltr" className="mono m-0 overflow-auto rounded-lg border border-line bg-strip p-2 text-[12px] leading-5 whitespace-pre-wrap" data-testid="instructions-block">{s.block.trimEnd()}</pre>
            <ul className="grid gap-1.5">
              {s.instructions.map((i) => (
                <li key={i.name}>
                  <label className="flex items-center gap-2 text-theme-sm text-gray-800 dark:text-gray-200">
                    <input type="checkbox" disabled={!i.exists || i.hasBlock} checked={!!pick[i.name] && i.exists && !i.hasBlock} onChange={(e) => setPick((p) => ({ ...p, [i.name]: e.target.checked }))} data-testid={`pick-${i.name}`} />
                    <code dir="ltr" className="mono">{i.name}</code>
                    <span className="text-theme-xs text-muted">{!i.exists ? t("ins.missing") : i.hasBlock ? t("ins.has") : ""}</span>
                  </label>
                </li>
              ))}
              {!s.instructions.find((i) => i.name === "AGENTS.md")?.exists && (
                <li><label className="flex items-center gap-2 text-theme-sm text-gray-800 dark:text-gray-200"><input type="checkbox" checked={create} onChange={(e) => setCreate(e.target.checked)} data-testid="create-agents" />{t("ins.create")}</label></li>
              )}
            </ul>
            {out && <p className="text-theme-sm text-gray-700 dark:text-gray-300" dir="ltr" data-testid="instructions-result">{t("ins.result")}: {[...out.written, ...out.created].join(", ") || t("ins.none")}{out.already.length ? ` · ${out.already.join(", ")} ${t("ins.has")}` : ""}</p>}
            {e2 && <p role="alert" className="text-theme-sm text-error-600 dark:text-error-400" dir="ltr">{t("err")}: {e2}</p>}
            <div className="flex justify-end gap-2">
              <button className={btnGhost} onClick={onClose}>{t("ins.close")}</button>
              <button className={btnSolid} onClick={go} disabled={busy || files.length === 0} data-testid="instructions-go">{t("ins.go")}</button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/** The copy-prompt buttons and the AGENTS.md / CLAUDE.md button. Hidden when the local-only API does not answer (a tunnel). */
export function SetupActions({ projectId }: { projectId: string }) {
  const t = setupText(useConfig().ui.lang);
  const { s } = useStatus(projectId);
  const [copied, setCopied] = useState("");
  const [dlg, setDlg] = useState(false);
  if (!s) return null;
  const copy = async (key: "plugin" | "any") => {
    try { await navigator.clipboard.writeText(s.prompts[key]); setCopied(key); setTimeout(() => setCopied(""), 1400); } catch { /* clipboard blocked */ }
  };
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="setup-actions">
      <button type="button" className={btnPrimary} data-copy={s.prompts.plugin} data-testid="copy-plugin" onClick={() => copy("plugin")}>
        <Icon name={copied === "plugin" ? "check" : "copy"} className="s14" />{copied === "plugin" ? t("btn.copied") : t("btn.plugin")}
      </button>
      <button type="button" className={btnGhost} data-copy={s.prompts.any} data-testid="copy-any" onClick={() => copy("any")}>
        <Icon name={copied === "any" ? "check" : "copy"} className="s14" />{copied === "any" ? t("btn.copied") : t("btn.any")}
      </button>
      <button type="button" className={btnGhost} data-testid="open-instructions" onClick={() => setDlg(true)}>
        <Icon name="file-text" className="s14" />{t("btn.agents")}
      </button>
      {dlg && <InstructionsDialog projectId={projectId} onClose={() => setDlg(false)} />}
    </div>
  );
}

/** Overview card of a protocol project that has no project.md or map.md yet. */
export function SetupCard({ projectId, base, aiDone = false }: { projectId: string; base: string; aiDone?: boolean }) {
  const t = setupText(useConfig().ui.lang);
  const [busy, setBusy] = useState(false);
  const finish = async () => { setBusy(true); try { await setupApi.done(projectId); } catch { /* shown again on the next snapshot */ } finally { setBusy(false); } };
  if (aiDone)
    return (
      <section className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-card p-4" data-testid="setup-review-card">
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">{t("card.review")}</h2>
          <p className="text-theme-sm text-muted">{t("card.reviewDesc")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`${base}/flow`} className="text-theme-sm font-medium text-brand-600 underline underline-offset-4 dark:text-brand-400">{t("card.map")}</Link>
          <Link href={`${base}/inbox/00-setup.md`} className="text-theme-sm font-medium text-brand-600 underline underline-offset-4 dark:text-brand-400">{t("card.task")}</Link>
          <button type="button" className={btnSolid} disabled={busy} onClick={finish} data-testid="setup-done">{t("card.done")}</button>
        </div>
      </section>
    );
  return (
    <section className="mb-3 grid gap-2 rounded-xl border border-line bg-card p-4" data-testid="setup-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">{t("card.title")}</h2>
          <p className="text-theme-sm text-muted">{t("card.desc")}</p>
        </div>
        <Link href={`${base}/inbox/00-setup.md`} className="text-theme-sm font-medium text-brand-600 underline underline-offset-4 dark:text-brand-400">{t("card.task")}</Link>
      </div>
      <SetupActions projectId={projectId} />
    </section>
  );
}
