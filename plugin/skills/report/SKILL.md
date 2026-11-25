---
name: report
description: Keep one task file per task in .lanedeck/inbox/. Use at the start of ANY task in a project that has a .lanedeck/ folder, and while working on it, to create or update that task's file with its steps, questions and final result for the lanedeck dashboard.
---

# lanedeck: report each task

Applies only when the project has `.lanedeck/`. Protocol version 1 (1.1: content languages); `.lanedeck/PROTOCOL.md` is the source of truth.

## At the start of a task

Create `.lanedeck/inbox/<short-name>.md` (lowercase, dashes), or reopen the file of the same task. One file per task; never mix tasks, never rename a running task's file.

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

- Languages (protocol 1.1): read `languages` from the front matter of `project.md` (none = English only). Write every human-facing text in ALL languages listed in `languages` (same meaning, technical terms unchanged); never in only one. Use the translation lines (`> now@ar:`, `==@ar`, `-@ar`, `#@ar`, `##@ar Q1 — ...`) and `lang-xx` fenced blocks of PROTOCOL.md "Languages"; the state field is never translated.

- Files starting with `_` or inside `inbox/_archive/` are ignored by the dashboard; do not use them for live tasks.
- Never write secrets into these files.
