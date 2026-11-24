---
name: report
description: Keep one task file per task in .selam-deck/inbox/. Use at the start of ANY task in a project that has a .selam-deck/ folder, and while working on it, to create or update that task's file with its steps, questions and final result for the selam-deck dashboard.
---

# selam-deck: report each task

Applies only when the project has `.selam-deck/`. Protocol version 1; `.selam-deck/PROTOCOL.md` is the source of truth.

## At the start of a task

Create `.selam-deck/inbox/<short-name>.md` (lowercase, dashes), or reopen the file of the same task. One file per task; never mix tasks, never rename a running task's file.

```
# Title of the task
**agent:** <id>        (only if you know your agent id)

## Steps
- [ ] first step
- [ ] second step
```

## While working

- Keep `## Steps` current: tick `- [x]` as steps finish. The checked share is the progress the human sees.
- When blocked or unsure, do not guess: add `## Q1 — the question`, then the next free ID (`Q2`...), with the options you see, and stop on that point.
- Update the file when something real changes, not on every edit. Do not spam.

## At the end

Add `## Result`: what was done, what was checked, what is left. Do not move, rename or archive the file yourself: the human archives finished tasks (by moving them to `inbox/_archive/`); the dashboard itself moves only `00-setup.md`.

## Rules

- Write in the language of the dashboard (the language of existing inbox files, or the user's); keep technical terms in English.
- Files starting with `_` or inside `inbox/_archive/` are ignored by the dashboard; do not use them for live tasks.
- Never write secrets into these files.
