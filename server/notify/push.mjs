// The Inbox's GitHub rows go to the open pages over their live channel (SSE /api/p/<id>/events), so no tab polls /api/notify.
// Two sticky topics per project page, each with the page's own project scope and the "all" scope:
//   notify.data   { scopes: { <id>: answer, all: answer } }   only when the rows, counts, settings or state code changed
//   notify.state  { scopes: { <id>: state, all: state } }     after every poll (the "checked 12 s ago" line), a few hundred bytes
// A 304 poll therefore sends only notify.state. Sticky: a page that connects gets the latest of both at once.

/** The answer without the fields that move on every poll, as a comparable text. */
export const rowsKey = (a) => JSON.stringify({ ...a, state: { ...a.state, at: null, checkedAt: null, nextAt: null } });

/**
 * @param {object} o
 * @param {(scope: string) => object} o.answer           the notify answer for a scope (server/notify/notify.mjs)
 * @param {(type: string, fn: (pid: string) => unknown) => void} o.publishEach   send per project (server/inbox.mjs)
 */
export function createNotifyPush({ answer, publishEach }) {
  const keys = new Map(); // project id -> rowsKey of the last notify.data sent to it
  /** Push to every project page; `force` = this project's data again even if unchanged (a page just connected). */
  function push(force = null) {
    const states = new Map();
    publishEach("notify.data", (pid) => {
      const a = answer(pid), all = answer("all");
      states.set(pid, { [pid]: a.state, all: all.state });
      const key = rowsKey(a) + "\n" + rowsKey(all);
      if (pid !== force && keys.get(pid) === key) return undefined;
      keys.set(pid, key);
      return { scopes: { [pid]: a, all } };
    });
    publishEach("notify.state", (pid) => (states.has(pid) ? { scopes: states.get(pid) } : undefined));
  }
  return { push };
}
