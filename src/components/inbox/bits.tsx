"use client";
// Small shared pieces: the status chip and LED of a node, the open-questions pill, empty states,
// and the redesign's building blocks (card head, page head, KPI row, segmented tabs, mini bar, logo).
import React from "react";
import Image from "next/image";
import Link from "next/link";
import { CHIP_LABEL, stateKey, TreeNode } from "@/lib/inbox/model";
import { Icon } from "./IconSprite";
import { useConfig, useMark, useT } from "@/context/ConfigContext";

const CHIP_CLASS = { run: "run", wait: "runs", subrun: "runs", idle: "idle", blocked: "blocked", done: "done" } as const;

export function Chip({ n }: { n: TreeNode }) {
  const k = stateKey(n);
  if (k === "info") return null;
  return (
    <span className={`chip ${CHIP_CLASS[k]}`}>
      <span className="dot" />
      {CHIP_LABEL[k]}
    </span>
  );
}

export function Led({ n }: { n: TreeNode }) {
  const k = stateKey(n);
  if (k === "info") return <Icon name="file-text" className="text-gray-400" />;
  return <span className={`led ${CHIP_CLASS[k]}`} title={CHIP_LABEL[k]} />;
}

export function QPill({ n, title }: { n: number; title?: string }) {
  const t = useT();
  return (
    <span
      title={title ?? t("inbox.q.open")}
      className="inline-flex items-center gap-1 rounded-full bg-strip text-gray-600 dark:text-gray-300 px-2 py-0.5 text-theme-xs font-semibold tnum"
    >
      <Icon name="help" className="s14" />
      {n}
    </span>
  );
}

const ACCENT_TONE = "bg-brand-500/15 text-brand-700 dark:bg-brand-400/20 dark:text-brand-300";
export type BadgeTone = "gray" | "brand" | "info" | "warning" | "success" | "error";
export function CountBadge({ children, tone = "gray" }: { children: React.ReactNode; tone?: BadgeTone }) {
  const tones: Record<BadgeTone, string> = {
    // Every normal count uses the accent (brand) tokens; red is reserved for "error" (a real alert).
    gray: ACCENT_TONE,
    brand: ACCENT_TONE,
    info: ACCENT_TONE,
    warning: ACCENT_TONE,
    success: ACCENT_TONE,
    error: "bg-error-50 text-error-600 dark:bg-error-500/15 dark:text-error-400",
  };
  return (
    <span className={`inline-flex min-w-6 items-center justify-center rounded-full px-1.5 text-theme-xs font-semibold leading-5 mono ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Empty({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <div className="grid justify-items-center gap-2 px-3 py-20 text-center text-theme-sm text-gray-500 dark:text-gray-400">
      <Icon name={icon} className="h-7! w-7! text-gray-400" />
      {children}
    </div>
  );
}

/** Rounded TailAdmin card (ComponentCard): rounded-xl, grey border, no shadow. */
export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-line bg-card ${className}`}>{children}</div>
  );
}

/** Card head (Aurora): title + one line of description, actions (e.g. "View all") on the other side. */
export function CardHead({ title, desc, children }: { title: React.ReactNode; desc?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 px-3 pt-3 pb-3">
      <div className="min-w-0">
        <h2 className="text-[14px] font-semibold text-gray-900 dark:text-white">{title}</h2>
        {desc && <p className="mt-1 text-theme-sm text-muted">{desc}</p>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}

/** "View all" link in a card head. */
export function MoreLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-theme-sm font-medium text-gray-700 underline-offset-4 hover:underline dark:text-gray-200">
      {children}
      <Icon name="arrow-left" className="s14 ltr:rotate-180" />
    </Link>
  );
}

/** Page head (TailAdmin PageBreadCrumb): small crumbs, the title, a description line, the page's buttons opposite. */
export function PageHeader({
  crumbs,
  title,
  desc,
  children,
}: {
  crumbs?: { label: string; href?: string }[];
  title: React.ReactNode;
  desc?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const t = useT();
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div className="min-w-0">
        {crumbs && crumbs.length > 0 && (
          <nav aria-label={t("inbox.bits.crumbs")} className="mb-1 flex flex-wrap items-center gap-1 text-theme-xs text-gray-500 dark:text-gray-400">
            {crumbs.map((c, i) => (
              <React.Fragment key={i}>
                {c.href ? (
                  <Link href={c.href} className="hover:text-gray-800 dark:hover:text-gray-200">
                    {c.label}
                  </Link>
                ) : (
                  <span>{c.label}</span>
                )}
                <span aria-hidden="true">/</span>
              </React.Fragment>
            ))}
          </nav>
        )}
        <h1 className="text-[17px] leading-7 font-bold text-gray-900 dark:text-white">{title}</h1>
        {desc && <p className="mt-1 text-theme-sm text-muted">{desc}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export type Tone = "run" | "warning" | "brand" | "success" | "error" | "violet" | "gray";
export type Kpi = {
  key: string;
  label: string;
  value: React.ReactNode;
  /** the small line under the number; "see" is its accent part (Aurora's "See … Traffic sources"). */
  sub?: React.ReactNode;
  see?: string;
  icon?: string;
  tone?: Tone;
  href?: string;
  onClick?: () => void;
  hot?: boolean;
  title?: string;
};
// Rounded-square icon chips: a tinted background and a coloured line icon, one hue per metric.
export const TONE_TILE: Record<Tone, string> = {
  run: "bg-gray-500/10 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400",
  warning: "bg-gray-500/10 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400",
  brand: "bg-gray-500/10 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400",
  success: "bg-gray-500/10 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400",
  error: "bg-error-500/10 text-error-600 dark:bg-error-500/15 dark:text-error-400",
  violet: "bg-gray-500/10 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400",
  gray: "bg-gray-500/10 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400",
};

const ACCENT: Record<Tone, string> = {
  run: "bg-brand-500/70",
  warning: "bg-warning-500/80",
  brand: "bg-brand-500/70",
  success: "bg-success-500/70",
  error: "bg-error-500",
  violet: "bg-brand-500/50",
  gray: "bg-gray-400/40 dark:bg-gray-500/40",
};
/**
 * The KPI row: separate floating tiles (no shared box). Each tile: a small muted label and a tinted round icon chip, the big
 * number, one short line, and a thin accent bar on the start edge. Only an `error` tile with a value above zero turns red;
 * everything else stays calm. The whole tile is the link; hover lifts it, keyboard focus draws a ring.
 */
export function KpiStrip({ items, cols = "grid-cols-2 md:grid-cols-3 xl:grid-cols-5" }: { items: Kpi[]; cols?: string }) {
  const t = useT();
  return (
    <section aria-label={t("inbox.bits.summary")} className={`mb-3 grid gap-2.5 ${cols}`}>
      {items.map((k) => {
        const tone = k.tone ?? "gray";
        const alert = k.hot !== false && tone === "error";
        const body = (
          <>
            <span aria-hidden="true" className={`absolute inset-y-3 start-0 w-[3px] rounded-e-full ${alert ? ACCENT.error : k.hot === false ? ACCENT.gray : ACCENT[tone]}`} />
            <span className="flex w-full min-w-0 items-center gap-2">
              <span className="truncate text-theme-xs font-medium text-muted">{k.label}</span>
              {k.icon && (
                <span className={`ms-auto grid h-7 w-7 shrink-0 place-items-center rounded-full ${alert ? TONE_TILE.error : TONE_TILE[tone === "error" ? "gray" : tone]}`}>
                  <Icon name={k.icon} className="s14" />
                </span>
              )}
            </span>
            <span className="mt-2 text-[26px] leading-9 font-semibold text-gray-900 tnum dark:text-white">{k.value}</span>
            {(k.sub || k.see) && (
              <span className="mt-1 block w-full truncate text-theme-xs text-muted">
                {k.sub}
                {k.see && (
                  <span className="ms-1 inline-flex items-center gap-1 font-medium text-gray-500 transition-colors group-hover:text-brand-600 dark:text-gray-400 dark:group-hover:text-brand-400">
                    {k.see}
                    <Icon name="arrow-left" className="s14 ltr:rotate-180" />
                  </span>
                )}
              </span>
            )}
          </>
        );
        const cls =
          "group relative flex min-w-0 flex-col items-start overflow-hidden rounded-xl border border-line/60 bg-card p-3 ps-4 text-start shadow-theme-xs shadow-[inset_0_1px_0_rgba(255,255,255,.05)] transition duration-150 hover:-translate-y-0.5 hover:shadow-theme-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 motion-reduce:transition-none motion-reduce:hover:translate-y-0";
        return k.href ? (
          <Link key={k.key} href={k.href} onClick={k.onClick} title={k.title} className={cls}>
            {body}
          </Link>
        ) : (
          <button key={k.key} type="button" onClick={k.onClick} title={k.title} className={cls}>
            {body}
          </button>
        );
      })}
    </section>
  );
}

/** Segmented tabs (TailAdmin): the label, an optional counter. */
export function Seg<T extends string>({
  value,
  onChange,
  items,
  label,
  className = "",
}: {
  value: T;
  onChange: (v: T) => void;
  items: { v: T; label: React.ReactNode; n?: number; tone?: BadgeTone }[];
  label: string;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={`flex gap-1 rounded-lg bg-strip p-1 ${className}`}>
      {items.map((x) => (
        <button
          key={x.v}
          type="button"
          role="tab"
          aria-selected={value === x.v}
          onClick={() => onChange(x.v)}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-theme-xs font-medium whitespace-nowrap transition ${
 value === x.v ? "bg-card text-gray-900 shadow-theme-xs dark:bg-white/10 dark:text-white" : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white"
 }`}
        >
          {x.label}
          {x.n !== undefined && <CountBadge tone={x.tone}>{x.n}</CountBadge>}
        </button>
      ))}
    </div>
  );
}

/** A thin progress bar in the node's status colour (tables, the active-agents card). */
export function MiniBar({ n, pct }: { n: TreeNode; pct: number }) {
  const k = stateKey(n);
  const hue = k === "run" ? "var(--st-run)" : k === "wait" || k === "subrun" ? "var(--st-you)" : k === "blocked" ? "var(--st-blocked)" : k === "idle" ? "var(--st-idle)" : "var(--st-done)";
  // Running = the bright tone; every other state = a deeper tone of its own hue. The track is a deep tint of the same hue.
  const fill = k === "run" ? hue : `color-mix(in srgb, ${hue} 66%, #000)`;
  const w = Math.max(0, Math.min(100, pct));
  return (
    <span className="block h-3.5 w-full min-w-16 overflow-hidden rounded-full" style={{ background: `color-mix(in srgb, ${hue} 14%, transparent)` }} role="presentation">
      <span className="block h-full rounded-full transition-[width] duration-700" style={{ width: `${w}%`, minWidth: w > 0 ? 14 : 0, background: fill }} />
    </span>
  );
}

/** The app mark: the neutral selam-deck mark, or the images ui.brand points to (light and dark variants). */
export function Logo({ folded }: { folded?: boolean }) {
  const mark = useMark();
  const { ui } = useConfig();
  // Branded: one logo per theme (light on light, dark on dark). Neutral: one small tile for both.
  const size = mark.branded ? (folded ? "h-11 w-auto" : "h-20 w-auto") : folded ? "h-9 w-9" : "h-12 w-12";
  return (
    <span className={folded ? "grid h-11 w-11 shrink-0 place-items-center" : "flex w-full justify-center py-1"}>
      <Image src={mark.light} alt={ui.title} width={437} height={437} priority unoptimized={!mark.branded} className={`${size} ${mark.branded ? "dark:hidden" : ""}`} />
      {mark.branded && (
        <Image src={mark.dark} alt={ui.title} width={437} height={437} priority className={`${size} hidden drop-shadow-[0_0_10px_rgba(34,211,238,0.35)] dark:block`} />
      )}
    </span>
  );
}
