# Architecture

lanedeck is one Node process: a small custom HTTP server that also hosts a Next.js app.

- `server/index.mjs`: starts the guard, the API routes, SSE and the WebSocket channel, then hands everything else to Next.js.
- `server/guard.mjs`: the first check for every request (Host, Origin, remote token).
- `server/config.mjs`: loads and validates the config file; profiles come from `<config folder>/profiles/`.
- `server/inbox.mjs`, `server/protocol.mjs`, `server/setup.mjs`, `server/safepath.mjs`: the `.lanedeck/` protocol reader and the (confirmed) setup writer; project folders are untrusted.
- `server/load/`: machine load sampling (PowerShell on Windows, Node `os` elsewhere) and remote machines over SSH.
- `server/ci/`: the runners panel (docker and GitHub Actions, read-only).
- `server/prs/board.mjs`: the merge board.
- `server/budget.mjs`: the GitHub request budget shared by all pollers.
- `server/platform.mjs`: every OS difference in one place.
- `server/i18n/`: the English and Arabic dictionaries, split by area. `npm run check:i18n` keeps them in step.
- `src/`: the Next.js interface (App Router, client components, TailAdmin-based UI).
- `plugin/`: the Claude Code plugin (skills that follow the protocol). `templates/`: files the setup dialog writes.

Protocol: [docs/PROTOCOL.md](docs/PROTOCOL.md).
