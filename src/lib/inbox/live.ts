// The page's ONE live channel: Server-Sent Events on /api/events (see DESIGN.md "Live events").
// Typed events; the handler for each patches only its slice. The guarantee that matters: it never stays dead.
//  * EventSource retries by itself, but gives up for good (readyState CLOSED) after an HTTP error, e.g. while the viewer restarts:
//    then we re-open it ourselves with backoff (1 s .. 15 s);
//  * a tab coming back to the foreground re-checks at once;
//  * the server sends `ping` every 20 s; 60 s of silence (a half-open connection) closes and re-opens it;
//  * every (re)connect starts with a full `snapshot` from the server, so nothing missed while away is lost.
export type LiveHandlers = Partial<Record<"snapshot" | "inbox" | "agents" | "ci.runners" | "branch" | "protocol" | "config" | "notify" | "notify.data" | "notify.state", (data: unknown) => void>> & {
  onStatus?: (connected: boolean) => void;
};
export function openLive(h: LiveHandlers, url = "/api/events"): () => void {
  let es: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dog: ReturnType<typeof setInterval> | null = null;
  let last = Date.now();
  let gone = false;
  let wait = 1000;
  const reopen = (delay: number) => {
    if (gone) return;
    es?.close();
    es = null;
    if (timer) clearTimeout(timer);
    timer = setTimeout(open, delay);
  };
  const open = () => {
    if (gone) return;
    last = Date.now();
    const s = new EventSource(url);
    es = s;
    for (const type of ["snapshot", "inbox", "agents", "ci.runners", "branch", "protocol", "config", "notify", "notify.data", "notify.state"] as const) {
      s.addEventListener(type, (e) => {
        last = Date.now();
        try {
          h[type]?.(JSON.parse((e as MessageEvent).data));
        } catch (err) {
          console.error(type, err);
        }
      });
    }
    s.addEventListener("ping", () => (last = Date.now()));
    s.onopen = () => {
      wait = 1000;
      last = Date.now();
      h.onStatus?.(true);
    };
    s.onerror = () => {
      h.onStatus?.(false);
      if (s.readyState === EventSource.CLOSED && !gone) {
        reopen(wait);
        wait = Math.min(wait * 2, 15000);
      }
    };
  };
  open();
  dog = setInterval(() => {
    if (!gone && es && Date.now() - last > 60000) {
      h.onStatus?.(false);
      reopen(500);
    }
  }, 10000);
  const onVisible = () => {
    if (document.visibilityState !== "visible" || gone) return;
    if (!es || es.readyState === EventSource.CLOSED || Date.now() - last > 45000) reopen(0);
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    gone = true;
    if (timer) clearTimeout(timer);
    if (dog) clearInterval(dog);
    document.removeEventListener("visibilitychange", onVisible);
    es?.close();
  };
}
