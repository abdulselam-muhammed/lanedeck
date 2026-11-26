// ONE GitHub request budget shared by EVERY poller (each project's PR board and default-branch check, and the CI panel):
// a sliding one-hour window of call timestamps against config github.rateBudgetPerHour. Every caller names itself
// ("ci", "prs:<project>", "branch:<project>"); under contention the budget is shared fairly: once the hour is half used, an
// owner that already holds more than its equal share is denied until the others have caught up. Only owners that spent
// in the last ACTIVE_MS count towards the equal share, so owners that went quiet do not shrink everyone else's share. Memoised on globalThis so
// every bundled copy shares it.
import { getConfig } from "./config.mjs";

const HOUR = 3600e3;
const CONTENTION = 0.75; // share limits apply once this fraction of the hour is spent
const ACTIVE_MS = 600e3; // an owner is "active" (counts for the equal share) if it spent within this long

/** A budget with its own state. `limit()` and `now()` are injected so tests can drive it. */
export function createBudget(limit, now = Date.now) {
  const owners = new Map(); // name -> { stamps: number[], denied: number }
  let denied = 0;
  const own = (who) => { let o = owners.get(who); if (!o) owners.set(who, (o = { stamps: [], denied: 0 })); return o; };
  const prune = () => {
    const cut = now() - HOUR;
    for (const [name, o] of owners) {
      while (o.stamps.length && o.stamps[0] < cut) o.stamps.shift();
      if (!o.stamps.length && !o.denied) owners.delete(name);
    }
  };
  const total = () => { let n = 0; for (const o of owners.values()) n += o.stamps.length; return n; };
  return {
    /** The biggest spenders of the last hour as text ("prs:a 312, mine:a 90"), for messages that say who used the budget. */
    top(n = 3) {
      prune();
      return [...owners].filter(([, o]) => o.stamps.length).sort((a, b) => b[1].stamps.length - a[1].stamps.length).slice(0, n).map(([k, o]) => `${k} ${o.stamps.length}`).join(", ");
    },
    /** Reserve `n` calls for `who`; false when the hourly budget (or this owner's fair share under contention) is exceeded. */
    spend(n = 1, who = "other") {
      prune();
      const lim = limit();
      const o = own(who);
      const used = total();
      if (used + n > lim) { denied++; o.denied++; return false; }
      if (used + n > lim * CONTENTION) {
        const t0 = now() - ACTIVE_MS;
        const active = [...owners.values()].filter((x) => x === o || (x.stamps.length && x.stamps[x.stamps.length - 1] >= t0)).length;
        if (o.stamps.length + n > Math.max(n, Math.floor(lim / Math.max(1, active)))) { denied++; o.denied++; return false; }
      }
      const t = now();
      for (let i = 0; i < n; i++) o.stamps.push(t);
      return true;
    },
    /** Give calls back (a conditional request answered 304 costs GitHub nothing). */
    refund(n = 1, who = "other") { const o = owners.get(who); if (o) o.stamps.splice(Math.max(0, o.stamps.length - n), n); },
    /** { used, limit, denied, owners: { name: { used, denied } } } for the last hour. */
    usage() {
      prune();
      const out = {};
      for (const [name, o] of owners) out[name] = { used: o.stamps.length, denied: o.denied };
      return { used: total(), limit: limit(), denied, owners: out };
    },
  };
}

const shared = (globalThis.__laneDeckBudget ??= createBudget(() => getConfig().github.rateBudgetPerHour));
export const spend = shared.spend;
export const refund = shared.refund;
export const usage = shared.usage;
export const top = shared.top;
/** "GitHub request budget for this hour is used up (1500/1500; prs:a 312, mine:a 90)" */
export const usedUpText = () => { const u = shared.usage(); return `GitHub request budget for this hour is used up (${u.used}/${u.limit}; biggest users: ${shared.top() || "none"}; settings: github.rateBudgetPerHour)`; };
