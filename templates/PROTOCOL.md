<!-- lanedeck protocol: 1 -->
# lanedeck project protocol (version 1)

Version 1.1 adds content languages (the section "Languages" below). It is additive: files written for 1.0 stay valid, and the
file marker stays `<!-- lanedeck protocol: 1 -->`.

lanedeck is a dashboard for organising and closely following work done with AI agents, GitHub PRs and CI.
This file is the contract between the dashboard, the human and the AI agents working in a project.
Everything is plain Markdown in one folder, so any agent can read and write it without tools.

## The project folder

Each project that follows the protocol has a `.lanedeck/` folder at the repository root:

```
.lanedeck/
  PROTOCOL.md   a copy of this file, written by the dashboard
  project.md    what the project is: purpose, stack, default branch, how to run and test
  map.md        the project's work map: what is done, being built, waiting, next
  glossary.md   terms that only make sense in this project
  inbox/        git-ignored; one .md file per task
```

- `inbox/` must be in `.gitignore` (the tasks are working notes, not history).
- The human and the AI write these files; the dashboard reads them. The dashboard writes only when you press "Set up lanedeck" (and confirm) in the Settings: it creates `PROTOCOL.md` and `inbox/00-setup.md` if missing, adds the `.lanedeck/inbox/` line to `.gitignore`, and appends a marked block to `AGENTS.md` / `CLAUDE.md` when you choose those files. It never overwrites an existing file.
- One file moves on its own: when the last step of `inbox/00-setup.md` is ticked (or you press "Setup done"), the dashboard moves it to `inbox/_archive/00-setup.md`. Do not rely on that file staying in `inbox/`. The dashboard moves no other file.
- The first line of every file may be the marker `<!-- lanedeck protocol: 1 -->`.
  It is optional for inbox files; a missing marker means version 1. A higher number than the dashboard knows is shown as a warning.
- If `inbox/` is missing the inbox is empty. If the dashboard config sets `inboxDir` for the project, that folder is the inbox INSTEAD of `.lanedeck/inbox/`: the setup file and the task files must then live there, and `.lanedeck/inbox/` is not shown. Leave `inboxDir` unset for projects that follow this protocol.

## Inbox task files

One file per task, one task per file: `inbox/<short-name>.md`.

```markdown
<!-- lanedeck protocol: 1 -->
# Add password reset
**agent:** a1b2c3d4e5f60718

## Steps
- [x] Read the auth module
- [ ] Add the reset endpoint
- [ ] Write tests

## Q1 — Should the link expire after 1 hour or 24 hours?
Both are common; 1 hour is safer.

**Answer:** 1 hour.

## Q2 — Which mail provider sends the reset mail?

## Result
What was done, what was checked, what is left.
```

| Part | Rule |
|---|---|
| Title | `# Title`, the first heading. |
| Agent | Optional line `**agent:** <id>` links the file to a live Claude agent (its progress bar and state). |
| Steps | `## Steps` (or `## الخطوات`) followed by a checklist `- [ ]` / `- [x]`. The checked share is the task's progress (1 of 3 = 33%). |
| Questions | `## Q1 — text`. An ID is capital letters then digits (`Q1`, `UX12`, `DB3`); it must be unique inside the file. |
| Answers | The human writes `**Answer:** ...` (or `**الجواب:** ...`) under the question. A question with an answer line is *answered, waiting for the AI*. The AI handles it, then removes the whole question block. |
| Result | `## Result` holds the final report when the task is finished. |
| Setup | `00-setup.md` is the setup item (shown first, not counted as work). |
| Ignored | Files starting with `_` and everything inside `inbox/_archive/`. |
| Archiving | The human archives a finished task by moving its file to `inbox/_archive/` (the dashboard does this only for `00-setup.md`). An AI agent never moves, renames or archives a task file. |

A question without an answer line is *open*: it appears under "Questions" as waiting for the human.

## map.md: the work map

`map.md` is the project's work map. It holds exactly one `` ```flow `` block and may have prose around it.
Stages are whatever the project tracks: features, fixes, releases, milestones.

````markdown
<!-- lanedeck protocol: 1 -->
# Work map

```flow
> now: Billing webhooks (PR #14)
> you: Approve the Auth PR
> wait: Release 1.0 waits for CI

== Auth | done | Login and password reset
- Login form | done | PR #8 | merged
- Password reset | now | PR #14 | in review
  - Reset mail | next | | provider not chosen

== Billing | next
- Invoices | later

== Release 1.0 | later | after Auth and Billing
```
````

Lines inside the block:

| Line | Meaning |
|---|---|
| `> now: text`, `> you: text`, `> wait: text` | A call-out at the top: here and now / waiting for you / waiting for others. |
| `== Stage \| state \| note` | A stage. Note is optional. |
| `- Step \| state \| tag \| note` | A step of the stage. Tag (a PR number, a label) and note are optional. |
| two-space indent before `-` | A sub-step of the step above. |

The 8 states (unknown words are shown as `later` and raise a warning):

| State | Meaning | English | Arabic |
|---|---|---|---|
| `done` | Finished. | Done | خلص |
| `now` | Being worked on right now. | In progress | عم يُبنى الآن |
| `you` | Waiting on the human: an answer, a decision, a review or an approval. | Waiting on you | ينتظرك |
| `wait` | Waiting on others: review, CI, another team. | Waiting on others | ينتظر غيرك |
| `next` | The next thing to start. | Next | التالي |
| `later` | Not started, waiting its turn. | Later | لاحقاً |
| `deferred` | Postponed by a decision. | Deferred | مؤجَّل |
| `blocked` | Stopped; something outside must change first. | Blocked | متوقف |

A project may word the labels its own way (a profile in the dashboard, where each label may be a string or an `{ "en": ..., "ar": ... }` pair picked by `ui.lang`); the meanings stay as above.

When `map.md` exists, it is THE work map; ```` ```flow ```` blocks inside inbox files are ignored.

## project.md

May start with a front-matter block that names the content languages (see "Languages"):

```markdown
<!-- lanedeck protocol: 1 -->
---
languages: [en, ar]
---
# Shop
```

Then free Markdown. Start with one paragraph (the dashboard shows only that paragraph, with "more" for the rest):
what the project is, then stack, default branch, and how to run and test it.

## glossary.md

Terms used only in this project. `## Group` headings and one line per term:

```markdown
<!-- lanedeck protocol: 1 -->
## Billing
- **invoice run** — the nightly job that issues invoices
- **grace period** — days a failed payment keeps access
```

An optional line `scope: none` is accepted and changes nothing. General words (commit, PR, CI) are not repeated here.

## Languages

A project lists the languages its content is written in: `languages: [en, ar]` in the front matter of `project.md` (or, when
that is missing, the project's "Content languages" in the dashboard settings). Without it the project is English only.

Write every human-facing text in ALL languages listed in `languages` (same meaning, technical terms unchanged); never in only one. The first listed language is the original; every other language goes on a translation line written right under the
line it translates, with the same marker plus `@<language>`:

| Original line | Translation line |
|---|---|
| `> now: Billing webhooks (PR #14)` | `> now@ar: ...` |
| `== Auth \| done \| Login and password reset` | `==@ar ... \| \| ...` (state left empty) |
| `- Login form \| done \| PR #8 \| merged` | `-@ar ... \| \| \| ...` (state left empty; an empty field keeps the original) |
| `# Add password reset` / `## Group` | `#@ar ...` / `##@ar ...` |
| `## Q1 — Which mail provider?` | `##@ar Q1 — ...` |
| `- [ ] Write tests` | `-@ar ...` (the checkbox stays on the original) |
| `- **invoice run** — the nightly job` | `-@ar **...** — ...` |

The state field is never translated; leave it empty. Any other empty field keeps the original (a PR number in a tag needs no translation). Longer text (a question's details, a
`## Result`, a paragraph of `project.md`) goes in consecutive fenced blocks, one per language:

````markdown
```lang-en
The reset endpoint is done and tested.
```

```lang-ar
...
```
````

The dashboard shows the translation for its interface language, else the original line, else the first block. Content without
translations is shown as written, in any interface language. `**Answer:**` lines are written by the human in any language.

## Rules for AI agents

1. Write every human-facing text in ALL languages listed in `languages` (same meaning, technical terms unchanged); never in only one. Without a `languages` list, write in English. Keep technical terms (commit, PR, id, endpoint) in English in every language.
2. Never delete a line a human wrote in `map.md` or `glossary.md`. Add, or mark a state; if a line looks wrong, ask.
3. Ask instead of guessing: put a `## Q<n> — ...` question in the task file and stop on that point.
4. One file per task. Do not mix tasks, and do not rename a task file while it is running.
5. Keep `## Steps` current as you work; it is the progress the human sees.
6. Remove an answered question block once you have acted on it, and record the outcome in `## Result`.
7. Do not move, rename or archive inbox files, including `00-setup.md`: archiving is done by the human (and, for the setup file only, by the dashboard).
8. Never write secrets into any of these files.
