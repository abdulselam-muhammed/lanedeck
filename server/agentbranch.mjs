// The git branch an agent works on. Claude Code writes `gitBranch` and `cwd` on every transcript row (the main session and
// each subagent alike); the agent's .meta.json has no branch unless it was started in a worktree. So: the newest row's
// `gitBranch`, else `git branch --show-current` in the newest `cwd` (read-only, cached), else null.
import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";

/** The newest branch and cwd named by a list of transcript rows (oldest first). A detached HEAD is not a branch. */
export function branchOfRows(rows) {
  let branch = null, cwd = null;
  for (let i = rows.length - 1; i >= 0 && (!branch || !cwd); i--) {
    const r = rows[i];
    if (!branch && typeof r?.gitBranch === "string" && r.gitBranch.trim() && r.gitBranch !== "HEAD") branch = r.gitBranch.trim();
    if (!cwd && typeof r?.cwd === "string" && r.cwd) cwd = r.cwd;
  }
  return { branch, cwd };
}

const TTL_MS = 60e3;
const cache = new Map(); // cwd -> { at, value }
/** `git -C <cwd> branch --show-current`, cached for a minute per folder. null: not a repo, detached, git missing. */
export function gitBranchOf(cwd, run = execFile) {
  if (typeof cwd !== "string" || !isAbsolute(cwd)) return Promise.resolve(null);
  const hit = cache.get(cwd);
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.value);
  return new Promise((done) => {
    try {
      run("git", ["-C", cwd, "branch", "--show-current"], { windowsHide: true, timeout: 5000, maxBuffer: 1 << 16 }, (e, out) => {
        const value = e ? null : String(out).trim() || null;
        cache.set(cwd, { at: Date.now(), value });
        done(value);
      });
    } catch { done(null); }
  });
}

/** The agent's branch: the worktree branch of its meta, the transcript's gitBranch, else the git branch of its cwd. */
export async function agentBranch(meta, rows, run) {
  if (typeof meta?.worktreeBranch === "string" && meta.worktreeBranch) return meta.worktreeBranch;
  const { branch, cwd } = branchOfRows(rows);
  return branch ?? (cwd ? await gitBranchOf(cwd, run) : null);
}

export const _clearBranchCache = () => cache.clear();
