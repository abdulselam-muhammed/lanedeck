// The CI runners panel: a READ-ONLY view of the org's real
// GitHub runners on this machine and of the jobs of the whole org. It is part of the viewer process and
// port (127.0.0.1:4280); everything lives under /api/ci/*. ONE live channel (WebSocket, live.mjs), lists on demand.
//   WS  /api/ci/ws                    live: hello, then jobs / agg / runners / qd / state / meta increments (live.mjs)
//   GET /api/ci/summary               the aggregates only (the Overview tile's first paint)
//   GET /api/ci/org?repo&runner&person&status&cursor&limit    one page of the last 24 h (default 50); options with page 1
//   GET /api/ci/queue/jobs?label&repo&person&ghosts&cursor&limit   one page of the waiting jobs, oldest first
//   GET /api/ci/real?cursor&limit     one page of this machine's jobs, newest first
//   GET /api/ci/real/jobs/:id         the steps of one job (only when a row is opened)
//   GET /api/ci/real/jobs/:id/log     the saved (scrubbed) log of a job of this machine
//   GET /api/ci/org/jobs/:id/log      the log of any completed job, fetched from GitHub once, scrubbed
//   GET /api/ci/real/tail/:container  SSE: the live log of one local runner container (only while a row is open)
// Safety kept from the old app: GET only, DNS-rebinding + cross-origin guards, at most 20 streams / sockets, GitHub
// is read with `gh api` (GET, ETag, rate-limit pacing), tokens are never stored, every log is scrubbed.
import fs from "node:fs";
import path from "node:path";
import { RealRunners } from "./real.mjs";
import { orgPage, orgLog, minePage, queueJobsPage, jobSteps } from "./org.mjs";
import { createLive } from "./live.mjs";

const MAX_STREAMS = 20;
const SEC = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };

/** @param {{ root: string, port: number }} o  root = the viewer folder; the panel's data lives in <root>/data/ci */
export function createCi({ root }) {
  // Host and Origin are checked once for every request by server/guard.mjs (server/index.mjs), before this handler runs.
  const dataRoot = path.join(root, "data", "ci");
  fs.mkdirSync(dataRoot, { recursive: true });
  const tails = new Set();
  const real = new RealRunners({ root: dataRoot });
  real.start();
  const live = createLive({ real, dataRoot });

  const send = (res, code, body, type = "application/json; charset=utf-8") => {
    res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store", ...SEC });
    res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  const stream = (req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no", ...SEC });
    res.write("retry: 3000\n\n");
    const ka = setInterval(() => res.write(": ka\n\n"), 15000);
    req.on("close", () => clearInterval(ka));
  };

  /** Returns true when the request was for /api/ci/* and has been answered. */
  async function handle(req, res, url) {
    const p = url.pathname;
    if (!p.startsWith("/api/ci/")) return false;
    try {
      if (req.method !== "GET") return send(res, 405, { error: "read-only" }), true;
      const r = p.slice("/api/ci".length);
      const q = url.searchParams;
      if (r === "/summary") return send(res, 200, live.summary()), true;
      if (r === "/real") return send(res, 200, minePage(real, q)), true;
      if (r === "/org") return send(res, 200, orgPage(real, q)), true;
      if (r === "/queue/jobs") return send(res, 200, queueJobsPage(real, q)), true;
      let m = /^\/real\/jobs\/(\d+)$/.exec(r);
      if (m) {
        const j = jobSteps(real, m[1]);
        return j ? send(res, 200, j) : send(res, 404, { error: "unknown job" }), true;
      }
      m = /^\/org\/jobs\/(\d+)\/log$/.exec(r);
      if (m) {
        const o = await orgLog(real, m[1]);
        return send(res, o.code, o.text, "text/plain; charset=utf-8"), true;
      }
      m = /^\/real\/jobs\/(\d+)\/log$/.exec(r);
      if (m) {
        const t = real.jobLog(m[1]);
        return t == null ? send(res, 404, { error: "log not fetched yet (it is saved when the job completes)" }) : send(res, 200, t, "text/plain; charset=utf-8"), true;
      }
      m = /^\/real\/tail\/([\w.-]+)$/.exec(r);
      if (m) {
        if (tails.size >= MAX_STREAMS) return send(res, 503, { error: "too many streams" }), true;
        stream(req, res);
        let stop = () => {};
        try {
          stop = real.tail(m[1], (line) => res.write(`data: ${JSON.stringify(line)}\n\n`));
        } catch (e) {
          res.write(`data: ${JSON.stringify(String(e.message))}\n\n`);
        }
        tails.add(res);
        req.on("close", () => { stop(); tails.delete(res); });
        return true;
      }
      return send(res, 404, { error: "not found" }), true;
    } catch (e) {
      if (res.headersSent) {
        try { res.end(); } catch { /* closed */ }
        return true;
      }
      return send(res, 400, { error: String(e.message || e) }), true;
    }
  }
  handle.upgrade = live.upgrade;
  // For the SSE channel (server/index.mjs): the runners summary + the reader's change events.
  handle.summary = live.summary;
  handle.onChange = (fn) => real.on("event", fn);
  return handle;
}
