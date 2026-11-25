// ONE GitHub request budget shared by EVERY poller (each project's PR board and default-branch check, and the CI panel):
// a sliding one-hour window of call timestamps against config github.rateBudgetPerHour. Every caller names itself
// ("ci", "prs:<project>", "branch:<project>"); under contention the budget is shared fairly: once the hour is half used, an
// owner that already holds more than its equal share is denied until the others have caught up. Memoised on globalThis so
// every bundled copy shares it.
import { getConfig } from "./config.mjs";

const HOUR = 3600e3;
const CONTENTION = 0.5; // share limits apply once this fraction of the hour is spent

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
    /** Reserve `n` calls for `who`; false when the hourly budget (or this owner's fair share under contention) is exceeded. */
    spend(n = 1, who = "other") {
      prune();
      const lim = limit();
      const o = own(who);
      const used = total();
      if (used + n > lim) { denied++; o.denied++; return false; }
      if (used + n > lim * CONTENTION) {
        const active = [...owners.values()].filter((x) => x.stamps.length || x === o).length;
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
