// The logic of the in-app dialogs (confirm / notice), with no React in it so it can be tested: a queue of requests, each a promise that
// settles once, and the keyboard rules. The UI lives in src/components/ui/dialog/DialogProvider.tsx.

/** @returns {{ subscribe(fn: () => void): () => void, current(): object | null, confirm(opts: object): Promise<boolean>, notice(opts: object): Promise<void>, settle(value: boolean): void }} */
export function createDialogs() {
  /** @type {{ id: number, kind: "confirm" | "notice", opts: object, resolve: (v: boolean) => void }[]} */
  const queue = [];
  const subs = new Set();
  let id = 0;
  const emit = () => subs.forEach((fn) => fn());
  const ask = (kind, opts) => new Promise((resolve) => { queue.push({ id: ++id, kind, opts, resolve }); emit(); });
  return {
    subscribe: (fn) => { subs.add(fn); return () => { subs.delete(fn); }; },
    /** The request on screen (the same object until it settles, so it is a stable snapshot), or null. */
    current: () => queue[0] ?? null,
    confirm: (opts) => ask("confirm", opts),
    notice: (opts) => ask("notice", opts).then(() => undefined),
    /** Settle the request on screen: true = confirmed, false = cancelled. The next queued one, if any, shows next. */
    settle(value) {
      const head = queue.shift();
      if (!head) return;
      head.resolve(head.kind === "notice" ? true : value);
      emit();
    },
  };
}

/**
 * What a key does inside an open dialog: Esc cancels; Enter confirms, unless focus is on the cancel button (Enter there presses
 * Cancel, which is the safe choice on a danger dialog) or the key is a held-down repeat.
 * @param {{ key: string, repeat?: boolean, onCancelButton?: boolean }} e
 * @returns {"confirm" | "cancel" | null}
 */
export function keyAction(e) {
  if (e.key === "Escape") return "cancel";
  if (e.key === "Enter" && !e.repeat && !e.onCancelButton) return "confirm";
  return null;
}

/** The focus trap: where Tab goes from index `i` of `n` focusable controls (wraps around both ways). */
export function nextFocus(i, n, backwards) {
  if (n <= 0) return -1;
  if (i < 0) return backwards ? n - 1 : 0;
  return (i + (backwards ? n - 1 : 1)) % n;
}
