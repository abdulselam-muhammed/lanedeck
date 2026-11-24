# selam-deck plugin for Claude Code

Skills that make Claude follow the selam-deck project protocol (version 1, see `docs/PROTOCOL.md` in the repo, and `.selam-deck/PROTOCOL.md` in each project).

## Install

In Claude Code:

```
/plugin marketplace add abdulselam-muhammed/selam-deck
/plugin install selam-deck@selam-deck
```

Or from your shell:

```
claude plugin marketplace add abdulselam-muhammed/selam-deck
claude plugin install selam-deck@selam-deck
```

`claude plugin install selam-deck@selam-deck --scope project` enables it for one repository only (`.claude/settings.json`), `--scope local` for you in that repository.

To try it from a local clone without installing anything: `claude --plugin-dir ./plugin`.

## Skills

| Skill | Invoked | What it does |
|---|---|---|
| `/selam-deck:init` | by you | Reads the repo and writes `.selam-deck/project.md`, `map.md`, `glossary.md`; questions go to `inbox/00-setup.md`. |
| `report` | automatically, in projects with `.selam-deck/` | One task file per task in `inbox/`: `## Steps` kept current, `## Q<n>` questions, `## Result`. |
| `map` | automatically | Updates the states in `map.md` after work is done or merged; keeps human edits. |
| `answers` | automatically | Acts on `**Answer:**` lines under questions, then removes the handled questions. |
| `doctor` | on request | Validates `.selam-deck/` against the protocol and prints fixes (read-only unless you agree). |

All skills are namespaced: `/selam-deck:init`, `/selam-deck:doctor`, and so on.

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
            "command": "test -d .selam-deck && echo 'This project uses selam-deck: follow .selam-deck/PROTOCOL.md and keep one task file per task in .selam-deck/inbox/.' || true"
          }
        ]
      }
    ]
  }
}
```
