---
name: doctor
description: Check the .lanedeck/ folder against the lanedeck protocol and print fixes. Use when the dashboard shows a protocol warning, when the user asks to validate or check the lanedeck setup, or after editing project.md, map.md, glossary.md or inbox files.
---

# lanedeck: doctor

Read-only by default: report problems and proposed fixes; change files only if the user agrees. Protocol version 1; `.lanedeck/PROTOCOL.md` is the source of truth.

## Checks (the same as the dashboard's "protocol" badge)

1. `.lanedeck/` exists; `project.md` and `map.md` exist and are not empty.
2. `map.md` has exactly one flow block (none: warn; more than one: only the first is drawn).
3. In the flow block, every stage (`== title | state | note`) and step (`- label | state | tag | note`) uses a known state: done, now, you, wait, next, later, deferred, blocked. An unknown word is shown as `later`.
4. `glossary.md` (if present): `## Group` headings and `- **term** — meaning` lines; other lines are "not understood".
5. Marker `<!-- lanedeck protocol: N -->`: N must not be above 1 (missing = 1).
6. Inbox files (ignore names starting with `_` and `_archive/`): question IDs are capital letters plus digits and unique inside one file; `## Steps` (or `## الخطوات`) is a checklist `- [ ]` / `- [x]`.
7. `inbox/` is in `.gitignore`.
8. The project config does not set `inboxDir` (it replaces `.lanedeck/inbox/`, so the protocol inbox would not be shown). `00-setup.md` is either in `inbox/` or, once finished, in `inbox/_archive/`; that is normal.

## Output

A short list: OK items in one line, then each problem as `file: what is wrong -> the fix`. End with the number of problems. Offer to apply the fixes; apply only after the user agrees, and never delete a line a human wrote.
