// The ONE source of truth for every job's state, shared by the «My machine» and the «Whole org» views.
// Keyed by GitHub job id. Fed by every GitHub read (run lists, run jobs, single-job re-checks) and by
// the runner's own log (a local "completed" hint). Both tabs read the same records, so they can never
// disagree. Every change is collected and flushed as one diff event (`{type:'jobs', jobs:[...]}`).
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const DAY = 24 * 3600 * 1000;
const KEEP_FULL = DAY;           // completed jobs keep their steps (full detail) this long
const KEEP_ORG = 7 * DAY;        // after that a compact summary stays this long, then the job is dropped
const KEEP_MINE = 500;           // completed jobs of this machine kept (newest)
const FLUSH_MS = 150;
const SAVE_MS = 10000;           // the store file is written at most this often, and only when something changed
const PRUNE_MS = 3600 * 1000;
const COMPACT_KEYS = ['id', 'runId', 'repo', 'workflow', 'event', 'job', 'runner', 'status', 'conclusion', 'createdAt', 'startedAt', 'completedAt', 'pr', 'mine', 'seq', 'gone', 'labels'];
const doneAt = (j) => Date.parse(j.completedAt || j.startedAt || j.createdAt || 0);
/** The compact summary of a finished job: no steps, no titles, no avatars. */
export function compact(j) {
  const c = {};
  for (const k of COMPACT_KEYS) if (j[k] !== undefined && j[k] !== null) c[k] = j[k];
  if (j.trigger && j.trigger.login) c.trigger = { login: j.trigger.login };
  c.compact = true;
  return c;
}
/** A list row: the record without its steps. */
export function lean(j) { if (!j.steps) return j; const { steps, ...r } = j; return r; }

export class JobStore extends EventEmitter {
  constructor(dir) {
    super();
    this.legacy = path.join(dir, 'store.json');
    this.file = path.join(dir, 'store.json.gz'); // gzip: the JSON is very repetitive (~15x smaller)
    this.saving = false;
    this.jobs = new Map();       // id -> rec
    this.runs = {};              // runId -> {repo, u: updated_at, status, meta, t}
    this.changed = new Set();
    this.flushT = null;
    this.dirty = false;
    const d = readGz(this.file) || readJson(this.legacy);
    if (d) {
      for (const j of Object.values(d.jobs || {})) this.jobs.set(String(j.id), j);
      this.runs = d.runs || {};
    } else {
      // First start of this version: import the old machine store (jobs.json).
      const mine = readJson(path.join(dir, 'jobs.json')) || {};
      for (const j of Object.values(mine)) this.jobs.set(String(j.id), { ...(this.jobs.get(String(j.id)) || {}), ...j, mine: true });
    }
    this.prune();
    // Written at most every SAVE_MS and only when dirty; pruned hourly. Both timers never keep the process alive.
    setInterval(() => { try { this.save(); } catch { /* best effort */ } }, SAVE_MS).unref();
    setInterval(() => { this.prune(); this.dirty = true; }, PRUNE_MS).unref();
  }

  get(id) { return this.jobs.get(String(id)) || null; }
  all() { return [...this.jobs.values()]; }
  active() { return this.all().filter((j) => j.status !== 'completed'); }

  /** Merge fields into a job; records a diff only when something visible changed. */
  upsert(id, fields) {
    const k = String(id);
    const before = this.jobs.get(k);
    const next = { ...(before || {}), ...fields, id: Number(id) };
    // GitHub is the truth for the state: once it says completed, the local hint has done its job.
    if (next.status === 'completed' && next.local) delete next.local;
    if (before && JSON.stringify(before) === JSON.stringify(next)) return before;
    next.seq = (before && before.seq || 0) + 1;
    this.jobs.set(k, next);
    this.changed.add(k);
    this.schedule();
    return next;
  }

  schedule() {
    if (!this.flushT) this.flushT = setTimeout(() => this.flush(), FLUSH_MS);
    this.dirty = true;
  }

  flush() {
    this.flushT = null;
    if (!this.changed.size) return;
    const jobs = [...this.changed].map((k) => this.jobs.get(k)).filter(Boolean);
    this.changed.clear();
    this.emit('diff', jobs);
  }

  prune() {
    const now = Date.now();
    const cut = now - KEEP_ORG;
    const mineDone = [];
    for (const [k, j] of this.jobs) {
      if (j.status !== 'completed') continue;
      const t = doneAt(j);
      if (t < cut) { this.jobs.delete(k); continue; }
      if (t < now - KEEP_FULL && !j.compact) this.jobs.set(k, compact(j));
      if (j.mine) mineDone.push(j);
    }
    mineDone.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
    for (const j of mineDone.slice(KEEP_MINE)) this.jobs.delete(String(j.id));
    for (const [id, r] of Object.entries(this.runs)) if ((r.t || 0) < cut) delete this.runs[id];
    this.dirty = true;
  }

  payload() {
    const jobs = {};
    for (const [k, j] of this.jobs) jobs[k] = j;
    return Buffer.from(JSON.stringify({ jobs, runs: this.runs }));
  }

  /** Debounced by the 10 s timer, only when dirty; gzip runs off the main thread; temp file + rename = atomic. */
  save() {
    if (!this.dirty || this.saving) return;
    this.dirty = false; this.saving = true;
    const tmp = `${this.file}.${process.pid}.tmp`;
    zlib.gzip(this.payload(), { level: 4 }, (err, buf) => {
      try {
        if (err) throw err;
        fs.writeFileSync(tmp, buf); fs.renameSync(tmp, this.file);
        if (fs.existsSync(this.legacy)) fs.unlinkSync(this.legacy); // the old uncompressed store is superseded
      } catch { this.dirty = true; }
      this.saving = false;
    });
  }

  /** Synchronous, for process exit. */
  saveSync() {
    if (!this.dirty) return;
    this.dirty = false;
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, zlib.gzipSync(this.payload(), { level: 4 })); fs.renameSync(tmp, this.file);
  }

  /** This machine's jobs, newest first. */
  mine() { return this.all().filter((j) => j.mine).sort((a, b) => String(b.startedAt || b.createdAt).localeCompare(String(a.startedAt || a.createdAt))).slice(0, 300).map(lean); }

  /** The org view: queued / in progress now, plus completed in the last 24 h. */
  org() {
    const cut = Date.now() - DAY;
    return this.all().filter((j) => j.status !== 'completed' || Date.parse(j.completedAt || j.startedAt || 0) >= cut)
      .sort((a, b) => Date.parse(b.startedAt || b.createdAt || 0) - Date.parse(a.startedAt || a.createdAt || 0));
  }
}

export function readGz(f) { try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString("utf8")); } catch { return null; } }
export function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch { return null; } }
export function writeJson(f, v) { const tmp = `${f}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(v)); fs.renameSync(tmp, f); }
