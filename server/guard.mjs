// The one request guard of the deck (DNS-rebinding, cross-site and remote-access guard). server/index.mjs runs it before ANY
// handler, for every request (pages, /_next assets, every /api route, SSE) and every WebSocket upgrade:
//   * Host must be 127.0.0.1:<port>, localhost:<port>, [::1]:<port>, or one of config server.allowedHosts;
//   * an Origin header, when present, must name one of those hosts (a foreign or "null" Origin is refused);
//   * an /api request (and every upgrade) that the browser marks as cross-site or same-site (Sec-Fetch-Site) is refused, so
//     an <img src> or a form on another site cannot trigger a side-effecting GET (no Origin is sent for those);
//   * a request that does not come straight from this machine (non-loopback socket, a proxy / tunnel header, or a Host that is
//     not a loopback name) needs the access token (config server.accessToken): the `sd_access` cookie, set by opening any page
//     with `?token=<token>` once, or `Authorization: Bearer <token>`. Loopback stays token-free. With no token configured,
//     remote requests are refused unless server.allowUnauthenticatedRemote is true (config.mjs refuses to start otherwise).
// The settings and setup routes keep their stricter checks on top (server/settings.mjs: loopback socket, no proxy headers,
// loopback Host only, same Origin and a CSRF token for every write).
import crypto from "node:crypto";

export const COOKIE = "sd_access";
const COOKIE_DAYS = 30;
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
export const PROXY_HEADERS = ["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "forwarded", "cf-connecting-ip", "cf-ray", "via"];

const digest = (s) => crypto.createHash("sha256").update(String(s)).digest();
/** Constant-time comparison (both sides hashed first, so the length does not leak either). */
export const sameToken = (a, b) => typeof a === "string" && typeof b === "string" && a.length > 0 && b.length > 0 && crypto.timingSafeEqual(digest(a), digest(b));

function cookieOf(req, name) {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) { try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; } }
  }
  return null;
}

/**
 * @param {{ port: number, allowedHosts?: string[], auth?: () => { token: string | null, allowUnauthenticatedRemote: boolean } }} o
 * `auth` is read on every request, so a token rotated in Settings applies at once.
 */
export function createGuard({ port, allowedHosts = [], auth = () => ({ token: null, allowUnauthenticatedRemote: false }) }) {
  const local = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  const hosts = new Set([...local, ...allowedHosts.map((h) => String(h).toLowerCase())]);
  const okOrigin = (o) => {
    if (o === undefined) return true;
    const m = /^https?:\/\/([^/]+)$/i.exec(String(o));
    return !!m && hosts.has(m[1].toLowerCase());
  };
  const loopbackSocket = (req) => LOOPBACK.has(req.socket?.remoteAddress || "");
  /** Straight from this machine: loopback socket, no proxy / tunnel header, a loopback Host. */
  const isLocal = (req) => loopbackSocket(req) && !PROXY_HEADERS.some((h) => req.headers[h] !== undefined) && local.has(String(req.headers.host || "").toLowerCase());
  /** The request reached the deck over https (X-Forwarded-Proto is only believed from a loopback socket: a local tunnel). */
  const https = (req) => !!req.socket?.encrypted || (loopbackSocket(req) && String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase() === "https");
  const bearer = (req) => { const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization || "")); return m ? m[1] : null; };

  /** null when the request may go on, else [status, reason]. `api`: an /api request or an upgrade (the cross-site check). */
  function check(req, api = true) {
    const host = String(req.headers.host || "").toLowerCase();
    if (!hosts.has(host)) return [403, "wrong host"];
    if (!okOrigin(req.headers.origin)) return [403, "foreign origin"];
    const site = req.headers["sec-fetch-site"];
    if (api && (site === "cross-site" || site === "same-site")) return [403, "cross-site request"];
    if (isLocal(req)) return null;
    const { token, allowUnauthenticatedRemote } = auth();
    if (!token) return allowUnauthenticatedRemote ? null : [403, "remote access is off: no access token is configured"];
    if (sameToken(cookieOf(req, COOKIE), token) || sameToken(bearer(req), token)) return null;
    return [401, "access token required"];
  }

  /**
   * The `?token=` exchange: a GET with a token in the query, on an allowed Host. A right token sets the cookie and sends the
   * browser on to the same URL without the token (a page that navigates itself, so the SameSite=Strict cookie is sent even
   * when the link was opened from another site); a wrong one is 401. Returns true when the request was answered.
   */
  function exchange(req, res, url) {
    if (req.method !== "GET" || !url.searchParams.has("token")) return false;
    if (!hosts.has(String(req.headers.host || "").toLowerCase())) return false; // check() answers it
    const { token } = auth();
    if (!sameToken(url.searchParams.get("token"), token)) {
      refuseHttp(res, [401, "wrong access token"]);
      return true;
    }
    const clean = new URL(url.href);
    clean.searchParams.delete("token");
    const to = clean.pathname + clean.search;
    const cookie = `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_DAYS * 86400}${https(req) ? "; Secure" : ""}`;
    const js = JSON.stringify(to).replace(/</g, "\\u003c");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "set-cookie": cookie });
    res.end(`<!doctype html><meta charset="utf-8"><title>lanedeck</title><meta http-equiv="refresh" content="0;url=${to.replace(/[&"<>]/g, (c) => `&#${c.charCodeAt(0)};`)}"><script>location.replace(${js})</script>`);
    return true;
  }
  return { hosts, check, exchange, isLocal, https };
}

/** A refusal written straight to an HTTP response. With `html`, a 401 page explains how to get in. */
export function refuseHttp(res, [code, reason], { html = false } = {}) {
  if (html && code === 401) {
    res.writeHead(401, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
    res.end(`<!doctype html><meta charset="utf-8"><title>lanedeck: access token required</title><body style="font:15px system-ui;margin:3rem;max-width:40rem"><h1 style="font-size:1.2rem">Access token required</h1><p>This deck is reached from outside its own machine. Open it once with <code>?token=&lt;access token&gt;</code> added to the address. The token is in Settings &rarr; General, on the machine itself (http://localhost).</p></body>`);
    return;
  }
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(JSON.stringify({ error: reason }));
}

/** A refusal written to a raw socket (upgrade requests). */
export function refuseSocket(socket, [code, reason]) {
  const text = { 401: "Unauthorized", 403: "Forbidden" }[code] || "Error";
  try { socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(reason)}\r\n\r\n${reason}`); } catch { /* gone */ }
  socket.destroy();
}
