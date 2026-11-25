---
name: map
description: Update the project's work map .lanedeck/map.md. Use after finishing, pushing or merging work, or when new work appears, in a project with a .lanedeck/ folder, so the lanedeck dashboard shows current states.
---

# lanedeck: keep the work map current

Protocol version 1 (1.1: content languages); `.lanedeck/PROTOCOL.md` is the source of truth. The map is the single flow code block (a fenced block whose info string is `flow`) in `.lanedeck/map.md`.

## Do

1. Read `map.md`. Find the stage and step that match the work just done.
2. Change its state: `now` in progress, `you` waiting on the human (an answer, a decision, a review or an approval), `wait` waiting on others (review, CI, another team), `done` finished, `blocked` stopped until something outside changes, `deferred` postponed by decision, `next` / `later` for queued work.
3. Add new steps or stages for new work as `- Step | state | tag | note` (tag: a PR number or label). Sub-steps use a two-space indent.
4. Update the `> now:` / `> you:` / `> wait:` call-outs so they match.
5. Every line you add or change gets its translation lines for every other language in `languages` (`> now@ar:`, `==@ar`, `-@ar`); keep existing translations in step with the original.

## Rules

- Languages (protocol 1.1): read `languages` from the front matter of `project.md` (none = English only). Write every human-facing text in ALL languages listed in `languages` (same meaning, technical terms unchanged); never in only one. Use the translation lines (`> now@ar:`, `==@ar`, `-@ar`, `#@ar`, `##@ar Q1 — ...`) and `lang-xx` fenced blocks of PROTOCOL.md "Languages"; the state field is never translated.

- Never delete a line a human wrote; change its state or add beside it. If a line looks wrong, ask (a question in your task file) instead of removing it.
- Keep exactly one flow block and the first-line marker `<!-- lanedeck protocol: 1 -->`.
- Use only these states: done, now, you, wait, next, later, deferred, blocked.
- Keep the map general: features, fixes, releases, milestones. Small edits; do not rewrite the file.
