// The pure rules of the Inbox list (the GitHub tab and the All tab): the filter chips above it, the day groups (Today,
// Yesterday, Earlier this week, Older), and what kind of row a GitHub notification is (the sentence and the small icon on
// the avatar). No React and no I/O here: tests/notify-list.test.mjs drives it.

/** The chips above the GitHub list, in order. "reviews" covers both a requested review and a review on your PR. */
export const CHIPS = ["all", "unread", "mentions", "replies", "reviews", "assigned", "status", "other"];

/**
 * The chip of a server section (server/notify/logic.mjs SECTIONS). The server puts a row in the section of what actually
 * happened (server/notify/events.mjs), so the chips filter by the event, never by GitHub's sticky `reason`.
 */
const CHIP_OF = { mentions: "mentions", replies: "replies", review: "reviews", reviews: "reviews", assigned: "assigned", state: "status", other: "other" };
export const chipOfSection = (section) => CHIP_OF[section] ?? null;

/** Whether a row shows under a chip. */
export function matchChip(item, chip) {
  if (chip === "all") return true;
  if (chip === "unread") return !!item.unread;
  return chipOfSection(item.section) === chip;
}

/** The chips worth showing for the sections the user keeps in Settings: All and Unread always, then one per kept section. */
export function chipsFor(sections) {
  const kept = new Set((sections || []).map(chipOfSection).filter(Boolean));
  return CHIPS.filter((c) => c === "all" || c === "unread" || kept.has(c));
}

/** The small number on each chip: All = every row, the others = their unread rows. */
export function chipCounts(items) {
  const out = Object.fromEntries(CHIPS.map((c) => [c, 0]));
  for (const it of items) {
    out.all++;
    if (!it.unread) continue;
    out.unread++;
    const c = chipOfSection(it.section);
    if (c) out[c]++;
  }
  return out;
}

/** The day group of a time (ms) seen from `now` (ms), by the local calendar: today, yesterday, week (2-6 days ago), older. */
export function dayOf(at, now = Date.now()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const today = start.getTime();
  if (at >= today) return "today";
  const y = new Date(start);
  y.setDate(y.getDate() - 1);
  if (at >= y.getTime()) return "yesterday";
  const w = new Date(start);
  w.setDate(w.getDate() - 6);
  if (at >= w.getTime()) return "week";
  return "older";
}

export const DAYS = ["today", "yesterday", "week", "older"];

/**
 * Rows (each with `at` in ms) -> [{ day, rows }], newest first inside each group, groups in DAYS order, empty groups dropped.
 */
export function groupByDay(rows, now = Date.now()) {
  const by = new Map(DAYS.map((d) => [d, []]));
  for (const r of [...rows].sort((a, b) => b.at - a.at)) by.get(dayOf(r.at, now)).push(r);
  return DAYS.filter((d) => by.get(d).length).map((d) => ({ day: d, rows: by.get(d) }));
}

/** Every row kind (= server/notify/events.mjs EVENTS): each has a sentence, a self sentence, a label and a badge. */
export const KINDS = [
  "mention", "comment", "review_requested", "approved", "changes_requested", "reviewed", "assigned",
  "merged", "closed", "reopened", "opened", "ready", "pushed",
  "release", "ci_failed", "ci_passed", "ci", "security", "invitation", "advisory", "approval", "activity",
];
const KNOWN = new Set(KINDS);

/**
 * What happened, as a row kind: the sentence ("ntf.kind.<kind>", or "ntf.self.<kind>" for your own action) and the badge
 * on the avatar follow it. It is the server's derived event; a row from an older server (no event) falls back to its section.
 */
export function kindOf(item) {
  if (item.event) return KNOWN.has(item.event) ? item.event : "activity";
  switch (item.section) {
    case "mentions": return "mention";
    case "review": return "review_requested";
    case "reviews": return item.review === "approved" ? "approved" : item.review === "changes_requested" ? "changes_requested" : "reviewed";
    case "assigned": return "assigned";
    case "state": return item.state === "merged" ? "merged" : item.state === "open" ? "reopened" : "closed";
    default: return "comment";
  }
}

/** The icon (IconSprite name) of the small badge on the avatar, and its tone. */
const BADGE = {
  mention: ["at-sign", "brand"],
  comment: ["message", "gray"],
  review_requested: ["git-pull-request", "warning"],
  approved: ["circle-check", "success"],
  changes_requested: ["alert", "error"],
  reviewed: ["eye", "gray"],
  assigned: ["user-plus", "brand"],
  merged: ["git-merge", "merged"],
  closed: ["x", "error"],
  reopened: ["circle-dot", "success"],
  opened: ["circle-dot", "brand"],
  ready: ["git-pull-request", "success"],
  pushed: ["refresh", "gray"],
  release: ["sparkles", "brand"],
  ci_failed: ["x", "error"],
  ci_passed: ["check", "success"],
  ci: ["activity", "gray"],
  security: ["alert", "error"],
  invitation: ["user-plus", "brand"],
  advisory: ["alert", "warning"],
  approval: ["hourglass", "warning"],
  activity: ["activity", "gray"],
};
export const badgeOf = (kind) => BADGE[kind] ?? BADGE.activity;

/** The reference in a row's sentence: #12 for an issue or PR, a commit's short sha or a release's name, else null (the type). */
export const refText = (item) => (item.number != null ? `#${item.number}` : item.ref || null);

/** One or two letters for an avatar that has no picture. */
export function initials(login) {
  const s = String(login || "").replace(/\[bot\]$/i, "");
  const parts = s.split(/[-_.\s]+/).filter(Boolean);
  if (parts.length > 1) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (s.slice(0, 2) || "?").toUpperCase();
}

/** The top-level Inbox tabs, in order. Archive is last: it holds archived agent files and archived GitHub notifications. */
export const INBOX_TABS = ["all", "agents", "github", "archive"];

/** The tab named by ?tab= (and the old ?view=archive link, which is the Archive tab now); null when neither names one. */
export function tabFromParams(tab, view) {
  if (view === "archive") return "archive";
  return INBOX_TABS.includes(tab) ? tab : null;
}

/** The Archive tab's count: archived agent files (null while unknown) plus archived GitHub notifications. Never part of All's count. */
export const archiveTotal = (files, gh) => (files == null ? null : files + (gh || 0));
