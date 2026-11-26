import { test } from "node:test";
import assert from "node:assert/strict";
import { branchOfRows, agentBranch, gitBranchOf, _clearBranchCache } from "../server/agentbranch.mjs";

const row = (extra) => ({ type: "assistant", message: { content: [] }, ...extra });

test("the newest row's gitBranch wins; detached HEAD and empty values are skipped", () => {
  const rows = [row({ gitBranch: "main", cwd: "/work/app" }), row({ gitBranch: "feat/x", cwd: "/work/app-wt" }), row({ gitBranch: "HEAD" }), row({})];
  assert.deepEqual(branchOfRows(rows), { branch: "feat/x", cwd: "/work/app-wt" });
  assert.deepEqual(branchOfRows([row({ gitBranch: "" })]), { branch: null, cwd: null });
  assert.deepEqual(branchOfRows([]), { branch: null, cwd: null });
});

test("a worktree branch in the meta file beats the transcript", async () => {
  assert.equal(await agentBranch({ worktreeBranch: "wt/one" }, [row({ gitBranch: "main" })]), "wt/one");
});

test("no gitBranch in the rows: git is asked about the cwd, once per minute", async () => {
  _clearBranchCache();
  let calls = 0;
  const fake = (bin, args, opts, cb) => { calls++; assert.deepEqual(args, ["-C", "/work/app", "branch", "--show-current"]); cb(null, "feat/y\n"); };
  assert.equal(await agentBranch({}, [row({ cwd: "/work/app" })], fake), "feat/y");
  assert.equal(await gitBranchOf("/work/app", fake), "feat/y");
  assert.equal(calls, 1);
});

test("unknown stays null: not a repo, detached, relative or missing cwd", async () => {
  _clearBranchCache();
  const fail = (b, a, o, cb) => cb(new Error("not a git repository"), "");
  const detached = (b, a, o, cb) => cb(null, "\n");
  assert.equal(await gitBranchOf("/work/nope", fail), null);
  assert.equal(await gitBranchOf("/work/detached", detached), null);
  assert.equal(await gitBranchOf("relative/dir", detached), null);
  assert.equal(await agentBranch({}, [row({})]), null);
});
