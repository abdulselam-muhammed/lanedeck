// Remote-access token (issue #20): loopback stays token-free; anything else needs the token (cookie or Bearer); the config
// refuses allowedHosts without a token unless allowUnauthenticatedRemote is set.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sd-tok-"));
process.on("exit", () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } });
fs.writeFileSync(path.join(tmp, "config.json"), "{}");
process.env.LANEDECK_CONFIG = path.join(tmp, "config.json");

const { createGuard, sameToken, COOKIE } = await import("../server/guard.mjs");
const { checkSettings, remoteAuthProblem } = await import("../server/config.mjs");

const TOKEN = "a".repeat(20) + "B_c-" + "9".repeat(20);
let auth = { token: TOKEN, allowUnauthenticatedRemote: false };
const g = createGuard({ port: 4998, allowedHosts: ["deck.example.dev"], auth: () => auth });
const req = (headers, remoteAddress = "127.0.0.1") => ({ headers, socket: { remoteAddress } });
const code = (r) => g.check(r)?.[0] ?? 200;

test("loopback stays token-free", () => {
  auth = { token: TOKEN, allowUnauthenticatedRemote: false };
  for (const host of ["127.0.0.1:4998", "localhost:4998", "[::1]:4998"]) assert.equal(code(req({ host })), 200, host);
  assert.equal(code(req({ host: "localhost:4998" }, "::ffff:127.0.0.1")), 200);
});

test("tunnel Host, proxy headers and non-loopback sockets need the token", () => {
  auth = { token: TOKEN, allowUnauthenticatedRemote: false };
  assert.equal(code(req({ host: "deck.example.dev" })), 401);
  assert.equal(code(req({ host: "localhost:4998", "cf-connecting-ip": "1.2.3.4" })), 401);
  assert.equal(code(req({ host: "localhost:4998", "x-forwarded-for": "1.2.3.4" })), 401);
  assert.equal(code(req({ host: "127.0.0.1:4998" }, "192.168.1.20")), 401); // LAN client forging a loopback Host
});

test("the cookie or a Bearer header with the right token passes; a wrong one does not", () => {
  auth = { token: TOKEN, allowUnauthenticatedRemote: false };
  assert.equal(code(req({ host: "deck.example.dev", cookie: `x=1; ${COOKIE}=${TOKEN}` })), 200);
  assert.equal(code(req({ host: "deck.example.dev", authorization: `Bearer ${TOKEN}` })), 200);
  assert.equal(code(req({ host: "deck.example.dev", cookie: `${COOKIE}=${TOKEN}x` })), 401);
  assert.equal(code(req({ host: "deck.example.dev", authorization: "Bearer nope" })), 401);
  assert.equal(code(req({ host: "evil.example", cookie: `${COOKIE}=${TOKEN}` })), 403); // the Host check still comes first
});

test("no token: remote refused, unless allowUnauthenticatedRemote", () => {
  auth = { token: null, allowUnauthenticatedRemote: false };
  assert.equal(code(req({ host: "deck.example.dev" })), 403);
  assert.equal(code(req({ host: "localhost:4998" })), 200);
  auth = { token: null, allowUnauthenticatedRemote: true };
  assert.equal(code(req({ host: "deck.example.dev" })), 200);
});

test("sameToken is exact", () => {
  assert.equal(sameToken(TOKEN, TOKEN), true);
  assert.equal(sameToken(TOKEN, TOKEN.slice(1)), false);
  assert.equal(sameToken("", ""), false);
  assert.equal(sameToken(null, TOKEN), false);
});

function fakeRes() {
  const r = { code: 0, headers: {}, body: "" };
  return { r, writeHead(c, h) { r.code = c; r.headers = h; }, end(b) { r.body = String(b ?? ""); } };
}
const exch = (headers, remote, href) => {
  const res = fakeRes();
  const handled = g.exchange({ method: "GET", headers, socket: { remoteAddress: remote } }, res, new URL(href, "http://localhost"));
  return { handled, ...res.r };
};

test("?token= exchange: sets an HttpOnly SameSite=Strict cookie and sends on without the token", () => {
  auth = { token: TOKEN, allowUnauthenticatedRemote: false };
  const ok = exch({ host: "deck.example.dev" }, "127.0.0.1", `/prs?x=1&token=${TOKEN}`);
  assert.equal(ok.handled, true);
  assert.equal(ok.code, 200);
  const c = ok.headers["set-cookie"];
  assert.match(c, new RegExp(`^${COOKIE}=`));
  assert.match(c, /HttpOnly/);
  assert.match(c, /SameSite=Strict/);
  assert.doesNotMatch(c, /Secure/);
  assert.match(ok.body, /location\.replace\("\/prs\?x=1"\)/);
  assert.doesNotMatch(ok.body, new RegExp(TOKEN));
  assert.equal(exch({ host: "deck.example.dev" }, "127.0.0.1", "/?token=wrong").code, 401);
  assert.equal(exch({ host: "deck.example.dev" }, "127.0.0.1", "/").handled, false);
});

test("Secure only when the request came over https (X-Forwarded-Proto believed from loopback only)", () => {
  auth = { token: TOKEN, allowUnauthenticatedRemote: false };
  assert.match(exch({ host: "deck.example.dev", "x-forwarded-proto": "https" }, "127.0.0.1", `/?token=${TOKEN}`).headers["set-cookie"], /; Secure/);
  assert.doesNotMatch(exch({ host: "deck.example.dev", "x-forwarded-proto": "https" }, "10.0.0.5", `/?token=${TOKEN}`).headers["set-cookie"], /Secure/);
});

test("config: allowedHosts or a non-loopback host without a token is a start-up refusal with a clear message", () => {
  const srv = (x) => checkSettings({ server: x }).settings.server;
  const bad = remoteAuthProblem(srv({ allowedHosts: ["deck.example.dev"] }));
  assert.match(bad, /server\.accessToken is required/);
  assert.match(bad, /allowUnauthenticatedRemote/);
  assert.ok(remoteAuthProblem(srv({ host: "0.0.0.0" })));
  assert.equal(remoteAuthProblem(srv({ allowedHosts: ["deck.example.dev"], accessToken: TOKEN })), null);
  assert.equal(remoteAuthProblem(srv({ allowedHosts: ["deck.example.dev"], allowUnauthenticatedRemote: true })), null);
  assert.equal(remoteAuthProblem(srv({})), null);
  assert.equal(checkSettings({ server: { accessToken: "short" } }).ok, false);
});
