"use client";
// The Inbox archive's interface: the per-file Archive button, the selection bar of the list (multi-select, "read files older than
// N days"), and the Archive tab (search, date filter, source filter, restore one / selected / all). Agent files go through
// src/lib/inbox/archive.ts; the server never deletes anything (server/archive.mjs). Archived GitHub notifications are in the
// same view (src/lib/notify/useNotify.ts; kept in lanedeck only, nothing is written to GitHub).
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { archiveFiles, ARCHIVE_CHANGED, ArchivedItem, listArchived, restoreArchived } from "@/lib/inbox/archive";
import type { InboxFile } from "@/lib/inbox/model";
import { isReadme } from "@/lib/inbox/model";
import { useProject, useT } from "@/context/ConfigContext";
import { useInbox } from "./InboxContext";
import { Icon } from "./IconSprite";
import { Empty, Seg } from "./bits";
import { useNotify, type GhItem } from "@/lib/notify/useNotify";
import { GhLine } from "@/components/notify/NotifyList";
import { useConfirm } from "@/components/ui/dialog/DialogProvider";

const KNOWN = new Set(["locked", "clash", "missing", "open-question", "too-new", "bad-path", "unsafe", "no-manifest", "verify-failed", "failed", "request"]);
type TFn = (k: string, v?: Record<string, string | number>) => string;
const errText = (t: TFn, code: string) => t("inbox.archive.err." + (KNOWN.has(code) ? code : "failed"));
/** "name.md: reason; other.md: reason" for the first few problems. */
const why = (t: TFn, list: { name: string; code: string }[]) => list.slice(0, 3).map((x) => `${x.name} (${errText(t, x.code)})`).join("; ") + (list.length > 3 ? " …" : "");

// ---------- selection (the list column) ----------
type Sel = { on: boolean; picked: Set<string>; toggle: (name: string) => void };
const SelCtx = createContext<Sel>({ on: false, picked: new Set(), toggle: () => {} });
export const useSelection = () => useContext(SelCtx);

const DAY = 864e5;
const OLDER = [7, 14, 30, 60, 90];

/** "This file still has an open question - archive it anyway?" as the in-app dialog. */
function useConfirmOpenQuestion() {
  const t = useT();
  const confirm = useConfirm();
  return () => confirm({
    title: t("inbox.archive.confirmOpenTitle"), body: t("inbox.archive.confirmOpen"), confirmLabel: t("inbox.archive.confirmOpenDo"), tone: "danger", icon: "archive",
  });
}

/** The selection state of the list plus its bar. `children` is the list itself. */
export function SelectableList({ children }: { children: React.ReactNode }) {
  const { files, unreadOf, toast } = useInbox();
  const { id } = useProject();
  const t = useT();
  const [on, setOn] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const confirmOpenQuestion = useConfirmOpenQuestion();
  const toggle = useCallback((name: string) => setPicked((s) => { const n = new Set(s); if (n.has(name)) n.delete(name); else n.add(name); return n; }), []);
  const stop = () => { setOn(false); setPicked(new Set()); };
  // "read, nothing open, last changed more than `days` days ago": the same rule the server enforces again
  const older = useMemo(() => {
    const cut = Date.now() - days * DAY;
    return files.filter((f) => !isReadme(f) && !unreadOf(f) && f.questions.length === 0 && f.mtime < cut).map((f) => f.name);
  }, [files, unreadOf, days]);

  const run = async (names: string[], o: { skipOpenQuestions?: boolean; olderThanDays?: number }) => {
    if (!names.length || busy) return;
    setBusy(true);
    try {
      const r = await archiveFiles(id, names, o);
      if (r.archived.length) toast(t("inbox.archive.done", { n: r.archived.length }), t("inbox.archive.doneBody"), "done");
      if (r.skipped.length) toast(t("inbox.archive.skipped", { n: r.skipped.length, why: why(t, r.skipped) }), "", "question");
      setPicked(new Set());
    } catch (e) {
      toast(t("inbox.archive.err.request"), errText(t, (e as { code?: string }).code ?? "request"), "question");
    } finally { setBusy(false); }
  };
  const confirmOpen = async (names: string[]) => {
    const open = files.filter((f) => names.includes(f.name) && f.questions.length > 0).length;
    return !open || (await confirmOpenQuestion());
  };

  return (
    <SelCtx.Provider value={{ on, picked, toggle }}>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2">
        <button type="button" className={`btn ${on ? "btn-tonal" : "btn-ghost"}`} aria-pressed={on} onClick={() => (on ? stop() : setOn(true))}>
          <Icon name="list-checks" className="s14" />
          {on ? t("inbox.archive.selectDone") : t("inbox.archive.select")}
        </button>
      </div>
      {on && (
        <div className="grid gap-2 border-b border-line bg-strip/50 px-3 py-2" role="region" aria-label={t("inbox.archive.action")}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-theme-xs font-medium text-gray-600 tnum dark:text-gray-300">{t("inbox.archive.selected", { n: picked.size })}</span>
            <button type="button" className="btn btn-tonal ms-auto" disabled={!picked.size || busy} onClick={async () => { if (await confirmOpen([...picked])) run([...picked], {}); }}>
              <Icon name="archive" className="s14" />
              {t("inbox.archive.selectedBtn")}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2" title={t("inbox.archive.olderHelp")}>
            <label className="flex items-center gap-1.5 text-theme-xs text-gray-600 dark:text-gray-300">
              {t("inbox.archive.olderLabel")}
              <select className="rounded-md border border-line bg-card px-1.5 py-1 text-theme-xs" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                {OLDER.map((d) => <option key={d} value={d}>{t("inbox.archive.olderDays", { n: d })}</option>)}
              </select>
            </label>
            <button type="button" className="btn btn-ghost ms-auto" disabled={!older.length || busy} onClick={() => run(older, { skipOpenQuestions: true, olderThanDays: days })}>
              <Icon name="archive" className="s14" />
              {t("inbox.archive.olderBtn", { n: older.length })}
            </button>
          </div>
        </div>
      )}
      {children}
    </SelCtx.Provider>
  );
}

/** How many items are archived (refetched when the archive changes and when the inbox changes). */
export function useArchivedCount() {
  const { id } = useProject();
  const { tree } = useInbox();
  const [n, setN] = useState<number | null>(null);
  const size = tree.nodes.size;
  useEffect(() => {
    let live = true;
    const load = () => listArchived(id).then((l) => live && setN(l.filter((i) => !i.missing).length)).catch(() => {});
    load();
    window.addEventListener(ARCHIVE_CHANGED, load);
    return () => { live = false; window.removeEventListener(ARCHIVE_CHANGED, load); };
  }, [id, size]);
  return n;
}

// ---------- the per-file button ----------
export function ArchiveFileButton({ f }: { f: InboxFile }) {
  const { id, base } = useProject();
  const { toast } = useInbox();
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const confirmOpenQuestion = useConfirmOpenQuestion();
  if (isReadme(f)) return null;
  const go = async () => {
    if (f.questions.length > 0 && !(await confirmOpenQuestion())) return;
    setBusy(true);
    try {
      const r = await archiveFiles(id, [f.name]);
      if (r.archived.length) { toast(t("inbox.archive.done", { n: 1 }), t("inbox.archive.doneBody"), "done"); router.push(base + "/inbox"); }
      else toast(t("inbox.archive.err.request"), why(t, r.skipped), "question");
    } catch (e) {
      toast(t("inbox.archive.err.request"), errText(t, (e as { code?: string }).code ?? "request"), "question");
    } finally { setBusy(false); }
  };
  return (
    <button type="button" className="btn btn-ghost" disabled={busy} onClick={go} title={t("inbox.archive.actionTip")}>
      <Icon name="archive" className="s14" />
      {t("inbox.archive.action")}
    </button>
  );
}

// ---------- the Archived view ----------
const dateOk = (at: string, f: string) => {
  const age = Date.now() - Date.parse(at);
  return f === "any" || (f === "7" ? age <= 7 * DAY : f === "30" ? age <= 30 * DAY : age > 30 * DAY);
};

export type ArchiveSrc = "all" | "agents" | "github";
/** One row of the Archived view: an archived agent file, or an archived GitHub notification (local; restored on new activity). */
type Row = { key: string; src: "agents" | "github"; at: string; text: string; agent?: ArchivedItem; gh?: GhItem; usable: boolean };

/**
 * The Archived view: archived agent files (moved into the inbox's .archive folder) and archived GitHub notifications (kept in
 * lanedeck only) in one list, newest archived first, with a source filter. `agents: false` (the all-projects page) lists
 * the GitHub side only; `ghScope` is the GitHub scope ("all" or a project id).
 */
export function ArchivedPanel({ ghScope, agents = true }: { ghScope?: string; agents?: boolean }) {
  const { id } = useProject();
  const { toast } = useInbox();
  const t = useT();
  const confirm = useConfirm();
  const gh = useNotify(ghScope ?? id);
  const [items, setItems] = useState<ArchivedItem[] | null>(agents ? null : []);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState("");
  const [date, setDate] = useState("any");
  const [src, setSrc] = useState<ArchiveSrc>(agents ? "all" : "github");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => (agents ? listArchived(id).then((l) => { setItems(l); setFailed(false); }).catch(() => setFailed(true)) : Promise.resolve()), [id, agents]);
  useEffect(() => { load(); }, [load]);

  const ghRows = gh.data?.archived;
  const all = useMemo<Row[]>(() => [
    ...(items ?? []).map((i): Row => ({ key: "a:" + i.id, src: "agents", at: i.archivedAt, text: `${i.title ?? ""} ${i.original} ${i.id}`, agent: i, usable: !i.missing })),
    ...(ghRows ?? []).map((g): Row => ({ key: "g:" + g.id, src: "github", at: g.archivedAt ?? g.at, text: `${g.title} ${g.repo}#${g.number ?? ""} ${g.actor ?? ""} ${g.ref ?? ""}`, gh: g, usable: true })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)), [items, ghRows]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((r) => (src === "all" || r.src === src) && dateOk(r.at, date) && (!needle || r.text.toLowerCase().includes(needle)));
  }, [all, src, q, date]);
  const usable = shown.filter((r) => r.usable);
  const inSrc = all.filter((r) => r.usable && (src === "all" || r.src === src));
  const toggle = (k: string) => setPicked((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const nA = all.filter((r) => r.src === "agents").length;
  const nG = all.filter((r) => r.src === "github").length;

  const restore = async (keys: string[]) => {
    if (busy || !keys.length) return;
    setBusy(true);
    try {
      const a = keys.filter((k) => k.startsWith("a:")).map((k) => k.slice(2));
      const g = keys.filter((k) => k.startsWith("g:")).map((k) => k.slice(2));
      let done = 0;
      if (g.length) done += await gh.restore(g);
      if (a.length) {
        const r = await restoreArchived(id, a);
        done += r.restored.length;
        const renamed = r.restored.filter((x) => x.renamed).length;
        if (renamed) toast(t("inbox.archive.restoredRenamed", { n: renamed }), "", "");
        if (r.failed.length) toast(t("inbox.archive.failed", { n: r.failed.length, why: r.failed.slice(0, 3).map((x) => errText(t, x.code)).join("; ") }), "", "question");
        await load();
      }
      if (done) toast(t("inbox.archive.restored", { n: done }), t("inbox.archive.restoredBody"), "done");
      setPicked(new Set());
    } catch (e) {
      toast(t("inbox.archive.err.request"), errText(t, (e as { code?: string }).code ?? "request"), "question");
    } finally { setBusy(false); }
  };
  const restoreAll = async () => {
    const ok = await confirm({
      title: t("inbox.archive.restoreAllConfirm", { n: inSrc.length }), body: t("inbox.archive.restoreAllBody"),
      confirmLabel: t("inbox.archive.restoreAll"), icon: "archive-restore",
    });
    if (ok) restore(inSrc.map((r) => r.key));
  };
  const pickedKeys = [...picked].filter((k) => usable.some((r) => r.key === k));
  const loading = (agents && !items && !failed) || (!gh.data && !gh.failed && src !== "agents");

  return (
    <div className="panel-smoke overflow-hidden rounded-xl border border-line/70 bg-card shadow-theme-xs">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
        <span className="text-theme-xs text-gray-500 tnum dark:text-gray-400">{t("inbox.archive.count", { n: all.length })}</span>
        {agents && (
          <Seg<ArchiveSrc>
            label={t("ntf.arch.srcLabel")} value={src} onChange={(v) => { setSrc(v); setPicked(new Set()); }} className="ms-auto w-full max-w-sm"
            items={[
              { v: "all", label: t("ntf.tabs.all"), n: all.length },
              { v: "agents", label: <span className="inline-flex items-center gap-1.5"><Icon name="bot" className="s14" />{t("ntf.tabs.agents")}</span>, n: nA },
              { v: "github", label: <span className="inline-flex items-center gap-1.5"><Icon name="github" className="s14" />{t("ntf.tabs.github")}</span>, n: nG },
            ]}
          />
        )}
      </div>
      <p className="border-b border-line px-3 py-2 text-theme-xs text-gray-500 dark:text-gray-400">
        {agents && src !== "github" && t("inbox.archive.intro")} {src !== "agents" && t("ntf.arch.intro")}
      </p>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <input
          type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("ntf.arch.search")} aria-label={t("ntf.arch.search")}
          className="min-w-[200px] flex-1 rounded-md border border-line bg-card px-2.5 py-1.5 text-theme-sm"
        />
        <select aria-label={t("inbox.archive.dateLabel")} value={date} onChange={(e) => setDate(e.target.value)} className="rounded-md border border-line bg-card px-2 py-1.5 text-theme-sm">
          <option value="any">{t("inbox.archive.dateAny")}</option>
          <option value="7">{t("inbox.archive.date7")}</option>
          <option value="30">{t("inbox.archive.date30")}</option>
          <option value="older">{t("inbox.archive.dateOlder")}</option>
        </select>
        <label className="flex items-center gap-1.5 text-theme-xs text-gray-600 dark:text-gray-300">
          <input
            type="checkbox" checked={usable.length > 0 && usable.every((r) => picked.has(r.key))} disabled={!usable.length}
            onChange={(e) => setPicked(e.target.checked ? new Set(usable.map((r) => r.key)) : new Set())}
          />
          {t("inbox.archive.selectAll")}
        </label>
        <button type="button" className="btn btn-tonal" disabled={!pickedKeys.length || busy} onClick={() => restore(pickedKeys)}>
          <Icon name="archive-restore" className="s14" />{t("inbox.archive.restoreSelected")}{pickedKeys.length ? ` (${pickedKeys.length})` : ""}
        </button>
        <button
          type="button" className="btn btn-ghost" disabled={!inSrc.length || busy}
          onClick={restoreAll}
        >
          {t("inbox.archive.restoreAll")}
        </button>
      </div>
      {failed && src !== "github" ? <Empty icon="alert">{t("inbox.archive.loadFailed")}</Empty>
        : loading && !all.length ? <Empty icon="loader">{t("inbox.archive.loading")}</Empty>
        : !all.length ? <Empty icon="archive">{t("inbox.archive.empty")}</Empty>
        : !shown.length ? <Empty icon="search">{t("inbox.archive.noMatch")}</Empty>
        : (
          <ul className="custom-scrollbar max-h-[calc(100dvh-330px)] min-h-[200px] divide-y divide-line overflow-y-auto">
            {shown.map((r) => r.gh ? (
              <GhLine
                key={r.key} it={r.gh} source onRead={gh.markRead} onUnread={gh.markUnread} onRestore={() => restore([r.key])}
                pick={{ checked: picked.has(r.key), toggle: () => toggle(r.key) }}
              />
            ) : (
              <AgentArchivedRow key={r.key} i={r.agent!} busy={busy} checked={picked.has(r.key)} onToggle={() => toggle(r.key)} onRestore={() => restore([r.key])} />
            ))}
          </ul>
        )}
    </div>
  );
}

function AgentArchivedRow({ i, busy, checked, onToggle, onRestore }: { i: ArchivedItem; busy: boolean; checked: boolean; onToggle: () => void; onRestore: () => void }) {
  const t = useT();
  return (
    <li className="flex items-start gap-2.5 px-3 py-2.5">
      <input type="checkbox" className="mt-1" disabled={i.missing} checked={checked} onChange={onToggle} aria-label={i.title || i.original} />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <span dir="auto" className="truncate text-theme-sm font-medium text-gray-800 dark:text-gray-100">{i.title || i.original}</span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-gray-500 dark:text-gray-400">
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-400 dark:text-gray-500"><Icon name="bot" className="s14" />{t("ntf.src.agent")}</span>
          <span dir="ltr" className="mono truncate">{t("inbox.archive.was")} {i.original}</span>
          <span className="tnum">{t("inbox.archive.dateLabel")} {new Date(i.archivedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span>
          <span className="tag">{t("inbox.archive.by." + i.by)}</span>
          {i.missing && <span className="text-error-600 dark:text-error-400">{t("inbox.archive.missing")}</span>}
        </span>
      </div>
      <button type="button" className="btn btn-ghost shrink-0" disabled={i.missing || busy} onClick={onRestore}>
        <Icon name="archive-restore" className="s14" />{t("inbox.archive.restore")}
      </button>
    </li>
  );
}
