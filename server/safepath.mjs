// Path safety for everything the deck reads from or writes into a project folder. The folder is untrusted input: any cloned
// repo can commit a `.lanedeck/` folder, symlinks and (on Windows) junctions. So:
//   * the project root is resolved to its real path once;
//   * every component from that root down to the target must exist as a real directory/file, never a symlink or junction
//     (Node's lstat reports a junction as a symbolic link); components that do not exist yet are created by us, as plain ones;
//   * the real path of the target (or of its deepest existing parent, for a new file) must stay under the real root;
//   * files are opened with O_NOFOLLOW where the OS has it, and checked with lstat right before the open where it does not.
import fs from "node:fs";
import path from "node:path";

const NOFOLLOW = fs.constants.O_NOFOLLOW || 0;

export const unsafe = (msg) => Object.assign(new Error(msg), { status: 400, unsafe: true });

/** The real path of a project folder (or of a trusted folder from the config). */
export function realRoot(dir) {
  return fs.realpathSync.native(path.resolve(dir));
}

const under = (root, p) => p === root || p.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

/**
 * The checked path of `rel` (fixed names) under the real root `root`, or throws (status 400) when a component is a symlink or
 * junction, or the path leaves the root. A missing tail is fine (the file or folder is new).
 */
export function safePath(root, rel) {
  let cur = root;
  let existing = root;
  for (const part of rel) {
    if (!part || part === "." || part === ".." || part.includes("/") || part.includes("\\")) throw unsafe(`bad path component: ${part}`);
    cur = path.join(cur, part);
    let st;
    try { st = fs.lstatSync(cur); } catch { break; }
    if (st.isSymbolicLink()) throw unsafe(`${path.relative(root, cur).replace(/\\/g, "/")} is a symlink or junction`);
    existing = cur;
  }
  const full = path.join(root, ...rel);
  const real = fs.realpathSync.native(existing);
  if (!under(root, real) || !under(root, full)) throw unsafe("path escapes the project folder");
  return full;
}

/** Like safePath, but answers a reason string (or null) instead of throwing. */
export function unsafeReason(root, rel) {
  try { safePath(root, rel); return null; } catch (e) { return e.message; }
}

/** lstat says: a plain file (not a symlink, not a folder). */
export const isPlainFile = (p) => { try { return fs.lstatSync(p).isFile(); } catch { return false; } };
export const lexists = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };

function openChecked(p, flags) {
  if (lexists(p) && fs.lstatSync(p).isSymbolicLink()) throw unsafe(`${path.basename(p)} is a symlink`);
  const fd = fs.openSync(p, flags | NOFOLLOW, 0o644);
  try {
    if (!fs.fstatSync(fd).isFile()) throw unsafe(`${path.basename(p)} is not a regular file`);
  } catch (e) { fs.closeSync(fd); throw e; }
  return fd;
}

/** Read a plain file (never through a symlink); null when it is missing, a symlink or not a file. */
export function readPlain(p) {
  if (!isPlainFile(p)) return null;
  let fd;
  try { fd = openChecked(p, fs.constants.O_RDONLY); } catch { return null; }
  try { return fs.readFileSync(fd, "utf8"); } finally { fs.closeSync(fd); }
}

/** Async read of a plain file: { text, mtime } or null (missing, symlink, junction, not a file). */
export async function readPlainAsync(p) {
  const st = await fs.promises.lstat(p).catch(() => null);
  if (!st || !st.isFile()) return null;
  let h;
  try { h = await fs.promises.open(p, fs.constants.O_RDONLY | NOFOLLOW); } catch { return null; }
  try {
    const info = await h.stat();
    if (!info.isFile()) return null;
    return { text: await h.readFile("utf8"), mtime: info.mtimeMs };
  } finally { await h.close(); }
}

/** Append to an existing plain file (never through a symlink). */
export function appendPlain(p, text) {
  const fd = openChecked(p, fs.constants.O_WRONLY | fs.constants.O_APPEND);
  try { fs.writeSync(fd, text, null, "utf8"); } finally { fs.closeSync(fd); }
}

/** Create a new file; fails when anything (a file, a symlink, a dangling symlink) already has the name. */
export function createPlain(p, text) {
  const fd = fs.openSync(p, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW, 0o644);
  try { fs.writeSync(fd, text, null, "utf8"); } finally { fs.closeSync(fd); }
}

/** mkdir -p of `rel` under the real root, one checked component at a time. */
export function mkdirSafe(root, rel) {
  for (let i = 1; i <= rel.length; i++) {
    const p = safePath(root, rel.slice(0, i));
    if (!lexists(p)) fs.mkdirSync(p);
    else if (!fs.lstatSync(p).isDirectory()) throw unsafe(`${rel.slice(0, i).join("/")} is not a folder`);
  }
  return safePath(root, rel);
}
