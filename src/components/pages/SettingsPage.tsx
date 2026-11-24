"use client";
// /settings: edit the deck's config. Five tabs; each saves only its own slice (over the last saved copy) with PUT /api/settings.
// The server validates with the same validator it starts with and answers 400 with the key and the message; those show inline.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardHead, PageHeader } from "@/components/inbox/bits";
import { Icon } from "@/components/inbox/IconSprite";
import { useInbox } from "@/components/inbox/InboxContext";
import { useLoad } from "@/components/load/LoadContext";
import { useConfig } from "@/context/ConfigContext";
import { useTheme } from "@/context/ThemeContext";
import { Modal } from "@/components/ui/modal";
import { SetupDialog } from "@/components/setup/Setup";
import { setupApi } from "@/lib/setup";
import {
  api, ApiError, tr, type Detected, type Devices, type MachineCfg, type Probe, type ProjectCfg, type Reviewer, type Settings, type TextKey,
} from "@/lib/settings";

const TABS = ["general", "devices", "projects", "monitoring", "advanced"] as const;
type Tab = (typeof TABS)[number];

const inputCls =
  "h-8 w-full rounded-lg border border-line bg-transparent px-2.5 text-theme-sm text-gray-800 placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-2 focus:ring-brand-500/10 dark:text-gray-100";
const btnCls = "btn";
const btnPrimary = `${btnCls} btn-tonal`;
const btnSolid = `${btnCls} btn-solid`;
const btnGhost = `${btnCls} btn-ghost`;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const orNull = (v: string) => (v.trim() ? v.trim() : null);

function Field({ label, children, hint, err }: { label: string; children: React.ReactNode; hint?: string; err?: string | null }) {
  return (
    <label className="grid gap-1">
      <span className="text-theme-xs font-medium text-gray-500 dark:text-gray-400">{label}</span>
      {children}
      {hint && <span className="text-theme-xs text-muted">{hint}</span>}
      {err && <span className="text-theme-xs text-error-600 dark:text-error-400">{err}</span>}
    </label>
  );
}
function Txt({ value, onChange, mono, ...rest }: { value: string | null | undefined; onChange: (v: string) => void; mono?: boolean } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value">) {
  return <input {...rest} className={`${inputCls} ${mono ? "mono" : ""}`} dir={mono ? "ltr" : undefined} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
}
/** A number input with a unit suffix and a range; out of range turns it red (the message is the Field's `err`). */
const outOfRange = (v: number | undefined, min: number, max: number) => typeof v !== "number" || !Number.isFinite(v) || v < min || v > max;
function Num({ value, onChange, min, max, unit, step = 1 }: { value: number | undefined; onChange: (v: number) => void; min?: number; max?: number; unit?: string; step?: number }) {
  const bad = min != null && max != null && outOfRange(value, min, max);
  return (
    <span className="relative block">
      <input
        type="number" min={min} max={max} step={step} aria-invalid={bad || undefined}
        className={`${inputCls} mono ${unit ? "pe-14" : ""} ${bad ? "border-error-400 focus:border-error-400" : ""}`} dir="ltr"
        value={Number.isNaN(value) ? "" : (value ?? "")} onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))}
      />
      {unit && <span className="pointer-events-none absolute inset-y-0 end-2.5 flex items-center text-theme-xs text-muted" dir="ltr">{unit}</span>}
    </span>
  );
}
function Select<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}
function Lines({ value, onChange, mono = true }: { value: string[]; onChange: (v: string[]) => void; mono?: boolean }) {
  return (
    <textarea
      rows={Math.max(2, value.length)}
      className={`${inputCls} h-auto py-1.5 ${mono ? "mono" : ""}`}
      dir="ltr"
      value={value.join("\n")}
      onChange={(e) => onChange(e.target.value.split("\n"))}
      onBlur={() => onChange(value.map((x) => x.trim()).filter(Boolean))}
    />
  );
}
const Chip = ({ ok, children }: { ok: boolean | null; children: React.ReactNode }) => (
  <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-theme-xs ${ok ? "bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-400" : "bg-strip text-gray-600 dark:text-gray-300"}`}>
    <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-success-500" : "bg-gray-400"}`} />
    {children}
  </span>
);
const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div className="flex items-baseline gap-2 py-1 text-theme-sm">
    <span className="w-36 shrink-0 text-theme-xs text-muted">{k}</span>
    <span className="min-w-0 break-words text-gray-800 dark:text-gray-100">{children}</span>
  </div>
);

export default function SettingsPage() {
  const cfg = useConfig();
  const lang = cfg.ui.lang;
  const t = useCallback((k: TextKey, vars?: Record<string, string | number>) => tr(lang, k, vars), [lang]);
  const { toast } = useInbox();
  const params = useSearchParams();
  const router = useRouter();
  const qTab = params.get("tab");
  const [tab, setTab] = useState<Tab>((TABS as readonly string[]).includes(qTab ?? "") ? (qTab as Tab) : "general");
  const openAdd = params.get("add") === "1";
  const [addSignal, setAddSignal] = useState(openAdd ? 1 : 0);
  // Arriving from the project switcher while this page is already open: follow the query.
  useEffect(() => {
    if (qTab && (TABS as readonly string[]).includes(qTab)) setTab(qTab as Tab);
    if (openAdd) { setAddSignal((n) => n + 1); router.replace("/settings?tab=projects", { scroll: false }); } // consume add=1 so the link works again
  }, [qTab, openAdd, router]);
  const [csrf, setCsrf] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [saved, setSaved] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [meta, setMeta] = useState<{ path: string; backups: string[] }>({ path: "", backups: [] });
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [err, setErr] = useState<{ tab: Tab; key?: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [setupFor, setSetupFor] = useState<string | null>(null); // a project just added: offer to set up selam-deck in it
  const loadNow = useLoad().data;
  const [isWin, setIsWin] = useState<boolean | null>(null);
  useEffect(() => { api.devices().then((d) => setIsWin(/win32/i.test(d.local.os))).catch(() => setIsWin(null)); }, []);

  const load = useCallback(async () => {
    try {
      const r = await api.load();
      setCsrf(r.csrf); setToken(r.accessToken ?? null); setSaved(r.settings); setDraft(clone(r.settings)); setMeta({ path: r.path, backups: r.backups });
      setLoadErr(r.invalid);
    } catch (e) { setLoadErr(e instanceof Error ? e.message : t("unreachable")); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  /** Save one slice: `pick` copies this tab's part of the draft onto a copy of the last saved settings. */
  const save = useCallback(async (which: Tab, build: (base: Settings, d: Settings) => Settings | unknown) => {
    if (!saved || !draft) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.save(csrf, build(clone(saved), draft));
      toast(t("saved"), r.restartRequired ? t("restart") : r.backup ? `${t("backup")}: ${r.backup}` : "", "done");
      await load();
      if (which === "projects") {
        // A NEW project with a local folder that has no .selam-deck/ yet: ask before writing anything.
        const was = new Set(saved.projects.map((p) => p.id));
        for (const p of draft.projects) {
          if (was.has(p.id) || !p.repoPath) continue;
          try { if (!(await setupApi.status(p.id)).exists) { setSetupFor(p.id); break; } } catch { /* the folder is not readable: nothing to offer */ }
        }
      }
    } catch (e) {
      const m = e instanceof ApiError ? e.message : e instanceof Error ? e.message : t("unreachable");
      setErr({ tab: which, key: e instanceof ApiError ? e.key : undefined, message: m });
    } finally { setBusy(false); }
  }, [saved, draft, csrf, toast, t, load]);

  if (!draft || !saved)
    return (
      <div>
        <PageHeader title={t("title")} desc={t("desc")} />
        <p className="text-theme-sm text-error-600 dark:text-error-400" dir="ltr">{loadErr || "…"}</p>
      </div>
    );
  const set = (fn: (d: Settings) => void) => setDraft((d) => { const n = clone(d!); fn(n); return n; });
  const dirty = (slice: unknown, was: unknown) => JSON.stringify(slice) !== JSON.stringify(was);
  const ErrBox = ({ for: tb }: { for: Tab }) => (err && err.tab === tb ? <p role="alert" className="rounded-lg bg-error-50 px-3 py-2 text-theme-sm text-error-700 dark:bg-error-500/15 dark:text-error-400" dir="ltr">{t("error")}: {err.message}</p> : null);
  const Foot = ({ tb, changed, onSave, onReset }: { tb: Tab; changed: boolean; onSave: () => void; onReset: () => void }) => (
    <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-1.5">
      <button className={btnSolid} disabled={busy || !changed} onClick={onSave}>{busy ? t("saving") : t("save")}</button>
      <button className={btnGhost} disabled={busy || !changed} onClick={onReset}>{t("reset")}</button>
      <div className="min-w-0 flex-1"><ErrBox for={tb} /></div>
    </div>
  );

  return (
    <div>
      <PageHeader title={t("title")} desc={t("desc")} />
      {setupFor && <SetupDialog projectId={setupFor} onClose={() => setSetupFor(null)} />}
      {loadErr && <p className="mb-3 rounded-lg bg-warning-50 px-3 py-2 text-theme-sm text-warning-700 dark:bg-warning-500/15 dark:text-warning-400" dir="ltr">{loadErr}</p>}
      <div role="tablist" className="mb-2.5 flex flex-wrap gap-1 border-b border-line">
        {TABS.map((k) => (
          <button
            key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setErr(null); }}
            className={`-mb-px border-b-2 px-3 py-2 text-theme-sm font-medium ${tab === k ? "border-brand-500 text-gray-900 dark:text-white" : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400"}`}
          >
            {t(`tab.${k}` as TextKey)}
          </button>
        ))}
      </div>

      {tab === "general" && (
        <Card>
          <div className="grid gap-2 p-3 sm:grid-cols-2">
            <Field label={t("lang")} hint={t("help.lang")} err={err?.key === "ui.lang" ? err.message : null}>
              <Select value={draft.ui.lang} onChange={(v) => set((d) => { d.ui.lang = v; d.ui.dir = v === "ar" ? "rtl" : "ltr"; })} options={[["en", "English"], ["ar", "\u0627\u0644\u0639\u0631\u0628\u064a\u0629"]]} />
            </Field>
            <Field label={t("dir")} hint={t("help.dir")}>
              <Select value={draft.ui.dir} onChange={(v) => set((d) => { d.ui.dir = v; })} options={[["ltr", "LTR"], ["rtl", "RTL"]]} />
            </Field>
            <Field label={t("pageTitle")} hint={t("help.title")} err={err?.key === "ui.title" ? err.message : null}><Txt value={draft.ui.title} onChange={(v) => set((d) => { d.ui.title = v; })} /></Field>
            <ThemeField label={t("theme")} hint={t("themeHint")} />
          </div>
          <Foot tb="general" changed={dirty(draft.ui, saved.ui)} onReset={() => set((d) => { d.ui = clone(saved.ui); })}
            onSave={() => save("general", (base, d) => { base.ui = { ...base.ui, lang: d.ui.lang, dir: d.ui.dir, title: d.ui.title }; return base; })} />
        </Card>
      )}
      {tab === "general" && <AccessToken t={t} csrf={csrf} token={token} hosts={saved.server.allowedHosts} onRotated={(v) => { setToken(v); toast(t("tok.rotated"), "", "done"); }} />}

      {tab === "devices" && (
        <DevicesTab t={t} csrf={csrf} machines={draft.machine.machines} setMachines={(m) => set((d) => { d.machine.machines = m; })} err={err?.tab === "devices" ? err.message : null}
          foot={<Foot tb="devices" changed={dirty(draft.machine.machines, saved.machine.machines)} onReset={() => set((d) => { d.machine.machines = clone(saved.machine.machines); })}
            onSave={() => save("devices", (base, d) => { base.machine.machines = d.machine.machines; return base; })} />} />
      )}

      {tab === "projects" && (
        <ProjectsTab t={t} csrf={csrf} addSignal={addSignal} projects={draft.projects} setProjects={(p) => set((d) => { d.projects = p; })} errKey={err?.tab === "projects" ? err.key : undefined} errMsg={err?.tab === "projects" ? err.message : null}
          foot={<Foot tb="projects" changed={dirty(draft.projects, saved.projects)} onReset={() => set((d) => { d.projects = clone(saved.projects); })}
            onSave={() => save("projects", (base, d) => { base.projects = d.projects; return base; })} />} />
      )}

      {tab === "monitoring" && (() => {
        const cur = loadNow?.current;
        const nowOf: Record<string, number | undefined> = { ram: cur?.ram, cpu: cur?.cpu, disk: cur?.disk };
        const showPaged = isWin ?? !!loadNow?.kernel;
        const pagedNow = loadNow?.kernel ? Math.round((loadNow.kernel.pagedMB / 1024) * 10) / 10 : undefined;
        const RANGES = { pct: [0, 100], paged: [1, 64], budget: [60, 4500] } as const;
        const bad = (["thresholds", "remoteThresholds"] as const).some((g) => (["ram", "cpu", "disk"] as const).some((k) => outOfRange(draft.machine[g][k], 0, 100)))
          || (showPaged && outOfRange(draft.machine.thresholds.pagedPoolGB, 1, 64)) || outOfRange(draft.github.rateBudgetPerHour, 60, 4500);
        const msg = (lo: number, hi: number) => t("val.range", { min: lo, max: hi });
        const pctErr = (g: "thresholds" | "remoteThresholds", k: "ram" | "cpu" | "disk") =>
          err?.key === `machine.${g}.${k}` ? err.message : outOfRange(draft.machine[g][k], 0, 100) ? msg(0, 100) : null;
        const changed = dirty([draft.machine.thresholds, draft.machine.remoteThresholds, draft.github.rateBudgetPerHour], [saved.machine.thresholds, saved.machine.remoteThresholds, saved.github.rateBudgetPerHour]);
        return (
          <Card>
            <div className="grid gap-3 p-3">
              {(["thresholds", "remoteThresholds"] as const).map((g) => (
                <div key={g}>
                  <h3 className="text-theme-sm font-semibold text-gray-900 dark:text-white">{g === "thresholds" ? t("mon.local") : t("mon.remote")}</h3>
                  <p className="mb-3 text-theme-xs text-muted">{g === "thresholds" ? t("mon.localHelp") : t("mon.remoteHelp")}</p>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {(["ram", "cpu", "disk"] as const).map((k) => (
                      <Field key={k} label={`${k.toUpperCase()} %`} hint={`${g === "thresholds" ? t(`mon.${k}.help` as TextKey) : t("mon.remote.help")}${g === "thresholds" && nowOf[k] != null ? ` (${t("mon.now")} ${Math.round(nowOf[k]!)}%)` : ""}`} err={pctErr(g, k)}>
                        <Num value={draft.machine[g][k]} min={RANGES.pct[0]} max={RANGES.pct[1]} unit={t("mon.unitPct")} onChange={(v) => set((d) => { d.machine[g][k] = v; })} />
                      </Field>
                    ))}
                    {g === "thresholds" && showPaged && (
                      <Field label={t("pagedPool")} hint={`${t("mon.paged.help")}${pagedNow != null ? ` (${t("mon.now")} ${pagedNow} GB)` : ""}`}
                        err={err?.key === "machine.thresholds.pagedPoolGB" ? err.message : outOfRange(draft.machine.thresholds.pagedPoolGB, 1, 64) ? msg(1, 64) : null}>
                        <Num value={draft.machine.thresholds.pagedPoolGB} min={RANGES.paged[0]} max={RANGES.paged[1]} step={0.5} unit={t("mon.unitGB")} onChange={(v) => set((d) => { d.machine.thresholds.pagedPoolGB = v; })} />
                      </Field>
                    )}
                  </div>
                </div>
              ))}
              <div>
                <h3 className="text-theme-sm font-semibold text-gray-900 dark:text-white">GitHub</h3>
                <p className="mb-3 text-theme-xs text-muted">{t("mon.githubHelp")}</p>
                <div className="sm:max-w-sm">
                  <Field label={t("mon.github")} hint={t("mon.github.help")}
                    err={err?.key === "github.rateBudgetPerHour" ? err.message : outOfRange(draft.github.rateBudgetPerHour, 60, 4500) ? msg(60, 4500) : null}>
                    <Num value={draft.github.rateBudgetPerHour} min={RANGES.budget[0]} max={RANGES.budget[1]} unit={t("mon.unitReq")} onChange={(v) => set((d) => { d.github.rateBudgetPerHour = v; })} />
                  </Field>
                </div>
              </div>
              {bad && <p role="alert" className="text-theme-xs text-error-600 dark:text-error-400">{t("val.fix")}</p>}
            </div>
            <Foot tb="monitoring" changed={changed && !bad}
              onReset={() => set((d) => { d.machine.thresholds = clone(saved.machine.thresholds); d.machine.remoteThresholds = clone(saved.machine.remoteThresholds); d.github.rateBudgetPerHour = saved.github.rateBudgetPerHour; })}
              onSave={() => save("monitoring", (base, d) => { base.machine.thresholds = d.machine.thresholds; base.machine.remoteThresholds = d.machine.remoteThresholds; base.github.rateBudgetPerHour = d.github.rateBudgetPerHour; return base; })} />
          </Card>
        );
      })()}

      {tab === "advanced" && <AdvancedTab t={t} saved={saved} path={meta.path} busy={busy} err={err?.tab === "advanced" ? err.message : null} onSave={(obj) => save("advanced", () => obj)} />}
    </div>
  );
}

function ThemeField({ label, hint }: { label: string; hint: string }) {
  const { theme, toggleTheme } = useTheme();
  return (
    <Field label={label} hint={hint}>
      <button type="button" className={`${btnGhost} justify-start`} onClick={toggleTheme}>
        <Icon name={theme === "light" ? "sun" : theme === "dark" ? "moon" : "monitor"} className="s14" /> {theme}
      </button>
    </Field>
  );
}

/** Settings -> General: the remote-access token (server.accessToken), with copy and rotate (a PUT with the CSRF token). */
function AccessToken({ t, csrf, token, hosts, onRotated }: {
  t: (k: TextKey, vars?: Record<string, string | number>) => string; csrf: string; token: string | null; hosts: string[]; onRotated: (v: string) => void;
}) {
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const rotate = async () => {
    if (token && !window.confirm(t("tok.confirm"))) return;
    setBusy(true); setErr(null);
    try { onRotated((await api.rotateToken(csrf)).accessToken); setShown(true); }
    catch (e) { setErr(e instanceof Error ? e.message : t("unreachable")); }
    finally { setBusy(false); }
  };
  const link = token && hosts[0] ? `https://${hosts[0]}/?token=${token}` : null;
  const copy = async () => {
    try { await navigator.clipboard.writeText(link || token || ""); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* no clipboard */ }
  };
  return (
    <Card className="mt-3">
      <div className="grid gap-2 p-3">
        <Field label={t("tok.title")} hint={t("tok.help")} err={err}>
          {token ? (
            <span className="flex flex-wrap items-center gap-2">
              <input readOnly className={`${inputCls} mono min-w-0 flex-1`} dir="ltr" type={shown ? "text" : "password"} value={link && shown ? link : token} onFocus={(e) => e.currentTarget.select()} />
              <button type="button" className={btnGhost} onClick={() => setShown((s) => !s)}>{shown ? t("tok.hide") : t("tok.show")}</button>
              <button type="button" className={btnGhost} onClick={copy}>{copied ? t("tok.copied") : t("tok.copy")}</button>
              <button type="button" className={btnPrimary} disabled={busy || !csrf} onClick={rotate}>{busy ? t("tok.rotating") : t("tok.rotate")}</button>
            </span>
          ) : (
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-theme-sm text-gray-600 dark:text-gray-300">{t("tok.none")}</span>
              <button type="button" className={btnPrimary} disabled={busy || !csrf} onClick={rotate}>{busy ? t("tok.rotating") : t("tok.create")}</button>
            </span>
          )}
        </Field>
      </div>
    </Card>
  );
}

function DevicesTab({ t, csrf, machines, setMachines, err, foot }: {
  t: (k: TextKey, vars?: Record<string, string | number>) => string; csrf: string; machines: MachineCfg[]; setMachines: (m: MachineCfg[]) => void; err: string | null; foot: React.ReactNode;
}) {
  const [dev, setDev] = useState<Devices | null>(null);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<string>("local");
  const refresh = useCallback((force = false) => { api.devices(force).then(setDev).catch(() => setDev(null)); }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const l = dev?.local;
  const selected = machines.find((m) => m.id === sel);
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card>
        <CardHead title={t("dev.configured")}>
          <button className={btnGhost} onClick={() => refresh(true)}><Icon name="loader" className="s14" />{t("refresh")}</button>
          <button className={btnPrimary} onClick={() => setOpen(true)}><Icon name="plus" className="s14" />{t("dev.add")}</button>
        </CardHead>
        <ul className="divide-y divide-line border-t border-line">
          <li>
            <button className={`flex w-full items-center gap-2 px-3 py-2 text-start text-theme-sm ${sel === "local" ? "bg-strip" : ""}`} onClick={() => setSel("local")}>
              <Icon name="monitor" className="s14" /><span className="flex-1 truncate">{l?.label ?? "…"}</span><Chip ok>{t("dev.local")}</Chip>
            </button>
          </li>
          {machines.map((m) => (
            <li key={m.id} className={`flex items-center gap-2 px-3 py-2 ${sel === m.id ? "bg-strip" : ""}`}>
              <button className="flex min-w-0 flex-1 items-center gap-2 text-start text-theme-sm" onClick={() => setSel(m.id)}>
                <Icon name="terminal" className="s14" /><span className="truncate">{m.label || m.id}</span><span className="mono truncate text-theme-xs text-muted" dir="ltr">{m.sshAlias || m.ssh}</span>
              </button>
              <button className={btnGhost} title={t("remove")} onClick={() => { setMachines(machines.filter((x) => x.id !== m.id)); if (sel === m.id) setSel("local"); }}><Icon name="x" className="s14" /></button>
            </li>
          ))}
          {!machines.length && <li className="px-3 py-1.5 text-theme-sm text-muted">{t("dev.none")}</li>}
        </ul>
        {err && <p className="px-3 pb-2 text-theme-sm text-error-600" dir="ltr">{err}</p>}
        {foot}
      </Card>
      <Card>
        <CardHead title={selected ? selected.label || selected.id : t("dev.local")} />
        <div className="border-t border-line px-3 py-1.5">
          {sel === "local" && l && (
            <>
              <Row k={t("dev.os")}><span dir="ltr">{l.os}</span></Row>
              <Row k={t("dev.host")}><span dir="ltr">{l.hostname}</span></Row>
              <Row k={t("dev.cpu")}><span dir="ltr">{l.cpu.model} · {l.cpu.threads}</span></Row>
              <Row k={t("dev.ram")}><span dir="ltr">{l.ramGB} GB</span></Row>
              <Row k={t("dev.wsl")}><span dir="ltr">{l.wslDistros.join(", ") || "—"}</span></Row>
              <Row k={t("dev.docker")}><Chip ok={l.docker.available}>{l.docker.available ? `${t("yes")} (${l.docker.via})` : t("no")}</Chip></Row>
              <Row k={t("dev.gh")}><Chip ok={l.gh.loggedIn}>{l.gh.loggedIn ? `${t("loggedIn")}${l.gh.user ? ` · ${l.gh.user}` : ""}` : t("notLoggedIn")}</Chip></Row>
            </>
          )}
          {sel === "local" && !l && <p className="text-theme-sm text-muted">…</p>}
          {selected && <Row k={t("dev.alias")}><span className="mono" dir="ltr">{selected.sshAlias || selected.ssh}</span></Row>}
          {selected && <ProbeBox t={t} csrf={csrf} alias={selected.sshAlias || selected.ssh || ""} />}
          <h4 className="mt-4 mb-1 text-theme-xs font-semibold tracking-wider text-muted uppercase">{t("dev.services")}</h4>
          <div className="grid gap-1.5">
            {([
              ["dev.ci", sel === "local" ? !!l?.services.ciRunner.detected : null, sel === "local" ? (l?.services.ciRunner.detected ? t("detected") : t("notDetected")) : "—"],
              ["dev.mon", sel === "local" ? true : null, sel === "local" ? t("on") : "—"],
              ["dev.dock", sel === "local" ? !!l?.services.docker.on : null, sel === "local" ? (l?.services.docker.on ? t("on") : t("off")) : "—"],
            ] as [TextKey, boolean | null, string][]).map(([k, ok, label]) => (
              <div key={k} className="flex items-center gap-2 text-theme-sm">
                <span className="w-28">{t(k)}</span><Chip ok={ok}>{label}</Chip>
                <button className={`${btnGhost} ms-auto`} disabled title={t("dev.soon")}>{t("dev.enable")} · {t("dev.soon")}</button>
              </div>
            ))}
          </div>
        </div>
      </Card>
      <AddDevice t={t} csrf={csrf} open={open} onClose={() => setOpen(false)} taken={machines.map((m) => m.id)}
        onAdd={(m) => { setMachines([...machines, m]); setSel(m.id); setOpen(false); }} />
    </div>
  );
}

function ProbeBox({ t, csrf, alias }: { t: (k: TextKey, vars?: Record<string, string | number>) => string; csrf: string; alias: string }) {
  const [p, setP] = useState<Probe | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setP(null); }, [alias]);
  const run = async () => {
    setBusy(true); setP(null);
    try { setP(await api.test(csrf, alias)); } catch (e) { setP({ ok: false, error: e instanceof Error ? e.message : "error" }); } finally { setBusy(false); }
  };
  return (
    <div className="mt-2">
      <button className={btnGhost} disabled={busy || !alias} onClick={run}>{busy ? t("dev.testing") : t("dev.test")}</button>
      {p && <Caps t={t} p={p} />}
    </div>
  );
}
function Caps({ t, p }: { t: (k: TextKey, vars?: Record<string, string | number>) => string; p: Probe }) {
  if (!p.ok) return <p className="mt-2 text-theme-sm text-error-600 dark:text-error-400" dir="ltr">{p.error}</p>;
  return (
    <div className="mt-2 rounded-lg border border-line px-3 py-1.5">
      <p className="text-theme-xs font-semibold text-muted">{t("dev.caps")}</p>
      <Row k="uname"><span className="mono text-theme-xs" dir="ltr">{p.uname}</span></Row>
      <Row k={t("dev.cpu")}><span dir="ltr">{p.cpus ?? "—"}</span></Row>
      <Row k={t("dev.ram")}><span dir="ltr">{p.ramMB != null ? `${Math.round(p.ramMB / 102.4) / 10} GB` : "—"}</span></Row>
      <Row k={t("dev.docker")}><Chip ok={!!p.docker}>{p.docker ?? t("no")}</Chip></Row>
    </div>
  );
}

function AddDevice({ t, csrf, open, onClose, onAdd, taken }: {
  t: (k: TextKey, vars?: Record<string, string | number>) => string; csrf: string; open: boolean; onClose: () => void; onAdd: (m: MachineCfg) => void; taken: string[];
}) {
  const [label, setLabel] = useState("");
  const [alias, setAlias] = useState("");
  const [p, setP] = useState<Probe | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setLabel(""); setAlias(""); setP(null); } }, [open]);
  const id = useMemo(() => {
    const base = (label || alias).toLowerCase().replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20) || "machine";
    let n = base, i = 2;
    while (taken.includes(n) || n === "local") n = `${base}-${i++}`;
    return n;
  }, [label, alias, taken]);
  const test = async () => {
    setBusy(true); setP(null);
    try { setP(await api.test(csrf, alias.trim())); } catch (e) { setP({ ok: false, error: e instanceof Error ? e.message : "error" }); } finally { setBusy(false); }
  };
  return (
    <Modal isOpen={open} onClose={onClose} className="max-w-md p-3 sm:p-3">
      <h3 className="mb-2.5 text-[14px] font-semibold text-gray-900 dark:text-white">{t("dev.add")}</h3>
      <div className="grid gap-2">
        <Field label={t("dev.label")}><Txt value={label} onChange={setLabel} /></Field>
        <Field label={t("dev.alias")}><Txt mono value={alias} onChange={(v) => { setAlias(v); setP(null); }} /></Field>
        <div><button className={btnGhost} disabled={busy || !alias.trim()} onClick={test}>{busy ? t("dev.testing") : t("dev.test")}</button></div>
        {p && <Caps t={t} p={p} />}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button className={btnGhost} onClick={onClose}>{t("cancel")}</button>
        <button className={btnSolid} disabled={!alias.trim()} onClick={() => onAdd({ id, label: label.trim() || id, sshAlias: alias.trim() })}>{t("add")}</button>
      </div>
    </Modal>
  );
}

const emptyProject = (id: string): ProjectCfg => ({
  id, name: id, repoPath: null, repo: null, defaultBranch: "main", gateCheck: null, inboxDir: null, claudeProjectDir: null, me: null,
  reviewers: [], reviewMarkers: { fail: ["CHANGES REQUESTED", "NOT PASS"], ask: ["what is missing", "\\bFIX\\b"], pass: ["^\\W*(APPROVE[DS]?|LGTM)"] }, boardFiles: [], holds: {}, profile: null,
});

function ProjectsTab({ t, csrf, addSignal, projects, setProjects, errKey, errMsg, foot }: {
  t: (k: TextKey, vars?: Record<string, string | number>) => string; csrf: string; addSignal?: number; projects: ProjectCfg[]; setProjects: (p: ProjectCfg[]) => void; errKey?: string; errMsg: string | null; foot: React.ReactNode;
}) {
  const [edit, setEdit] = useState<number | null>(null);
  const [adding, setAdding] = useState(!!addSignal);
  useEffect(() => { if (addSignal) setAdding(true); }, [addSignal]);
  const patch = (i: number, fn: (p: ProjectCfg) => void) => { const n = clone(projects); fn(n[i]); setProjects(n); };
  return (
    <div className="grid gap-3">
      <Card>
        <CardHead title={t("tab.projects")} desc={t("prj.first")}>
          <button className={btnPrimary} onClick={() => setAdding(true)}><Icon name="plus" className="s14" />{t("prj.add")}</button>
        </CardHead>
        <ul className="divide-y divide-line border-t border-line">
          {projects.map((p, i) => (
            <li key={i} className="flex items-center gap-2 px-3 py-2 text-theme-sm">
              <span className="font-medium">{p.name}</span>
              <span className="mono truncate text-theme-xs text-muted" dir="ltr">{p.repo ?? p.repoPath ?? ""}</span>
              {i === 0 && <Chip ok>1</Chip>}
              <button className={`${btnGhost} ms-auto`} onClick={() => setEdit(edit === i ? null : i)}>{t("edit")}</button>
              <button className={btnGhost} title={t("remove")} disabled={projects.length < 2} onClick={() => { setProjects(projects.filter((_, j) => j !== i)); setEdit(null); }}><Icon name="x" className="s14" /></button>
            </li>
          ))}
          {!projects.length && <li className="px-3 py-1.5 text-theme-sm text-muted">{t("prj.none")}</li>}
        </ul>
        {errMsg && <p role="alert" className="px-3 pb-2 text-theme-sm text-error-600 dark:text-error-400" dir="ltr">{errMsg}</p>}
        {foot}
      </Card>
      {edit != null && projects[edit] && (
        <Card><ProjectForm t={t} p={projects[edit]} k={`projects[${edit}]`} errKey={errKey} errMsg={errMsg} onChange={(fn) => patch(edit, fn)} /></Card>
      )}
      <AddProject t={t} csrf={csrf} open={adding} onClose={() => setAdding(false)}
        onAdd={(p) => { setProjects([...projects, p]); setEdit(projects.length); setAdding(false); }} taken={projects.map((p) => p.id)} />
    </div>
  );
}

function ProjectForm({ t, p, k, errKey, errMsg, onChange, detected }: {
  t: (k: TextKey, vars?: Record<string, string | number>) => string; p: ProjectCfg; k: string; errKey?: string; errMsg: string | null; onChange: (fn: (p: ProjectCfg) => void) => void; detected?: Detected | null;
}) {
  const e = (f: string) => (errKey && errKey.startsWith(`${k}.${f}`) ? errMsg : null);
  const rev = p.reviewers;
  const setRev = (i: number, f: keyof Reviewer, v: string) => onChange((x) => { x.reviewers[i] = { ...x.reviewers[i], [f]: v }; });
  return (
    <div className="grid gap-2 p-3 sm:grid-cols-2">
      <Field label={t("prj.name")} hint={t("help.name")} err={e("name") || e("id")}><Txt value={p.name} onChange={(v) => onChange((x) => { x.name = v; })} /></Field>
      <Field label={t("prj.repo")} hint={t("help.repo")} err={e("repo")}><Txt mono value={p.repo} placeholder="owner/name" onChange={(v) => onChange((x) => { x.repo = orNull(v); })} /></Field>
      <Field label={t("prj.path")} hint={t("help.path")} err={e("repoPath")}><Txt mono value={p.repoPath} onChange={(v) => onChange((x) => { x.repoPath = orNull(v); })} /></Field>
      <Field label={t("prj.branch")} hint={t("help.branch")} err={e("defaultBranch")}><Txt mono value={p.defaultBranch} onChange={(v) => onChange((x) => { x.defaultBranch = v; })} /></Field>
      <Field label={t("prj.gate")} hint={t("help.gate")} err={e("gateCheck")}>
        <Txt mono placeholder="not set" value={p.gateCheck} list={`checks-${k}`} onChange={(v) => onChange((x) => { x.gateCheck = orNull(v); })} />
        {detected && <datalist id={`checks-${k}`}>{detected.checks.map((c) => <option key={c} value={c} />)}</datalist>}
      </Field>
      <Field label={t("prj.me")} hint={t("help.me")} err={e("me")}><Txt mono value={p.me} onChange={(v) => onChange((x) => { x.me = orNull(v); })} /></Field>
      <Field label={t("prj.inbox")} hint={t("help.inbox")} err={e("inboxDir")}><Txt mono value={p.inboxDir} onChange={(v) => onChange((x) => { x.inboxDir = orNull(v); })} /></Field>
      <Field label={t("prj.claude")} err={e("claudeProjectDir")} hint={`${t("help.claude")}${detected ? ` — ${detected.claudeProjectDirExists ? t("prj.exists") : t("prj.missing")}` : ""}`}>
        <Txt mono value={p.claudeProjectDir} onChange={(v) => onChange((x) => { x.claudeProjectDir = orNull(v); })} />
      </Field>
      <Field label={t("prj.profile")} hint={t("help.profile")} err={e("profile")}><Txt mono value={p.profile} onChange={(v) => onChange((x) => { x.profile = orNull(v); })} /></Field>
      {detected && detected.checks.length > 0 && (
        <Field label={t("prj.checks")}><span className="mono text-theme-xs text-muted" dir="ltr">{detected.checks.join(" · ")}</span></Field>
      )}
      <div className="sm:col-span-2">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-theme-xs font-medium text-gray-500 dark:text-gray-400">{t("prj.reviewers")}<span className="ms-2 font-normal text-muted">{t("help.reviewers")}</span></span>
          <button className={btnGhost} onClick={() => onChange((x) => { x.reviewers.push({ login: "", name: "", role: "" }); })}><Icon name="plus" className="s14" />{t("add")}</button>
        </div>
        {rev.map((r, i) => (
          <div key={i} className="mb-1.5 grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
            <Txt mono placeholder={t("prj.login")} value={r.login} onChange={(v) => setRev(i, "login", v)} />
            <Txt placeholder={t("prj.rname")} value={r.name} onChange={(v) => setRev(i, "name", v)} />
            <Txt placeholder={t("prj.role")} value={r.role} onChange={(v) => setRev(i, "role", v)} />
            <button className={btnGhost} title={t("remove")} onClick={() => onChange((x) => { x.reviewers.splice(i, 1); })}><Icon name="x" className="s14" /></button>
          </div>
        ))}
        {e("reviewers") && <span className="text-theme-xs text-error-600">{e("reviewers")}</span>}
      </div>
      <div className="grid gap-2 sm:col-span-2 sm:grid-cols-3">
        <span className="text-theme-xs font-medium text-gray-500 sm:col-span-3 dark:text-gray-400">{t("prj.markers")}<span className="ms-2 font-normal text-muted">{t("help.markers")}</span></span>
        {(["fail", "ask", "pass"] as const).map((n) => (
          <Field key={n} label={t(`prj.${n}` as TextKey)} hint={t(`help.${n}` as TextKey)} err={e("reviewMarkers")}>
            <Lines value={p.reviewMarkers[n]} onChange={(v) => onChange((x) => { x.reviewMarkers[n] = v; })} />
          </Field>
        ))}
      </div>
    </div>
  );
}

function AddProject({ t, csrf, open, onClose, onAdd, taken }: {
  t: (k: TextKey, vars?: Record<string, string | number>) => string; csrf: string; open: boolean; onClose: () => void; onAdd: (p: ProjectCfg) => void; taken: string[];
}) {
  const [path, setPath] = useState("");
  const [d, setD] = useState<Detected | null>(null);
  const [p, setP] = useState<ProjectCfg | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setPath(""); setD(null); setP(null); setErr(null); } }, [open]);
  const detect = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.detect(csrf, path.trim());
      setD(r);
      let id = r.name.toLowerCase().replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "project", n = id, i = 2;
      while (taken.includes(n)) n = `${id}-${i++}`;
      id = n;
      setP({ ...emptyProject(id), name: r.name, repoPath: r.repoPath, repo: r.repo, defaultBranch: r.defaultBranch || "main", claudeProjectDir: r.claudeProjectDir, gateCheck: r.checks.find((c) => /gate|ci/i.test(c)) ?? null });
    } catch (e) { setD(null); setP(null); setErr(e instanceof Error ? e.message : "error"); } finally { setBusy(false); }
  };
  return (
    <Modal isOpen={open} onClose={onClose} className="max-w-3xl p-3 sm:p-3">
      <h3 className="mb-2.5 text-[14px] font-semibold text-gray-900 dark:text-white">{t("prj.add")}</h3>
      <div className="flex items-end gap-2">
        <div className="flex-1"><Field label={t("prj.path")}><Txt mono value={path} placeholder="C:/Users/me/code/project" onChange={setPath} onKeyDown={(e) => { if (e.key === "Enter" && path.trim()) void detect(); }} /></Field></div>
        <button className={btnPrimary} disabled={busy || !path.trim()} onClick={detect}>{busy ? t("prj.detecting") : t("prj.detect")}</button>
      </div>
      {err && <p role="alert" className="mt-2 text-theme-sm text-error-600 dark:text-error-400" dir="ltr">{err}</p>}
      {d?.checksError && <p className="mt-2 text-theme-xs text-muted" dir="ltr">{d.checksError}</p>}
      {p && <div className="mt-2 max-h-[55vh] overflow-y-auto rounded-lg border border-line"><ProjectForm t={t} p={p} k="new" errMsg={null} detected={d} onChange={(fn) => setP((x) => { const n = clone(x!); fn(n); return n; })} /></div>}
      <div className="mt-3 flex justify-end gap-2">
        <button className={btnGhost} onClick={onClose}>{t("cancel")}</button>
        <button className={btnSolid} disabled={!p} onClick={() => p && onAdd(p)}>{t("add")}</button>
      </div>
    </Modal>
  );
}

function AdvancedTab({ t, saved, path, busy, err, onSave }: {
  t: (k: TextKey, vars?: Record<string, string | number>) => string; saved: Settings; path: string; busy: boolean; err: string | null; onSave: (obj: unknown) => void;
}) {
  const initial = useMemo(() => JSON.stringify(saved, null, 2), [saved]);
  const [text, setText] = useState(initial);
  const [shown, setShown] = useState(false);
  useEffect(() => { setText(initial); }, [initial]);
  let parseErr: string | null = null;
  let parsed: unknown = null;
  try { parsed = JSON.parse(text); } catch (e) { parseErr = e instanceof Error ? e.message : "invalid JSON"; }
  return (
    <Card>
      <div className="grid gap-2 p-3">
        <p className="text-theme-sm text-muted">{t("adv.hint")}</p>
        <p className="mono text-theme-xs text-muted" dir="ltr">{t("adv.path")}: {path}</p>
        {!shown && (
          <div><button className={btnGhost} onClick={() => setShown(true)}><Icon name="pencil" className="s14" />{t("adv.edit")}</button></div>
        )}
        {shown && (
          <>
            <p role="note" className="rounded-lg bg-warning-50 px-3 py-2 text-theme-sm text-warning-700 dark:bg-warning-500/15 dark:text-warning-400">{t("adv.warn")}</p>
            <textarea
              aria-label="JSON" spellCheck={false} dir="ltr" rows={24} value={text} onChange={(e) => setText(e.target.value)}
              className={`${inputCls} mono h-auto py-2 text-theme-xs leading-5 ${parseErr ? "border-error-400" : ""}`}
            />
            {(parseErr || err) && <p role="alert" className="text-theme-sm text-error-600 dark:text-error-400" dir="ltr">{parseErr || err}</p>}
          </>
        )}
      </div>
      {shown && (
        <div className="flex flex-wrap gap-2 border-t border-line px-3 py-2">
          <button className={btnSolid} disabled={busy || !!parseErr || text === initial} onClick={() => onSave(parsed)}>{busy ? t("saving") : t("save")}</button>
          <button className={btnGhost} disabled={!!parseErr} onClick={() => setText(JSON.stringify(parsed, null, 2))}>{t("adv.format")}</button>
          <button className={btnGhost} disabled={text === initial} onClick={() => setText(initial)}>{t("reset")}</button>
          <button className={`${btnGhost} ms-auto`} disabled={text !== initial} onClick={() => setShown(false)}>{t("adv.hide")}</button>
        </div>
      )}
    </Card>
  );
}
