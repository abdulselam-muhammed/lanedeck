---
name: init
description: Set a project up for selam-deck (writes .selam-deck/project.md, map.md and glossary.md). Runs only when the user types /selam-deck:init; Claude does not start it on its own.
disable-model-invocation: true
---

# selam-deck: set the project up

Protocol version 1. The source of truth is `.selam-deck/PROTOCOL.md` in the project; read it first. If the folder or that file is missing, tell the user to add the project in the selam-deck dashboard (Settings, Projects, Add), which creates them, and stop.

## Do

1. Read the repo: README, top-level structure, package/build files, `git log` (recent history), open TODOs, and issues if `gh` is available.
2. Language: use the language written in `.selam-deck/inbox/00-setup.md` ("Write the content in ...") or, if absent, the language the user writes in. Keep technical terms in English.
3. Write `.selam-deck/project.md`: first line `<!-- selam-deck protocol: 1 -->`, then `# <name>`, one first paragraph saying what the project is, then stack, default branch, how to run and test.
4. Write `.selam-deck/map.md`: first line the marker, then exactly ONE flow code block (a fenced block whose info string is `flow`). It is the project's general work map (features, fixes, releases, milestones), not a migration. Use `== Stage | state | note` and `- Step | state | tag | note`, two-space indent for sub-steps, optional `> now|you|wait: text` call-outs. States: done (finished), now (in progress), you (waiting on the human: answer, decision, review, approval), wait (waiting on others), next, later, deferred, blocked. Base states on code, history and issues; if unsure, do not guess: add a question.
5. Write `.selam-deck/glossary.md`: marker line, `## Group` headings, `- **term** — meaning` lines, terms specific to this project only.
6. Questions about anything unclear: APPEND them to the existing `.selam-deck/inbox/00-setup.md` as `## Q1 — ...`, `## Q2 — ...` headings (IDs: capital letters then digits, unique in the file). Never create a second setup file or another task file for the setup. Tick only the AI step in its `## Steps` (the one about writing the files); leave the human steps (sending the prompt, reviewing the work map) unticked. The human ticks the last step, which archives the file; do not move or archive it yourself.
7. Ask before touching `AGENTS.md` or `CLAUDE.md`; never edit them silently.

## Rules

- Never overwrite or delete a line a human wrote in an existing `project.md`, `map.md` or `glossary.md`; add to it, or ask.
- Existing files: merge, do not replace.
- Write only inside `.selam-deck/`.
- Finish with a short summary: files written, questions asked.
