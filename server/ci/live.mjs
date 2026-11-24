// The ONE live channel of the /ci page: a read-only WebSocket at /api/ci/ws (server -> browser only).
//   hello    on connect, once: agg, runners, state, meta, qd (queue-depth samples, [[t,n],...])
//   jobs     {rows}  changed job rows, slim (the same shape as the paginated lists)
//   agg      recomputed aggregates (KPI numbers, hourly bins, queue label counts), debounced to <= 1 per 2 s, only when changed
//   runners  the self-hosted runner list, only when it changed
//   qd       {p:[t,n]} one new queue-depth sample (every 30 s)
//   state    this machine's runner cards, when they change
//   meta     GitHub rate-limit / request numbers, when they change
// `?topics=agg` (the Overview tile) gets only hello{agg} and agg messages. The client sends nothing (a small {"t":"ping"}
// is answered; anything else closes the socket). Safety: Host + Origin guards, at most 20 clients, 25 s heartbeat that
// terminates dead sockets, a slow reader is cut at 2 MB buffered. Nothing here talks to GitHub: it only fans out what
// the existing readers (real.mjs) already learned, so the GitHub request pacing is unchanged.
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { aggregates, queueDepthNow, runnerList, slim, wireState } from './org.mjs';

const MAX_CLIENTS = 20;
const AGG_MIN_MS = 2000;
const BEAT_MS = 25000;
const DAY = 24 * 3600e3;
const SAMPLE_MS = 30000;
const MAX_SAMPLES = 2880;

/** @param {{ real: import('./real.mjs').RealRunners, dataRoot: string }} o */
export function createLive({ real, dataRoot }) {
  // Queue depth, sampled by the server every 30 s, so the chart is whole on first load. Samples start once GitHub has
  // been read (an empty store is not a zero queue). Kept 24 h (2880 points), saved every 5 min.
  const histFile = path.join(dataRoot, 'queue-depth.json');
  let hist = [];
  try { hist = JSON.parse(fs.readFileSync(histFile, 'utf8')).filter((x) => x && Number.isFinite(x.t) && Number.isFinite(x.n) && Date.now() - x.t < DAY); } catch { /* none yet */ }
  const save = () => { try { fs.writeFileSync(histFile, JSON.stringify(hist)); } catch { /* best effort */ } };

  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 });
  /** @type {Map<import('ws').WebSocket, { topics: Set<string>, alive: boolean, last: Record<string, string> }>} */
  const clients = new Map();
  const wanting = (topic) => [...clients.values()].some((c) => c.topics.has(topic));
  const send = (ws, msg) => {
    if (ws.readyState !== 1) return;
    if (ws.bufferedAmount > 2e6) { ws.terminate(); return; }
    ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  };
  const broadcast = (topic, msg) => {
    if (!clients.size) return;
    const s = JSON.stringify(msg);
    for (const [ws, c] of clients) if (c.topics.has(topic)) send(ws, s);
  };

  // Queue-depth samples for a hello: the last hour as sampled, older ones max-per-5-minutes (a spike stays visible).
  const qdForHello = () => {
    const now = Date.now(); const out = []; let bucket = null;
    for (const x of hist) {
      if (now - x.t <= 3600e3) { if (bucket) { out.push(bucket); bucket = null; } out.push([x.t, x.n]); continue; }
      const b = Math.floor(x.t / 300e3);
      if (bucket && bucket.b === b) { if (x.n > bucket[1]) bucket[1] = x.n; } else { if (bucket) out.push(bucket); bucket = [b * 300e3, x.n]; bucket.b = b; }
    }
    if (bucket) out.push(bucket);
    return out.map((p) => [p[0], p[1]]);
  };

  let aggAt = 0, aggT = null;
  /** Send {t, [key]: value} to the clients subscribed to `topic` whose last copy of `key` differs (the value is compared per client). */
  const fan = (topic, t, key, value) => {
    if (!clients.size) return;
    const body = JSON.stringify(value);
    let msg = null;
    for (const [ws, c] of clients) {
      if (!c.topics.has(topic) || c.last[key] === body) continue;
      c.last[key] = body;
      msg = msg || `{"t":"${t}","${key}":${body}}`;
      send(ws, msg);
    }
  };
  const metaOf = () => { const { at, ...m } = real.meta(); void at; return m; };

  /** Recompute the aggregates + runner list and push whatever changed. */
  const pushAgg = () => {
    aggT = null; aggAt = Date.now();
    if (!clients.size) return;
    const runners = runnerList(real);
    const agg = aggregates(real, runners);
    fan('agg', 'agg', 'agg', agg);
    fan('runners', 'runners', 'runners', runners);
  };
  const scheduleAgg = () => {
    if (aggT || !clients.size) return;
    aggT = setTimeout(pushAgg, Math.max(0, AGG_MIN_MS - (Date.now() - aggAt)));
  };

  real.on('event', (ev) => {
    if (!clients.size) return;
    if (ev.type === 'jobs') { broadcast('jobs', { t: 'jobs', rows: ev.jobs.map(slim) }); scheduleAgg(); }
    else if (ev.type === 'state') { fan('state', 'state', 'state', wireState(ev.state)); scheduleAgg(); }
    else if (ev.type === 'meta') { fan('meta', 'meta', 'meta', metaOf()); }
  });

  const sample = () => {
    if (!real.rl || !real.rl.githubAt) return;
    let n;
    try { n = queueDepthNow(real); } catch { return; }
    const p = [Date.now(), n];
    hist.push({ t: p[0], n });
    hist = hist.filter((x) => Date.now() - x.t < DAY).slice(-MAX_SAMPLES);
    broadcast('qd', { t: 'qd', p });
  };
  setInterval(sample, SAMPLE_MS).unref?.();
  setInterval(save, 300000).unref?.();
  setTimeout(sample, 15000).unref?.();
  // Time moves the numbers too (a runner turns "maybe offline", a job turns into an orphan, the hour rolls over).
  setInterval(() => scheduleAgg(), 30000).unref?.();

  // Heartbeat: a ping every 25 s; a socket that did not answer the previous one is terminated.
  setInterval(() => {
    for (const [ws, c] of clients) {
      if (!c.alive) { ws.terminate(); continue; }
      c.alive = false;
      try { ws.ping(); } catch { /* closing */ }
    }
  }, BEAT_MS).unref?.();

  /** The full state of the page as a client needs it on connect. */
  const helloFor = (c) => {
    const runners = runnerList(real);
    const agg = aggregates(real, runners);
    c.last.agg = JSON.stringify(agg);
    if (!c.topics.has('jobs')) return { t: 'hello', agg };
    const state = wireState(real.state); const meta = metaOf();
    c.last.runners = JSON.stringify(runners); c.last.state = JSON.stringify(state); c.last.meta = JSON.stringify(meta);
    return { t: 'hello', agg, runners, state, meta, qd: qdForHello() };
  };

  const refuse = (socket, code, text) => {
    try { socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); } catch { /* gone */ }
    socket.destroy();
  };

  return {
    /** Current aggregates, for GET /api/ci/summary (the Overview tile's first paint). */
    summary: () => aggregates(real),
    queueDepth: () => hist,
    /** `server.on('upgrade')` handler for /api/ci/ws; other paths are left to Next. */
    upgrade(req, socket, head, url) {
      // Host and Origin: checked for every upgrade by server/guard.mjs before this runs.
      if (clients.size >= MAX_CLIENTS) return refuse(socket, 503, 'Service Unavailable');
      wss.handleUpgrade(req, socket, head, (ws) => {
        const lite = url.searchParams.get('topics') === 'agg';
        const c = { topics: new Set(lite ? ['agg'] : ['jobs', 'agg', 'runners', 'qd', 'state', 'meta']), alive: true, last: { agg: '', runners: '', state: '', meta: '' } };
        clients.set(ws, c);
        ws.on('pong', () => { c.alive = true; });
        ws.on('message', (data, isBinary) => {
          c.alive = true;
          let ok = false;
          if (!isBinary) { try { ok = JSON.parse(String(data)).t === 'ping'; } catch { /* not JSON */ } }
          if (ok) send(ws, '{"t":"pong"}'); else ws.close(1008, 'read-only');
        });
        const gone = () => { clients.delete(ws); };
        ws.on('close', gone);
        ws.on('error', () => { gone(); try { ws.terminate(); } catch { /* gone */ } });
        // The hello carries the numbers as of now; changes of the last moments follow as increments.
        send(ws, helloFor(c));
      });
    },
    close() { for (const ws of clients.keys()) ws.terminate(); wss.close(); },
  };
}
