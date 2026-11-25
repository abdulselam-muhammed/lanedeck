# lanedeck plugin for Claude Code

Skills that make Claude follow the lanedeck project protocol (version 1, see `docs/PROTOCOL.md` in the repo, and `.lanedeck/PROTOCOL.md` in each project).

## Install

In Claude Code:

```
/plugin marketplace add abdulselam-muhammed/lanedeck
/plugin install lanedeck@lanedeck
```

Or from your shell:

```
claude plugin marketplace add abdulselam-muhammed/lanedeck
claude plugin install lanedeck@lanedeck
```

`claude plugin install lanedeck@lanedeck --scope project` enables it for one repository only (`.claude/settings.json`), `--scope local` for you in that repository.

To try it from a local clone without installing anything: `claude --plugin-dir ./plugin`.

## Skills

| Skill | Invoked | What it does |
|---|---|---|
| `/lanedeck:init` | by you | Reads the repo and writes `.lanedeck/project.md`, `map.md`, `glossary.md`; questions go to `inbox/00-setup.md`. |
| `report` | automatically, in projects with `.lanedeck/` | One task file per task in `inbox/`: `## Steps` kept current, `## Q<n>` questions, `## Result`. |
| `map` | automatically | Updates the states in `map.md` after work is done or merged; keeps human edits. |
| `answers` | automatically | Acts on `**Answer:**` lines under questions, then removes the handled questions. |
| `doctor` | on request | Validates `.lanedeck/` against the protocol and prints fixes (read-only unless you agree). |

All skills are namespaced: `/lanedeck:init`, `/lanedeck:doctor`, and so on.

## Optional hook (not enabled)

The plugin ships no hooks. If you want Claude reminded at every session start, add this to your project's `.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "test -d .lanedeck && echo 'This project uses lanedeck: follow .lanedeck/PROTOCOL.md and keep one task file per task in .lanedeck/inbox/.' || true"
          }
        ]
      }
    ]
  }
}
```
