// The pure rules of the GitHub side of the Inbox: which section a notification belongs to, which repos are shown, how one
// notification (and what we learned about it) becomes a row, and the local read state. No I/O here; tests/notify.test.mjs
// drives it with fixtures shaped like `gh api notifications`.

/** Every section of the GitHub tab, in the order the page shows them. */
export const SECTIONS = ["mentions", "replies", "review", "reviews", "assigned", "state"];

/**
 * The section from GitHub's `reason` alone; `null` = not shown (CI activity, security alerts, invitations, threads you only
 * watch). "author" / "manual" are refined by `sectionOf` once the latest activity is known.
 */
const BY_REASON = {
  mention: "mentions",
  team_mention: "mentions",
  comment: "replies",
  author: "replies",
  manual: "replies",
  review_requested: "review",
  approval_requested: "review",
  assign: "assigned",
  state_change: "state",
};
export const sectionOfReason = (reason) => BY_REASON[reason] ?? null;

/**
 * The section of one notification. `detail` (optional) is what the enrichment learned: { review: { state } } when the latest
 * activity is a review, { state: "open" | "closed" | "merged", commented: boolean } for the subject.
 *   - a review on one of your PRs (reason author, the latest activity is someone's review) -> "reviews";
 *   - your issue or PR was closed or merged with no newer comment -> "state";
 *   - otherwise the reason decides.
 */
export function sectionOf(n, detail = null) {
  const base = sectionOfReason(n?.reason);
  if (!base) return null;
  if (n.reason === "author" && n.subject?.type === "PullRequest" && detail?.review) return "reviews";
  if (base === "replies" && n.reason !== "comment" && detail && !detail.commented && (detail.state === "closed" || detail.state === "merged")) return "state";
  return base;
}

/** The linked repos (owner/name, lower case) -> the ids of the projects linked to each. */
export function repoIndex(projects) {
  const m = new Map();
  for (const p of projects || []) {
    if (!p?.repo) continue;
    const k = String(p.repo).toLowerCase();
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(p.id);
  }
  return m;
}

/** Only notifications of a repo linked to a project are kept; everything else is dropped before anything else reads it. */
export function keepLinked(list, index) {
  return (Array.isArray(list) ? list : []).filter((n) => n && n.id && index.has(String(n.repository?.full_name || "").toLowerCase()));
}

/** https://api.github.com/repos/o/r/pulls/12 -> https://github.com/o/r/pull/12 (issues, commits and releases too). */
export function htmlOf(apiUrl, repoHtml = null) {
  const m = /^https:\/\/api\.github\.com\/repos\/([\w.-]+\/[\w.-]+)\/(pulls|issues|commits|releases)\/([\w.-]+)$/.exec(String(apiUrl || ""));
  if (!m) return repoHtml || null;
  const kind = { pulls: "pull", issues: "issues", commits: "commit", releases: "releases" }[m[2]];
  return `https://github.com/${m[1]}/${kind}/${m[3]}`;
}

/** The number of an issue or PR from its API url, or null. */
export const numberOf = (apiUrl) => {
  const m = /\/(?:pulls|issues)\/(\d+)$/.exec(String(apiUrl || ""));
  return m ? Number(m[1]) : null;
};

/** A short plain-text line from a Markdown / HTML body: no quotes, code, images, tags or links' targets; at most `max` characters. */
export function excerpt(body, max = 160) {
  let s = String(body || "");
  s = s.replace(/<!--[\s\S]*?-->/g, " ").replace(/```[\s\S]*?```/g, " ").replace(/^\s*>.*$/gm, " ");
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/<[^>]+>/g, " ");
  s = s.replace(/[*_~`#]+/g, "").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

/** Only https links to github.com leave the server (a row's link is opened by the browser). */
export const safeLink = (u) => (/^https:\/\/github\.com\//.test(String(u || "")) ? String(u) : null);

/** Only GitHub's own avatar host may give a row its picture (the browser loads it). */
export const safeAvatar = (u) => (/^https:\/\/avatars\.githubusercontent\.com\/[\w./?=&%-]+$/.test(String(u || "")) ? String(u) : null);

/**
 * One row of the Inbox from a notification and its detail.
 *   detail: { actor, avatar, body, url, review: { state } | null, state, commented } (every field optional)
 * -> { id, repo, projects, section, reason, type, number, title, url, actor, avatar, excerpt, review, state, at, ghUnread }
 */
export function toItem(n, detail, index) {
  const repo = n.repository?.full_name || "";
  const d = detail || {};
  return {
    id: String(n.id),
    repo,
    projects: index.get(repo.toLowerCase()) || [],
    section: sectionOf(n, detail),
    reason: n.reason,
    type: n.subject?.type || "Issue",
    number: numberOf(n.subject?.url),
    title: String(n.subject?.title || "").slice(0, 300),
    url: safeLink(d.url) || safeLink(htmlOf(n.subject?.url, n.repository?.html_url)),
    actor: d.actor || null,
    avatar: d.actor ? safeAvatar(d.avatar) : null,
    excerpt: d.body ? excerpt(d.body) : "",
    review: d.review?.state ? String(d.review.state).toLowerCase() : null,
    state: d.state || null,
    at: n.updated_at,
    ghUnread: !!n.unread,
  };
}

// ---------- the local read state (data/notify/read.json) ----------
// { v: 1, seeded: true, read: { "<thread id>": "<updated_at when it was read>" } }
// A row is unread when it was never read, or GitHub reports newer activity on it than the time it was read.

export const emptyRead = () => ({ v: 1, seeded: false, read: {} });

export const isUnread = (state, item) => {
  const r = state.read[item.id];
  return !r || Date.parse(r) < Date.parse(item.at);
};

/** Mark rows read (at their current activity time). Returns the number that changed. */
export function markRead(state, items) {
  let n = 0;
  for (const it of items) if (isUnread(state, it)) { state.read[it.id] = it.at; n++; }
  return n;
}

/** Mark rows unread again (forget when they were read). Returns the number that changed. */
export function markUnread(state, items) {
  let n = 0;
  for (const it of items) if (!isUnread(state, it)) { delete state.read[it.id]; n++; }
  return n;
}

/**
 * The first run seeds the local state from GitHub: what GitHub already shows as read starts read here, so turning the
 * feature on does not flood the Inbox with old news. After that only lanedeck's own state counts.
 */
export function seed(state, items) {
  if (state.seeded) return false;
  for (const it of items) if (!it.ghUnread) state.read[it.id] = it.at;
  state.seeded = true;
  return true;
}

/** Forget threads that are no longer listed and were read more than `days` ago; at most `max` entries stay. */
export function prune(state, liveIds, now = Date.now(), days = 30, max = 3000) {
  const cut = now - days * 864e5;
  for (const [id, at] of Object.entries(state.read)) if (!liveIds.has(id) && Date.parse(at) < cut) delete state.read[id];
  const keys = Object.keys(state.read);
  if (keys.length > max) {
    keys.sort((a, b) => Date.parse(state.read[a]) - Date.parse(state.read[b]));
    for (const k of keys.slice(0, keys.length - max)) delete state.read[k];
  }
  return state;
}

/** A read-state object from whatever the file held (bad or missing -> empty). */
export function parseRead(text) {
  try {
    const j = JSON.parse(text);
    if (!j || typeof j !== "object" || typeof j.read !== "object" || Array.isArray(j.read)) return emptyRead();
    const read = {};
    for (const [k, v] of Object.entries(j.read)) if (/^\d{1,30}$/.test(k) && typeof v === "string" && !Number.isNaN(Date.parse(v))) read[k] = v;
    return { v: 1, seeded: !!j.seeded, read };
  } catch {
    return emptyRead();
  }
}

/** Rows of one scope ("all" or a project id), in the shown sections, newest first, each with its local `unread`. */
export function view(items, state, scope, sections) {
  const show = new Set(sections);
  return items
    .filter((it) => it.section && show.has(it.section) && (scope === "all" || it.projects.includes(scope)))
    .map((it) => ({ ...it, unread: isUnread(state, it) }))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** Unread counts of a view: all, and per section. */
export function countsOf(rows) {
  const sections = Object.fromEntries(SECTIONS.map((s) => [s, 0]));
  let unread = 0;
  for (const r of rows) if (r.unread) { unread++; sections[r.section]++; }
  return { total: rows.length, unread, sections };
}

/** Why a gh call failed, as a code the page turns into a friendly message. */
export function errorCode(status, text) {
  const s = String(text || "");
  // gh says it outright when the token lacks the scope (GitHub answers 403 or 404 for it, so the status alone is not enough).
  if (/needs the "?notifications"? scope|gh auth refresh/i.test(s)) return "scope";
  if (status === 401 || /auth login|not logged|authenticat|bad credentials/i.test(s)) return "auth";
  if (status === 429 || /rate limit/i.test(s)) return "ratelimit";
  if (status === 403) return /scope|permission|notifications/i.test(s) ? "scope" : "ratelimit";
  if (status === 404) return "scope"; // only the notifications list reaches here; GitHub hides it (404) from a token without the scope
  if (/ENOENT|not recognized|cannot find|no such file/i.test(s)) return "nogh";
  if (/resolve host|ENOTFOUND|network|timeout|ECONN/i.test(s)) return "network";
  return "failed";
}
