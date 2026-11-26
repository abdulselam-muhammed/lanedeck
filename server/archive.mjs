// Archiving of the Inbox's agent files. NOTHING is ever deleted: "archive" MOVES a file (or a folder) into
// `<inbox>/.archive/YYYY-MM/<same relative path>` and writes a small manifest beside it (`<item>.archived.json`: original path,
// when, by whom), so "restore" can put it back exactly where it was. If the original path is taken again, the item is restored
// beside it with a suffix; nothing is ever overwritten.
//
// The inbox is untrusted when it is a project's own `.lanedeck/inbox` (a cloned repo): every path goes through server/safepath.mjs
// (no `..`, no symlink or junction component, stays inside the root). Moves are a rename; across devices a file is copied,
// verified (size + SHA-256) and only then removed. A file another program holds open (Windows) answers code "locked".
//
// The agents' scanners never see the archive: the inbox is read flat (only top-level *.md files), and `.archive` is a dot-folder
// (docs/PROTOCOL.md reserves it, like `_archive/`).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { PROTOCOL_DIR, QUESTION_ID, questionsOf } from "./protocol.mjs";
import { createPlain, lexists, mkdirSafe, readPlain, realRoot, safePath } from "./safepath.mjs";

export const ARCHIVE_DIR = ".archive";
const SUFFIX = ".archived.json";
const MAX_ITEMS = 500;
const MAX_LIST = 5000;
const DAY = 864e5;
const fail = (code, status = 400) => Object.assign(new Error(code), { code, status });

/** The checked root of an inbox: { root, pre } so that safePath(root, [...pre, ...rel]) is a path inside it. */
export function inboxRoot(inboxDir, repoPath) {
  if (repoPath && path.resolve(inboxDir) === path.resolve(repoPath, PROTOCOL_DIR, "inbox")) return { root: realRoot(repoPath), pre: [PROTOCOL_DIR, "inbox"] };
  if (repoPath && path.resolve(inboxDir) === path.resolve(repoPath, ".selam-deck", "inbox")) return { root: realRoot(repoPath), pre: [".selam-deck", "inbox"] };
  return { root: realRoot(inboxDir), pre: [] };
}

/** "a/b.md" -> ["a","b.md"], or throws code "bad-path". The first part may not be the archive itself or a `_` folder. */
export function parseRel(s) {
  if (typeof s !== "string" || !s || s.length > 400 || /[\u0000-\u001f]/.test(s) || s.includes("\\")) throw fail("bad-path");
  const parts = s.split("/");
  if (parts.length > 8 || parts.some((p) => !p || p === "." || p === ".." || p.length > 200)) throw fail("bad-path");
  if (parts[0] === ARCHIVE_DIR || parts[0] === "_archive" || parts[parts.length - 1].endsWith(SUFFIX)) throw fail("bad-path");
  return parts;
}

const monthOf = (now) => new Date(now).toISOString().slice(0, 7);
const LOCK_CODES = new Set(["EBUSY", "EPERM", "EACCES", "ETXTBSY"]);
const wrap = (e) => (e?.code && !e.status && LOCK_CODES.has(e.code) ? fail("locked", 409) : e);

/** Open "## ID" questions of a file: protocol files count the ones without an **Answer:** line, legacy files every question line. */
export function hasOpenQuestions(text, proto) {
  if (proto) return questionsOf(text).some((q) => !q.answered);
  return String(text).replace(/\r\n?/g, "\n").split("\n").some((l) => QUESTION_ID.test(l));
}

const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
/** A file or folder moved to `dest`, never over something that is already there. Throws code "clash" when the name is taken. */
function moveNoClobber(src, dest, kind) {
  if (lexists(dest)) throw fail("clash", 409);
  try {
    if (kind === "file") {
      try { fs.linkSync(src, dest); } catch (e) {
        if (e.code === "EEXIST") throw fail("clash", 409);
        if (lexists(dest)) throw fail("clash", 409);
        fs.renameSync(src, dest); // no hard links on this volume: rename after the check above
        return;
      }
      try { fs.unlinkSync(src); } catch (e) { fs.rmSync(dest, { force: true }); throw e; } // the file is held open: undo the link
      return;
    }
    fs.renameSync(src, dest);
  } catch (e) {
    if (e.code === "EXDEV" && kind === "file") {
      fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
      if (fs.statSync(dest).size !== fs.statSync(src).size || sha(dest) !== sha(src)) { fs.rmSync(dest, { force: true }); throw fail("verify-failed", 500); }
      fs.unlinkSync(src);
      return;
    }
    throw wrap(e);
  }
}

/** The first free name for `parts` under the month folder: foo.md, foo (2).md, foo (3).md ... */
function freeName(root, base, parts) {
  const last = parts[parts.length - 1];
  const ext = path.extname(last), stem = ext ? last.slice(0, -ext.length) : last;
  for (let i = 1; i < 1000; i++) {
    const name = i === 1 ? last : `${stem} (${i})${ext}`;
    const rel = [...base, ...parts.slice(0, -1), name];
    if (!lexists(safePath(root, rel)) && !lexists(safePath(root, [...rel.slice(0, -1), name + SUFFIX]))) return rel;
  }
  throw fail("clash", 409);
}

/**
 * Archive `names` (paths relative to the inbox). Options: `by` ("manual" | "auto"), `skipOpenQuestions` (leave files with an
 * unanswered question), `olderThanDays` (leave files modified more recently), `proto`, `now`.
 * Returns { archived: [{ name, id }], skipped: [{ name, code }] }; one bad name never stops the others.
 */
export function archiveItems(ctx, names, o = {}) {
  const { by = "manual", skipOpenQuestions = false, olderThanDays = 0, now = Date.now() } = o;
  if (!Array.isArray(names) || names.length > MAX_ITEMS) throw fail("bad-request");
  const { root, pre } = inboxRoot(ctx.inboxDir, ctx.repoPath);
  const archived = [], skipped = [];
  for (const name of names) {
    try {
      const parts = parseRel(name);
      const src = safePath(root, [...pre, ...parts]);
      let st;
      try { st = fs.lstatSync(src); } catch { throw fail("missing", 404); }
      if (st.isSymbolicLink() || !(st.isFile() || st.isDirectory())) throw fail("bad-path");
      const kind = st.isDirectory() ? "dir" : "file";
      if (olderThanDays > 0 && st.mtimeMs > now - olderThanDays * DAY) throw fail("too-new");
      if (skipOpenQuestions && kind === "file") {
        const text = readPlain(src);
        if (text != null && hasOpenQuestions(text, !!ctx.proto)) throw fail("open-question");
      }
      const base = [ARCHIVE_DIR, monthOf(now)];
      mkdirSafe(root, [...pre, ...base]);
      const rel = freeName(root, [...pre, ...base], parts);
      if (parts.length > 1) mkdirSafe(root, rel.slice(0, -1));
      const dest = safePath(root, rel);
      const meta = safePath(root, [...rel.slice(0, -1), rel[rel.length - 1] + SUFFIX]);
      createPlain(meta, JSON.stringify({ version: 1, original: parts.join("/"), kind, archivedAt: new Date(now).toISOString(), by, mtime: st.mtimeMs, size: kind === "file" ? st.size : null }, null, 2) + "\n");
      try { moveNoClobber(src, dest, kind); } catch (e) { fs.rmSync(meta, { force: true }); throw e; }
      archived.push({ name: parts.join("/"), id: rel.slice(pre.length + 1).join("/") });
    } catch (e) {
      skipped.push({ name: String(name), code: e.unsafe ? "unsafe" : e.code && typeof e.code === "string" && e.status ? e.code : "failed" });
    }
  }
  return { archived, skipped };
}

function readManifest(p) {
  const text = readPlain(p);
  if (text == null) return null;
  try {
    const m = JSON.parse(text);
    if (!m || typeof m.original !== "string" || (m.kind !== "file" && m.kind !== "dir")) return null;
    return { original: m.original, kind: m.kind, archivedAt: String(m.archivedAt || ""), by: m.by === "auto" ? "auto" : "manual", mtime: Number(m.mtime) || null, size: Number.isFinite(m.size) ? m.size : null };
  } catch { return null; }
}

const titleOf = (p) => {
  try {
    if (fs.statSync(p).size > 1 << 20) return null;
    const m = String(readPlain(p) ?? "").match(/^#\s+(.+)$/m);
    return m ? m[1].trim().slice(0, 160) : null;
  } catch { return null; }
};

/** Every archived item, newest first: { id, original, kind, archivedAt, by, mtime, size, title, missing }. */
export function listArchive(ctx) {
  let root, pre, top;
  try { ({ root, pre } = inboxRoot(ctx.inboxDir, ctx.repoPath)); top = safePath(root, [...pre, ARCHIVE_DIR]); } catch { return []; } // no inbox folder yet: nothing archived
  const items = [];
  const walk = (dir, parts, depth) => {
    if (depth > 10 || items.length >= MAX_LIST) return;
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.isSymbolicLink()) continue;
      const full = path.join(dir, e.name);
      if (e.isFile() && e.name.endsWith(SUFFIX)) {
        const m = readManifest(full);
        if (!m) continue;
        const id = [...parts, e.name.slice(0, -SUFFIX.length)].join("/");
        const itemPath = full.slice(0, -SUFFIX.length);
        const exists = lexists(itemPath);
        items.push({ id, ...m, title: exists && m.kind === "file" ? titleOf(itemPath) : null, missing: !exists });
      } else if (e.isDirectory() && !lexists(path.join(dir, e.name + SUFFIX))) walk(full, [...parts, e.name], depth + 1);
    }
  };
  if (lexists(top)) walk(top, [], 0);
  return items.sort((a, b) => (b.archivedAt || "").localeCompare(a.archivedAt || "") || a.id.localeCompare(b.id));
}

/** The first free place beside `parts`: foo.md, foo (restored).md, foo (restored 2).md ... */
function freeRestoreName(root, pre, parts) {
  const last = parts[parts.length - 1];
  const ext = path.extname(last), stem = ext ? last.slice(0, -ext.length) : last;
  for (let i = 0; i < 1000; i++) {
    const name = i === 0 ? last : `${stem} (restored${i > 1 ? " " + i : ""})${ext}`;
    const rel = [...pre, ...parts.slice(0, -1), name];
    if (!lexists(safePath(root, rel))) return rel;
  }
  throw fail("clash", 409);
}

/**
 * Restore archived items by id (or all of them). A taken original path gets a suffix, never an overwrite.
 * Returns { restored: [{ id, to, renamed }], failed: [{ id, code }] }.
 */
export function restoreItems(ctx, ids, o = {}) {
  const { now = Date.now() } = o;
  const { root, pre } = inboxRoot(ctx.inboxDir, ctx.repoPath);
  if (ids === "all") ids = listArchive(ctx).filter((i) => !i.missing).map((i) => i.id);
  if (!Array.isArray(ids) || ids.length > MAX_LIST) throw fail("bad-request");
  const restored = [], failed = [];
  for (const id of ids) {
    try {
      const parts = typeof id === "string" ? id.split("/") : [];
      if (parts.length < 2 || parts.length > 9 || !/^\d{4}-\d{2}$/.test(parts[0]) || parts.some((p) => !p || p === "." || p === ".." || p.includes("\\")) || parts[parts.length - 1].endsWith(SUFFIX)) throw fail("bad-path");
      const rel = [...pre, ARCHIVE_DIR, ...parts];
      const item = safePath(root, rel);
      const meta = safePath(root, [...rel.slice(0, -1), rel[rel.length - 1] + SUFFIX]);
      const m = readManifest(meta);
      if (!m) throw fail("no-manifest", 404);
      if (!lexists(item)) throw fail("missing", 404);
      const orig = parseRel(m.original);
      const target = freeRestoreName(root, pre, orig);
      if (orig.length > 1) mkdirSafe(root, target.slice(0, -1));
      const dest = safePath(root, target);
      moveNoClobber(item, dest, m.kind);
      if (m.kind === "file") { try { fs.utimesSync(dest, now / 1000, now / 1000); } catch { /* the time is a convenience (so the daily sweep does not take it straight back) */ } }
      fs.rmSync(meta, { force: true });
      restored.push({ id, to: target.slice(pre.length).join("/"), renamed: target[target.length - 1] !== orig[orig.length - 1] });
    } catch (e) {
      failed.push({ id: String(id), code: e.unsafe ? "unsafe" : e.code && typeof e.code === "string" && e.status ? e.code : "failed" });
    }
  }
  return { restored, failed };
}

/** The top-level files the daily sweep may take: plain *.md, not 00-README / 00-setup.md, not `_` or `.` names. */
const SWEEP_SKIP = /^(00-readme|00-setup\.md$)/i;

/**
 * The automatic rule: every top-level inbox file whose last modification is older than `days` days is archived, EXCEPT a file
 * with an unanswered question (it is still waiting for a human, however old it is). Returns the archiveItems() result.
 */
export function autoArchive(ctx, days, now = Date.now()) {
  if (!Number.isInteger(days) || days < 1) return { archived: [], skipped: [] };
  const { root, pre } = inboxRoot(ctx.inboxDir, ctx.repoPath);
  const dir = safePath(root, pre);
  const names = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isFile() || !e.name.toLowerCase().endsWith(".md") || e.name.startsWith("_") || e.name.startsWith(".") || SWEEP_SKIP.test(e.name)) continue;
    names.push(e.name);
  }
  return archiveItems(ctx, names.slice(0, MAX_ITEMS), { by: "auto", skipOpenQuestions: true, olderThanDays: days, now });
}

// ---------- HTTP ----------
const MAX_BODY = 256 * 1024;
const reply = (res, code, body) => {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify(body));
};
const readBody = (req) => new Promise((resolve) => {
  let size = 0;
  const parts = [];
  req.on("data", (c) => { size += c.length; if (size > MAX_BODY) { req.destroy(); resolve(null); } else parts.push(c); });
  req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(parts).toString("utf8") || "{}")); } catch { resolve(null); } });
  req.on("error", () => resolve(null));
});

/**
 * GET /api/archive; POST /api/archive { names, skipOpenQuestions?, olderThanDays? }; POST /api/archive/restore { ids } | { all: true }.
 * `inbox(pid)` gives the project's { archiveCtx(), refresh() } (or null).
 */
export function createArchiveApi({ inbox }) {
  return {
    async handle(req, res, url, pid) {
      const p = url.pathname;
      if (p !== "/api/archive" && p !== "/api/archive/restore") return false;
      const i = inbox(pid);
      if (!i) return reply(res, 404, { error: "unknown project" }), true;
      try {
        const ctx = i.archiveCtx();
        if (req.method === "GET" && p === "/api/archive") return reply(res, 200, { items: listArchive(ctx), now: Date.now() }), true;
        if (req.method !== "POST") return reply(res, 405, { error: "method not allowed" }), true;
        if (!/^application\/json/i.test(String(req.headers["content-type"] || ""))) return reply(res, 415, { error: "send JSON" }), true;
        const body = await readBody(req);
        if (!body || typeof body !== "object") return reply(res, 400, { error: "bad-request" }), true;
        let out;
        if (p === "/api/archive/restore") out = restoreItems(ctx, body.all === true ? "all" : body.ids);
        else {
          const days = body.olderThanDays == null ? 0 : Number(body.olderThanDays);
          if (!Number.isFinite(days) || days < 0 || days > 36500) throw fail("bad-request");
          out = archiveItems(ctx, body.names, { by: "manual", skipOpenQuestions: body.skipOpenQuestions === true, olderThanDays: days });
        }
        await i.refresh().catch(() => {});
        return reply(res, 200, out), true;
      } catch (e) {
        return reply(res, e.status || 500, { error: e.code || e.message || "error" }), true;
      }
    },
  };
}

