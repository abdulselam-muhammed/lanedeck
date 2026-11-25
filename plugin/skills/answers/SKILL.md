---
name: answers
description: Handle answers the human wrote in .lanedeck/inbox/ task files. Use when a task file has **Answer:** or **الجواب:** lines under its ## Q<n> questions, or when the user says they answered, in a project with a .lanedeck/ folder.
---

# lanedeck: act on answers

Protocol version 1; `.lanedeck/PROTOCOL.md` is the source of truth.

## Do

1. Read the files in `.lanedeck/inbox/` (not `_` files, not `_archive/`). A question is a `## Q<n> — text` heading; an answer is a `**Answer:** ...` (or `**الجواب:** ...`) line under it. Those questions are "answered, waiting for the AI".
2. For each: act on the answer (change code, plan, map, glossary as needed). If the answer is unclear or conflicts with something, ask a new question instead of guessing.
3. Then remove the whole handled question block (heading, text and answer) from the file, and add one line to `## Result` (create it if missing): `Q2 answered: <decision, one line>`.
4. Update `## Steps` if the answer unblocks or changes steps. If an answer changes the work map, apply it to `map.md` without deleting human-written lines.

## Rules

- Handle only questions that have an answer line; leave open questions as they are.
- One file per task; do not move, rename, merge or archive files (the human archives).
- Write in the file's language; technical terms in English.
