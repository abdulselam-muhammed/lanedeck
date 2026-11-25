---
name: init
description: Set a project up for lanedeck (writes .lanedeck/project.md, map.md and glossary.md). Runs only when the user types /lanedeck:init; Claude does not start it on its own.
disable-model-invocation: true
---

# lanedeck: set the project up

Protocol version 1 (1.1: content languages). The source of truth is `.lanedeck/PROTOCOL.md` in the project; read it first. If the folder or that file is missing, tell the user to add the project in the lanedeck dashboard (Settings, Projects, Add), which creates them, and stop.

## Do

1. Read the repo: README, top-level structure, package/build files, `git log` (recent history), open TODOs, and issues if `gh` is available.
2. Languages: take the list from `.lanedeck/inbox/00-setup.md` ("Content languages: ...") if it is there; otherwise ask the user which languages the content should be written in, defaulting to English (`[en]`). Write every human-facing text in ALL languages listed in `languages` (same meaning, technical terms unchanged); never in only one. Keep technical terms in English.
3. Write `.lanedeck/project.md`: first line `<!-- lanedeck protocol: 1 -->`, then a front-matter block `---` / `languages: [en, ...]` / `---`, then `# <name>`, one first paragraph saying what the project is, then stack, default branch, how to run and test.
4. Write `.lanedeck/map.md`: first line the marker, then exactly ONE flow code block (a fenced block whose info string is `flow`). It is the project's general work map (features, fixes, releases, milestones), not a migration. Use `== Stage | state | note` and `- Step | state | tag | note`, two-space indent for sub-steps, optional `> now|you|wait: text` call-outs. States: done (finished), now (in progress), you (waiting on the human: answer, decision, review, approval), wait (waiting on others), next, later, deferred, blocked. Base states on code, history and issues; if unsure, do not guess: add a question.
5. Write `.lanedeck/glossary.md`: marker line, `## Group` headings, `- **term** — meaning` lines, terms specific to this project only.
6. Questions about anything unclear: APPEND them to the existing `.lanedeck/inbox/00-setup.md` as `## Q1 — ...`, `## Q2 — ...` headings (IDs: capital letters then digits, unique in the file). Never create a second setup file or another task file for the setup. Tick only the AI step in its `## Steps` (the one about writing the files); leave the human steps (sending the prompt, reviewing the work map) unticked. The human ticks the last step, which archives the file; do not move or archive it yourself.
7. Ask before touching `AGENTS.md` or `CLAUDE.md`; never edit them silently.

## Rules

- Languages (protocol 1.1): read `languages` from the front matter of `project.md` (none = English only). Write every human-facing text in ALL languages listed in `languages` (same meaning, technical terms unchanged); never in only one. Use the translation lines (`> now@ar:`, `==@ar`, `-@ar`, `#@ar`, `##@ar Q1 — ...`) and `lang-xx` fenced blocks of PROTOCOL.md "Languages"; the state field is never translated.

- Never overwrite or delete a line a human wrote in an existing `project.md`, `map.md` or `glossary.md`; add to it, or ask.
- Existing files: merge, do not replace.
- Write only inside `.lanedeck/`.
- Finish with a short summary: files written, questions asked.
