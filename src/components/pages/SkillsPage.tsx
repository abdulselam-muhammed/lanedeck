"use client";
// /skills (machine level): the selam-deck plugin for Claude Code and how to install it, plus every skill it ships.
// The skills come from /api/skills (plugin/skills/*/SKILL.md read at runtime); the plain-language explanations
// below are keyed by skill name and only add the "what / when / example" text, so a new skill still shows up
// (with its own description) before anyone writes an explanation for it.
import React, { useEffect, useState } from "react";
import { Card, CardHead, Empty, PageHeader } from "@/components/inbox/bits";
import { Icon } from "@/components/inbox/IconSprite";
import { useT, type TFn } from "@/context/ConfigContext";

type Skill = { name: string; command: string; description: string; byYou: boolean; body: string };

const INSTALL = ["/plugin marketplace add abdulselam-muhammed/selam-deck", "/plugin install selam-deck@selam-deck"];

const btn = "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 text-theme-xs font-medium text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/[0.04]";

/** A command in a code box with a copy button. */
function CommandLine({ text, label, t }: { text: string; label?: string; t: TFn }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1400); } catch { /* clipboard blocked */ }
  };
  return (
    <div>
      {label && <p className="mb-1 text-theme-xs text-muted">{label}</p>}
      <div className="flex items-center gap-2">
        <code dir="ltr" className="mono min-w-0 flex-1 overflow-x-auto rounded-lg bg-strip px-3 py-1.5 text-theme-sm whitespace-nowrap text-gray-800 dark:text-gray-100">{text}</code>
        <button type="button" className={btn} data-copy={text} onClick={copy} aria-label={`${t("pages.skills.copy")}: ${text}`}>
          <Icon name={done ? "check" : "copy"} className="s14" />{done ? t("pages.skills.copied") : t("pages.skills.copy")}
        </button>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-theme-xs font-medium text-muted">{k}</dt>
      <dd className="mt-0.5 text-theme-sm text-gray-800 dark:text-gray-200">{v}</dd>
    </div>
  );
}

function SkillCard({ s, t }: { s: Skill; t: TFn }) {
  const known = ["init", "report", "map", "answers", "doctor"].includes(s.name);
  const ex = known ? { what: t(`pages.skills.${s.name}.what`), when: t(`pages.skills.${s.name}.when`), example: t(`pages.skills.${s.name}.example`) } : null;
  return (
    <Card className="p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span dir="ltr" className="mono text-[14px] font-semibold text-gray-900 dark:text-white">{s.command}</span>
        <span className={`rounded-full px-2 py-0.5 text-theme-xs font-medium ${s.byYou ? "bg-brand-500/15 text-brand-700 dark:bg-brand-400/20 dark:text-brand-300" : "bg-strip text-gray-600 dark:text-gray-300"}`}>{s.byYou ? t("pages.skills.you") : t("pages.skills.auto")}</span>
      </div>
      <dl className="grid gap-2.5">
        <Row k={t("pages.skills.what")} v={ex?.what ?? s.description} />
        {ex && <Row k={t("pages.skills.when")} v={ex.when} />}
        {ex && <Row k={t("pages.skills.example")} v={ex.example} />}
      </dl>
      <div className="mt-3"><CommandLine text={s.command} t={t} /></div>
      <details className="mt-3">
        <summary className="cursor-pointer text-theme-xs text-muted hover:text-gray-800 dark:hover:text-white">{t("pages.skills.instr")}</summary>
        <pre dir="ltr" className="mono mt-2 max-h-72 overflow-auto rounded-lg bg-strip p-3 text-[12px] leading-5 whitespace-pre-wrap text-gray-700 dark:text-gray-200">{s.body}</pre>
      </details>
    </Card>
  );
}

export default function SkillsPage() {
  const t = useT();
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let stop = false;
    fetch("/api/skills", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { skills: Skill[] }) => { if (!stop) setSkills(d.skills); })
      .catch(() => { if (!stop) setErr(true); });
    return () => { stop = true; };
  }, []);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader crumbs={[{ label: t("pages.skills.crumb") }]} title={t("pages.skills.title")} desc={t("pages.skills.desc")} />
      <Card className="mb-3">
        <CardHead title={t("pages.skills.installT")} desc={t("pages.skills.installD")} />
        <div className="grid gap-2 px-3 pb-3">
          <CommandLine text={INSTALL[0]} label={t("pages.skills.plugin1")} t={t} />
          <CommandLine text={INSTALL[1]} label={t("pages.skills.plugin2")} t={t} />
          <p className="mt-1 text-theme-sm text-muted">{t("pages.skills.dirNote1")}<code dir="ltr" className="mono">--plugin-dir</code>{t("pages.skills.dirNote2")}</p>
        </div>
      </Card>
      <Card className="mb-3">
        <CardHead title={t("pages.skills.othersT")} />
        <p className="px-3 pb-3 text-theme-sm text-gray-700 dark:text-gray-300">{t("pages.skills.othersD")}</p>
      </Card>
      <div className="mb-2 px-1">
        <h2 className="text-[14px] font-semibold text-gray-900 dark:text-white">{t("pages.skills.skillsT")}</h2>
        <p className="mt-1 text-theme-sm text-muted">{t("pages.skills.skillsD")}</p>
      </div>
      {err ? <Empty icon="help">{t("pages.skills.err")}</Empty> : !skills ? <p className="text-theme-sm text-muted">{t("pages.skills.loading")}</p> : skills.length === 0 ? <Empty icon="sparkles">{t("pages.skills.none")}</Empty> : (
        <div className="grid gap-3">{skills.map((s) => <SkillCard key={s.name} s={s} t={t} />)}</div>
      )}
    </div>
  );
}
