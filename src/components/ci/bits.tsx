"use client";
// Small shared pieces of the /ci page: status icons, owner chips, filter selects, badges.
import React from "react";
import { Person } from "@/lib/ci/model";

const AVATAR = "https://avatars.githubusercontent.com/";
const CIRCLE = "M8 16A8 8 0 1 1 8 0a8 8 0 0 1 0 16Z";
/** A job / step status as a small round icon in the status hues (DESIGN.md); shape carries the meaning too. */
export function StatusIcon({ kind, className = "h-4 w-4" }: { kind: string; className?: string }) {
  const base = `${className} shrink-0`;
  switch (kind) {
    case "success":
      return (
        <svg viewBox="0 0 16 16" className={`${base} text-success-600 dark:text-success-400`} aria-label="success" role="img">
          <path fill="currentColor" d={`${CIRCLE}m3.78-9.72a.751.751 0 0 0-1.06-1.06L6.75 9.19 5.28 7.72a.751.751 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0Z`} />
        </svg>
      );
    case "failure":
    case "error":
    case "timed_out":
    case "startup_failure":
      return (
        <svg viewBox="0 0 16 16" className={`${base} text-error-600 dark:text-error-400`} aria-label="failed" role="img">
          <path
            fill="currentColor"
            d="M2.343 13.657A8 8 0 1 1 13.658 2.343 8 8 0 0 1 2.343 13.657ZM6.03 4.97a.751.751 0 0 0-1.042.018.751.751 0 0 0-.018 1.042L6.94 8 4.97 9.97a.749.749 0 0 0 .326 1.275.749.749 0 0 0 .734-.215L8 9.06l1.97 1.97a.749.749 0 0 0 1.275-.326.749.749 0 0 0-.215-.734L9.06 8l1.97-1.97a.749.749 0 0 0-.326-1.275.749.749 0 0 0-.734.215L8 6.94Z"
          />
        </svg>
      );
    case "in_progress":
    case "preparing":
    case "unknown":
      return (
        <svg viewBox="0 0 16 16" className={`${base} animate-spin`} style={{ color: "var(--st-run)" }} aria-label="running" role="img">
          <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M8 1.5a6.5 6.5 0 1 0 6.5 6.5" />
        </svg>
      );
    case "queued":
    case "pending":
    case "waiting":
    case "requested":
      return (
        <svg viewBox="0 0 16 16" className={base} style={{ color: "var(--st-you)" }} aria-label="queued" role="img">
          <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.5 2.5" />
          <circle cx="8" cy="8" r="2.5" fill="currentColor" />
        </svg>
      );
    case "cancelled":
      return (
        <svg viewBox="0 0 16 16" className={`${base} text-gray-400`} aria-label="cancelled" role="img">
          <path
            fill="currentColor"
            d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 0 0 10.535 5.096l-9.131-9.131A6.472 6.472 0 0 0 1.5 8Zm2.465-5.096 9.131 9.131A6.5 6.5 0 0 0 3.965 2.904Z"
          />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 16 16" className={`${base} text-gray-400`} aria-label="skipped" role="img">
          <path fill="currentColor" d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm3.25-.75h6.5a.75.75 0 0 1 0 1.5h-6.5a.75.75 0 0 1 0-1.5Z" />
        </svg>
      );
  }
}

/** A person: avatar (only from GitHub's avatar host) and login, linking to the profile. */
export function Who({ p, tag }: { p: Person | null | undefined; tag: string }) {
  if (!p || !p.login) return null;
  // The server sends the avatar as the path after the avatar host; only that host is ever used.
  const full = p.avatar ? (p.avatar.startsWith("https://") ? p.avatar : `${AVATAR}${p.avatar}`) : null;
  const av = full && full.startsWith(AVATAR) && /^[\w/?=&.-]+$/.test(full.slice(AVATAR.length)) ? `${full}${full.includes("?") ? "&" : "?"}s=40` : null;
  return (
    <a
      href={`https://github.com/${encodeURIComponent(p.login)}`}
      target="_blank"
      rel="noopener noreferrer"
      title={tag}
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1 align-middle text-gray-700 underline-offset-2 hover:underline dark:text-gray-300"
    >
      {av && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={av} width={16} height={16} alt="" referrerPolicy="no-referrer" className="h-4 w-4 rounded-full" />
      )}
      {p.login}
    </a>
  );
}

export function Pill({ children, tone = "gray", title }: { children: React.ReactNode; tone?: "gray" | "error"; title?: string }) {
  const t = {
    gray: "bg-strip text-gray-600 dark:text-gray-300",
    error: "bg-error-50 text-error-600 dark:bg-error-500/15 dark:text-error-400",
  }[tone];
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-full px-2 text-theme-xs leading-5 font-medium whitespace-nowrap ${t}`}>
      {children}
    </span>
  );
}

export function Dot({ hue, pulse }: { hue: "run" | "ok" | "you" | "off"; pulse?: boolean }) {
  const c = { run: "var(--st-run)", ok: "var(--st-done)", you: "var(--st-you)", off: "var(--st-idle)" }[hue];
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${pulse ? "breathe" : ""}`} style={{ background: c }} />;
}

export function FilterSelect({ value, onChange, first, options, label }: { value: string; onChange: (v: string) => void; first: string; options: [string, string][]; label: string }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 max-w-56 rounded-lg border border-line bg-card px-3 text-theme-sm text-gray-700 focus:border-gray-400 focus:outline-hidden dark:text-gray-200"
    >
      <option value="">{first}</option>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

export function Callout({ tone = "warn", children }: { tone?: "warn" | "error"; children: React.ReactNode }) {
  return (
    <div
      role="status"
      className={`mb-2.5 rounded-xl border px-3 py-1.5 text-theme-sm ${
        tone === "error" ? "border-error-200 bg-error-50 text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-400" : "border-line bg-strip text-gray-700 dark:text-gray-300"
      }`}
    >
      {children}
    </div>
  );
}

/** Waiting: a translucent, glowing hourglass in the page's cyan (a slow turn; still when reduced motion is asked). */
export function Hourglass({ label = "Loading", size = 44 }: { label?: string; size?: number }) {
  return (
    <div role="status" aria-label={label} className="ci-hourglass flex flex-col items-center justify-center gap-2 py-3">
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="hg-sand" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#22d3ee" stopOpacity="0.85" />
            <stop offset="1" stopColor="#2dd4bf" stopOpacity="0.35" />
          </linearGradient>
        </defs>
        <g className="ci-hourglass-body">
          <path d="M12 6h24M12 42h24" stroke="#67e8f9" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M15 6c0 9 9 12 9 18s-9 9-9 18M33 6c0 9-9 12-9 18s9 9 9 18" stroke="#22d3ee" strokeOpacity="0.9" strokeWidth="1.8" fill="rgba(34,211,238,0.07)" />
          <path className="ci-sand-top" d="M18 13h12c-1.5 4-4 6-6 7.5C22 19 19.5 17 18 13z" fill="url(#hg-sand)" />
          <path className="ci-sand-bottom" d="M17.5 39c1.5-4.5 4.5-6.5 6.5-7.5 2 1 5 3 6.5 7.5z" fill="url(#hg-sand)" />
          <line className="ci-sand-stream" x1="24" y1="22" x2="24" y2="33" stroke="#67e8f9" strokeWidth="1.2" strokeDasharray="1.5 2.5" />
        </g>
      </svg>
      <span className="text-theme-xs tracking-wide text-muted">{label}...</span>
    </div>
  );
}

/** "N new - show": rows that arrived over the socket and belong to the loaded range wait here instead of reflowing the list. */
export function NewBar({ n, onShow }: { n: number; onShow: () => void }) {
  if (!n) return null;
  return (
    <div className="border-t border-line px-3 py-2 text-center">
      <button type="button" onClick={onShow} className="text-theme-xs font-semibold underline-offset-4 hover:underline" style={{ color: "var(--st-run)" }}>
        {n} new - show
      </button>
    </div>
  );
}

/** "Load more" under a list: the next cursor is fetched on click, never ahead of time. */
export function MoreBar({ shown, total, busy, capped, onMore, hasMore }: { shown: number; total: number; busy: boolean; capped?: boolean; onMore: () => void; hasMore: boolean }) {
  if (!hasMore && !capped) return null;
  return (
    <div className="border-t border-line p-3 text-center">
      {hasMore ? (
        <button type="button" disabled={busy} onClick={onMore} className="text-theme-sm font-medium text-gray-700 underline-offset-4 hover:underline disabled:opacity-50 dark:text-gray-200">
          {busy ? "Loading..." : `Load more (${shown} of ${total})`}
        </button>
      ) : (
        <span className="text-theme-xs text-muted">Showing the newest {shown} of {total}; narrow it with the filters.</span>
      )}
    </div>
  );
}
