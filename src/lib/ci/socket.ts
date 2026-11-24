// The /ci page's one live connection: a WebSocket to /api/ci/ws (read-only, server -> browser). Reconnects with
// backoff (1 s, 2 s, 4 s ... 30 s); the returned function ends it for good and cancels every timer and listener.
// Used by the /ci page (all topics) and by the Overview tile (`topics: "agg"`, only the aggregates).
export type CiMsg = { t: string; [k: string]: unknown };
export function openCiSocket(opts: { topics?: "agg"; onMessage: (m: CiMsg) => void; onOpen?: () => void; onClose?: () => void }): () => void {
  let ws: WebSocket | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let dead = false;
  let wait = 1000;
  const url = () => `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ci/ws${opts.topics ? `?topics=${opts.topics}` : ""}`;
  const connect = () => {
    if (dead) return;
    const s = new WebSocket(url());
    ws = s;
    s.onopen = () => {
      wait = 1000;
      opts.onOpen?.();
    };
    s.onmessage = (e) => {
      try {
        opts.onMessage(JSON.parse(String(e.data)));
      } catch {
        /* skip a malformed frame */
      }
    };
    s.onclose = () => {
      if (ws === s) ws = null;
      if (dead) return;
      opts.onClose?.();
      retry = setTimeout(connect, wait);
      wait = Math.min(wait * 2, 30000);
    };
    s.onerror = () => s.close();
  };
  connect();
  return () => {
    dead = true;
    if (retry) clearTimeout(retry);
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      ws.close();
      ws = null;
    }
  };
}
