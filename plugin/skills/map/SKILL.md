---
name: map
description: Update the project's work map .selam-deck/map.md. Use after finishing, pushing or merging work, or when new work appears, in a project with a .selam-deck/ folder, so the selam-deck dashboard shows current states.
---

# selam-deck: keep the work map current

Protocol version 1; `.selam-deck/PROTOCOL.md` is the source of truth. The map is the single flow code block (a fenced block whose info string is `flow`) in `.selam-deck/map.md`.

## Do

1. Read `map.md`. Find the stage and step that match the work just done.
2. Change its state: `now` in progress, `you` waiting on the human (an answer, a decision, a review or an approval), `wait` waiting on others (review, CI, another team), `done` finished, `blocked` stopped until something outside changes, `deferred` postponed by decision, `next` / `later` for queued work.
3. Add new steps or stages for new work as `- Step | state | tag | note` (tag: a PR number or label). Sub-steps use a two-space indent.
4. Update the `> now:` / `> you:` / `> wait:` call-outs so they match.

## Rules

- Never delete a line a human wrote; change its state or add beside it. If a line looks wrong, ask (a question in your task file) instead of removing it.
- Keep exactly one flow block and the first-line marker `<!-- selam-deck protocol: 1 -->`.
- Use only these states: done, now, you, wait, next, later, deferred, blocked.
- Keep the map general: features, fixes, releases, milestones. Small edits; do not rewrite the file.
