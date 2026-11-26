// What actually happened on a GitHub notification thread. GitHub's `reason` says WHY you are subscribed (it is sticky: a
// thread you were once mentioned in stays "mention" when it is later merged), not WHAT just happened, so the Inbox never
// words a row from it. The event comes from the facts the poller read (server/notify/notify.mjs enrich):
//   comment   the object behind subject.latest_comment_url when that is a comment (issue comment, PR review comment,
//             review, commit comment), { missing: true } when it was deleted (404), or null;
//   subject   the issue / PR itself (state, merged_at / merged_by, closed_at / closed_by, author, created_at, body);
//   timeline  the newest page of the issue / PR timeline (read only when the comment and the subject do not explain the
//             thread's updated_at);
//   release   the release behind a Release thread.
// No I/O here; tests/notify-events.test.mjs drives it with recorded-style fixtures.

/** Every event a row can show. "activity" is the generic fallback: something changed, the facts do not say more. */
export const EVENTS = [
  "mention", "comment", "review_requested", "approved", "changes_requested", "reviewed", "assigned",
  "merged", "closed", "reopened", "opened", "ready", "pushed",
  "release", "ci_failed", "ci_passed", "ci", "security", "invitation", "advisory", "approval", "activity",
];

/** Reasons that mean you take part in the thread; every other reason (subscribed, ci_activity, security_alert, ...) is "other". */
const PARTICIPATING = new Set(["mention", "team_mention", "comment", "author", "manual", "review_requested", "assign", "state_change", "approval_requested"]);
export const participating = (reason) => PARTICIPATING.has(reason);

/** The section a thread can land in before anything is read: "other" for the non-participating reasons, else null (decided by the event). */
export const preSection = (n) => (participating(n?.reason) ? null : "other");

/** How far a fact's time may sit from the thread's updated_at and still be "the latest thing". */
export const NEAR_MS = 120e3;
const ms = (iso) => (iso ? Date.parse(iso) || 0 : 0);
export const same = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The kind of comment a latest_comment_url path points at, or null when it is not a comment (the subject itself, a release). */
export function commentKind(p) {
  const s = String(p || "");
  if (/^repos\/[\w.-]+\/[\w.-]+\/issues\/comments\/\d+$/.test(s)) return "comment";
  if (/^repos\/[\w.-]+\/[\w.-]+\/pulls\/comments\/\d+$/.test(s)) return "review_comment";
  if (/^repos\/[\w.-]+\/[\w.-]+\/pulls\/\d+\/reviews\/\d+$/.test(s)) return "review";
  if (/^repos\/[\w.-]+\/[\w.-]+\/comments\/\d+$/.test(s)) return "commit_comment";
  return null;
}

/** Text without code, quotes and HTML comments: a quoted or code-fenced "@you" is not a new mention. */
const plain = (body) => String(body || "").replace(/<!--[\s\S]*?-->/g, " ").replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ").replace(/^\s*>.*$/gm, " ");

/** Whether a body @-mentions `me` (not inside code or a quote, not part of an email address). */
export function mentions(body, me) {
  if (!me) return false;
  return new RegExp(`(^|[^\\w@/.-])@${esc(me)}(?![\\w-])`, "i").test(plain(body));
}
/** Whether a body @-mentions a team (@org/team): the only kind of mention a team_mention can be checked against. */
export const mentionsTeam = (body) => /(^|[^\w@/.-])@[\w-]+\/[\w.-]+/.test(plain(body));

// Timeline items that say nothing to the reader: they never count as "the latest thing".
const NOISE = new Set([
  "labeled", "unlabeled", "subscribed", "unsubscribed", "mentioned", "milestoned", "demilestoned", "added_to_project",
  "moved_columns_in_project", "removed_from_project", "converted_note_to_issue", "head_ref_deleted", "head_ref_restored",
  "referenced", "comment_deleted", "locked", "unlocked", "pinned", "unpinned", "auto_merge_enabled", "auto_merge_disabled",
  "auto_squash_enabled", "auto_rebase_enabled", "automatic_base_change_succeeded", "automatic_base_change_failed",
  "committed", "user_blocked", "deployment_environment_changed", "base_ref_force_pushed", "connected", "disconnected",
  "cross-referenced", "added_to_merge_queue", "removed_from_merge_queue", "issue_type_added", "issue_type_changed",
]);
// When two facts are within a few seconds of each other (a merge also closes; "close with comment"), the stronger one wins.
const RANK = { merged: 9, closed: 8, reopened: 7, review: 6, review_comment: 5, comment: 4, commit_comment: 4, review_requested: 3, assigned: 3, ready: 3, opened: 2, pushed: 1, activity: 0 };
const TIE_MS = 10e3;

const who = (u) => (u && u.login ? { login: String(u.login), avatar: u.avatar_url || null } : null);

/** One timeline item -> a fact { kind, at, actor, ... }, or null for noise and unknown shapes. */
export function timelineFact(x, me) {
  if (!x || typeof x !== "object") return null;
  const e = x.event;
  if (!e) return null;
  // Noise (a label, a branch deleted): only says "something changed" when nothing meaningful explains the update.
  if (NOISE.has(e)) return x.created_at ? { kind: "activity", noise: true, at: x.created_at, actor: who(x.actor) } : null;
  switch (e) {
    case "commented":
      return { kind: "comment", at: x.created_at, actor: who(x.user || x.actor), body: x.body || "", url: x.html_url || null };
    case "reviewed":
      if (!x.state || String(x.state).toUpperCase() === "PENDING") return null;
      return { kind: "review", at: x.submitted_at || x.created_at, actor: who(x.user || x.actor), body: x.body || "", url: x.html_url || null, state: String(x.state).toUpperCase() };
    case "line-commented":
    case "commit-commented": {
      const c = Array.isArray(x.comments) && x.comments.length ? x.comments[x.comments.length - 1] : null;
      if (!c) return null;
      return { kind: e === "line-commented" ? "review_comment" : "commit_comment", at: c.created_at, actor: who(c.user), body: c.body || "", url: c.html_url || null };
    }
    case "merged":
    case "closed":
    case "reopened":
    case "ready_for_review":
      return { kind: e === "ready_for_review" ? "ready" : e, at: x.created_at, actor: who(x.actor) };
    case "assigned":
      return same(x.assignee?.login, me) ? { kind: "assigned", at: x.created_at, actor: who(x.actor || x.assigner) } : { kind: "activity", at: x.created_at, actor: who(x.actor) };
    case "review_requested":
      // A request to you, or to a team (GitHub only notifies a team's members): yours. To someone else: just activity.
      return same(x.requested_reviewer?.login, me) || (x.requested_team && !x.requested_reviewer)
        ? { kind: "review_requested", at: x.created_at, actor: who(x.review_requester || x.actor) }
        : { kind: "activity", at: x.created_at, actor: who(x.review_requester || x.actor) };
    case "head_ref_force_pushed":
      return { kind: "pushed", at: x.created_at, actor: who(x.actor) };
    default:
      // renamed, unassigned, review_dismissed, convert_to_draft, transferred, ... and anything GitHub adds later.
      return x.created_at ? { kind: "activity", at: x.created_at, actor: who(x.actor) } : null;
  }
}

/** The facts a subject (issue / PR object) gives on its own: when it was opened, merged and closed, and by whom. */
function subjectFacts(s) {
  const out = [];
  if (!s || typeof s !== "object") return out;
  if (s.created_at) out.push({ kind: "opened", at: s.created_at, actor: who(s.user), body: s.body || "", url: s.html_url || null, subject: true });
  if (s.merged_at) out.push({ kind: "merged", at: s.merged_at, actor: who(s.merged_by), subject: true });
  else if (s.state === "closed" && s.closed_at) out.push({ kind: "closed", at: s.closed_at, actor: who(s.closed_by), subject: true });
  return out;
}

/** The fact behind latest_comment_url, or null (not a comment, deleted, unreadable). */
function commentFact(c) {
  if (!c || c.missing || !c.kind) return null;
  return { kind: c.kind, at: c.at || null, actor: who(c.user), body: c.body || "", url: c.html_url || null, state: c.state ? String(c.state).toUpperCase() : null };
}

/**
 * The latest fact at or before the thread's updated_at (a little slack for GitHub's clocks); ties within a few seconds go
 * to the stronger kind (a merge over the close it causes). A comment without a time counts as the latest thing.
 */
export function latestFact(facts, updatedAt) {
  const at = ms(updatedAt);
  const limit = at + NEAR_MS;
  const all = facts.filter((f) => f && (!f.at || ms(f.at) <= limit)).map((f) => ({ ...f, t: f.at ? ms(f.at) : at }));
  const ok = all.filter((f) => !f.noise);
  const noise = all.filter((f) => f.noise).sort((a, b) => b.t - a.t)[0] || null;
  const top = ok.length ? Math.max(...ok.map((f) => f.t)) : -Infinity;
  // Nothing meaningful near the update, but a label / branch change is: that is what happened ("updated").
  if (noise && top < at - NEAR_MS && noise.t > top) return { kind: "activity", at: noise.at, actor: noise.actor };
  if (!ok.length) return null;
  const near = ok.filter((f) => top - f.t <= TIE_MS);
  near.sort((a, b) => (RANK[b.kind] ?? 0) - (RANK[a.kind] ?? 0) || Number(!!b.actor) - Number(!!a.actor) || b.t - a.t);
  const best = near[0];
  // The subject only says when it was opened / closed: long before the update, that is not what happened now.
  if (best.subject && best.t < at - NEAR_MS) return { kind: "activity", at: null, actor: null };
  // "Close with comment": the comment that came with a state change gives the row its excerpt.
  if (!best.body && ["merged", "closed", "reopened"].includes(best.kind)) {
    const said = near.find((f) => f.body && same(f.actor?.login, best.actor?.login) && ["comment", "review"].includes(f.kind));
    if (said) return { ...best, body: said.body, url: best.url || said.url };
  }
  return best;
}

/** Whether the comment and the subject already explain the thread's updated_at (so the timeline need not be read). */
export function explained(n, facts) {
  const at = ms(n?.updated_at);
  const c = commentFact(facts.comment);
  if (c && (!c.at || ms(c.at) >= at - NEAR_MS)) return true;
  return subjectFacts(facts.subject).some((f) => Math.abs(ms(f.at) - at) <= NEAR_MS && (f.kind !== "closed" || f.actor));
}

/** The short reference of a thread that has no number: a commit's short sha, a release's name. */
export function refOf(n, facts = {}) {
  const s = n?.subject || {};
  if (s.type === "Commit") return (/\/commits\/([0-9a-f]{7,40})$/i.exec(String(s.url || "")) || [])[1]?.slice(0, 7) || null;
  if (s.type === "Release") return String(facts.release?.name || facts.release?.tag_name || s.title || "").slice(0, 80) || null;
  return null;
}

/**
 * The row's event from a notification, what was read about it, and your login.
 * -> { event, actor, avatar, self, body, url, review, state, section }
 *   section: mentions | replies | review | reviews | assigned | state | other (server/notify/logic.mjs SECTIONS)
 */
export function deriveEvent(n, facts, me = null) {
  n = n && typeof n === "object" ? n : {};
  facts = facts && typeof facts === "object" ? facts : {};
  const s = n?.subject || {};
  const type = s.type || "";
  const reason = n?.reason || "";
  const out = { event: "activity", actor: null, avatar: null, self: false, body: "", url: null, review: null, state: null, section: null };
  const subj = facts.subject && typeof facts.subject === "object" ? facts.subject : null;
  let known = false;
  if (subj) out.state = subj.merged_at || subj.merged ? "merged" : subj.state || null;

  if (type === "Issue" || type === "PullRequest" || type === "Commit") {
    const all = [commentFact(facts.comment), ...subjectFacts(subj), ...(Array.isArray(facts.timeline) ? facts.timeline : []).map((x) => timelineFact(x, me))].filter(Boolean);
    const f = latestFact(all, n.updated_at);
    if (f) {
      known = f.kind !== "activity" || !!f.actor; // an update nothing explains keeps the reason's guess for its section
      out.actor = f.actor?.login || null;
      out.avatar = f.actor?.avatar || null;
      out.body = f.body || "";
      out.url = f.url || null;
      out.event = eventOf(f, n, me, subj);
      if (f.kind === "review") out.review = String(f.state || "commented").toLowerCase();
    }
  } else if (type === "Release") {
    const r = facts.release;
    out.event = "release";
    known = true;
    if (r) { out.actor = r.author?.login || null; out.avatar = r.author?.avatar_url || null; out.body = r.body || ""; out.url = r.html_url || null; }
  } else if (type === "CheckSuite" || type === "WorkflowRun") {
    out.event = reason === "approval_requested" ? "approval" : /fail|cancel|timed out|error/i.test(s.title || "") ? "ci_failed" : /succe|pass|complete/i.test(s.title || "") ? "ci_passed" : "ci";
  } else if (type === "RepositoryVulnerabilityAlert" || type === "RepositoryDependabotAlertsThread" || reason === "security_alert") {
    out.event = "security";
  } else if (type === "RepositoryInvitation" || reason === "invitation") {
    out.event = "invitation";
  } else if (type === "SecurityAdvisory" || reason === "security_advisory_credit") {
    out.event = "advisory";
  } else if (reason === "approval_requested") {
    out.event = "approval";
  }
  out.self = !!out.actor && same(out.actor, me);
  out.section = sectionOfEvent(out.event, n, subj, me, known);
  return out;
}

/** A fact -> the event the reader sees. */
function eventOf(f, n, me, subj) {
  const k = f.kind;
  const directed = (body) => mentions(body, me) || (n.reason === "team_mention" && mentionsTeam(body)) || (!me && (n.reason === "mention" || n.reason === "team_mention") && /@[\w-]/.test(plain(body)));
  if (k === "comment" || k === "review_comment" || k === "commit_comment") return !same(f.actor?.login, me) && directed(f.body) ? "mention" : "comment";
  if (k === "review") {
    const st = String(f.state || "").toUpperCase();
    if (st === "APPROVED") return "approved";
    if (st === "CHANGES_REQUESTED") return "changes_requested";
    return !same(f.actor?.login, me) && directed(f.body) ? "mention" : "reviewed";
  }
  if (k === "opened") {
    // A thread that was just opened: the reason tells what it asks of you, checked against the subject where it can be.
    if (n.reason === "review_requested") return "review_requested";
    if (n.reason === "assign" && (!subj?.assignees || subj.assignees.some((a) => same(a?.login, me)))) return "assigned";
    if (!same(f.actor?.login, me) && directed(f.body)) return "mention";
    return "opened";
  }
  return ["merged", "closed", "reopened", "assigned", "review_requested", "ready", "pushed"].includes(k) ? k : "activity";
}

const PR_REVIEWS = new Set(["approved", "changes_requested", "reviewed"]);
const OTHER_EVENTS = new Set(["release", "ci_failed", "ci_passed", "ci", "security", "invitation", "advisory"]);
/** The section of an event. Something aimed at you (a mention, a review request, an assignment) is shown whatever the reason. */
function sectionOfEvent(event, n, subj, me, known) {
  if (event === "mention") return "mentions";
  if (event === "review_requested" || event === "approval") return "review";
  if (event === "assigned") return "assigned";
  if (!participating(n?.reason) || OTHER_EVENTS.has(event)) return "other";
  if (PR_REVIEWS.has(event)) return n.reason === "author" || same(subj?.user?.login, me) ? "reviews" : "replies";
  if (event === "comment" || event === "opened") return "replies";
  if (["merged", "closed", "reopened", "ready", "pushed"].includes(event) || known) return "state";
  // Nothing more is knowable (a Discussion has no REST detail; a thread not read yet): the reason is the best guess there is.
  return { mention: "mentions", team_mention: "mentions", review_requested: "review", assign: "assigned", state_change: "state" }[n.reason] || "replies";
}
