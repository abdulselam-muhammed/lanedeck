// The pure rules of the "Your work" page (/p/<project>/mine): who spoke last, whether a reply is new for you, whether a
// mention still waits for you, and which group each of your PRs falls into. No I/O here; tests/mine.test.mjs drives it.

const ms = (iso) => (iso ? Date.parse(iso) || 0 : 0);
const same = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A GitHub author is a bot when GraphQL says so (__typename Bot) or the login carries the [bot] suffix. */
export const isBot = (author) => !!author && (author.__typename === "Bot" || /\[bot\]$/i.test(author.login || ""));

/**
 * Who spoke last on a thread, and whether someone else replied after your last activity.
 *   items: [{ by, at, bot? }] - comments (and review bodies); bots are ignored.
 *   mine:  extra timestamps that count as your activity (you opened it, you were assigned, you pushed).
 * -> { last: {by, at} | null, mineAt, newReply, replyBy, replyAt }
 * With no activity of yours known at all, nothing is called "new": there is no "since" to compare with.
 */
export function replyState(items, me, mine = []) {
  const human = (items || []).filter((c) => c && c.at && c.by && !c.bot).sort((a, b) => ms(b.at) - ms(a.at));
  const last = human[0] ? { by: human[0].by, at: human[0].at } : null;
  const mineAt = Math.max(0, ...mine.map(ms), ...human.filter((c) => same(c.by, me)).map((c) => ms(c.at)));
  const other = human.find((c) => !same(c.by, me));
  const newReply = !!me && !!other && mineAt > 0 && ms(other.at) > mineAt;
  return { last, mineAt, newReply, replyBy: newReply ? other.by : null, replyAt: newReply ? other.at : null };
}

/**
 * When someone else last @-mentioned you on a thread that you have not answered since; null when there is no such mention.
 *   item: { by, at, body, comments: [{ by, at, body, bot? }] } - the opening post and its comments (and review bodies).
 */
export function pendingMention(item, me) {
  if (!me || !item) return null;
  const re = new RegExp("@" + esc(me) + "(?![\\w-])", "i");
  const comments = item.comments || [];
  let hit = null;
  for (const c of [{ by: item.by, at: item.at, body: item.body }, ...comments]) {
    if (!c || !c.at || c.bot || same(c.by, me) || !re.test(c.body || "")) continue;
    if (!hit || ms(c.at) > ms(hit.at)) hit = c;
  }
  if (!hit) return null;
  if (comments.some((c) => same(c.by, me) && ms(c.at) > ms(hit.at))) return null;
  return { by: hit.by, at: hit.at };
}

/** Board stages that are yours to act on, and the plain reason each one shows. */
const NEEDS = { changes: "changes", "code-conflict": "conflict", "ci-failed": "ci", "push-now": "push" };
const WAITING = { review: "review", "ci-running": "checks", stacked: "stacked", held: "held", "board-conflict": "board", "local-ready": "turn", computing: "github", measuring: "github" };

/**
 * The group of one of your open PRs, in human words, from the PR board's own classification (server/prs/board.mjs):
 *   needs   - changes requested, a code conflict, failed checks, your turn to push, or a new comment from someone else;
 *   waiting - review pending, checks running, a parent PR, a hold, a draft;
 *   ready   - approved (or not needing approval) and green.
 * -> { group, reason }
 */
export function prGroup(pr) {
  const need = NEEDS[pr.stage];
  if (need) return { group: "needs", reason: need };
  if (pr.talk?.newReply && !pr.draft) return { group: "needs", reason: "reply" };
  if (pr.draft) return { group: "waiting", reason: "draft" };
  if (pr.stage === "ready") return { group: "ready", reason: pr.review === "APPROVED" ? "approved" : "green" };
  return { group: "waiting", reason: WAITING[pr.stage] || "review" };
}

/** The one "needs you" number: issues with a new reply, PRs that need your action, and everything asked of you. */
export function needsCount({ issues = [], prs = [], asked = [] }) {
  return issues.filter((i) => i.newReply).length + prs.filter((p) => p.group === "needs").length + asked.length;
}

/** What landed for you, one entry per thing: the notifier raises an event for each key it has not seen before.
 *  -> [{ key, kind: "reply" | "review" | "mention", number, by, title }] */
export function attention({ issues = [], prs = [], asked = [] }) {
  const out = [];
  for (const i of issues) if (i.newReply) out.push({ key: `i${i.number}@${i.replyAt}`, kind: "reply", number: i.number, by: i.replyBy, title: i.title });
  for (const p of prs) if (p.reason === "reply") out.push({ key: `p${p.number}@${p.replyAt}`, kind: "reply", number: p.number, by: p.replyBy, title: p.title });
  for (const a of asked) out.push({ key: a.kind === "review" ? `r${a.number}` : `m${a.number}@${a.at}`, kind: a.kind, number: a.number, by: a.by, title: a.title });
  return out;
}
