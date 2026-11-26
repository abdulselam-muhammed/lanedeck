# Architecture

lanedeck is one Node process: a small custom HTTP server that also hosts a Next.js app.

- `server/index.mjs`: starts the guard, the API routes, SSE and the WebSocket channel, then hands everything else to Next.js.
- `server/guard.mjs`: the first check for every request (Host, Origin, remote token).
- `server/config.mjs`: loads and validates the config file; profiles come from `<config folder>/profiles/`.
- `server/inbox.mjs`, `server/protocol.mjs`, `server/setup.mjs`, `server/safepath.mjs`: the `.lanedeck/` protocol reader and the (confirmed) setup writer; project folders are untrusted.
- `server/archive.mjs`: the Inbox archive (move to `<inbox>/.archive/YYYY-MM/` with a manifest, restore, the optional daily auto-archive rule, its HTTP routes); every path goes through `safepath.mjs`.
- `server/load/`: machine load sampling (PowerShell on Windows, Node `os` elsewhere) and remote machines over SSH.
- `server/ci/`: the runners panel (docker and GitHub Actions, read-only).
- `server/prs/board.mjs`: the merge board.
- `server/budget.mjs`: the GitHub request budget shared by all pollers.
- `server/notify/`: the Inbox's GitHub notifications: one conditional poller that sleeps while no page is open, pushed to the pages over SSE (`push.mjs`); `events.mjs` derives what happened on a thread (merged, closed, commented, reviewed, ...) from the latest comment, the subject and its timeline, never from GitHub's sticky `reason`. The read state and the archive (`data/notify/read.json`, `data/notify/archive.json`) are local only; an archived thread with newer activity comes back to the inbox by itself.
- `server/platform.mjs`: every OS difference in one place.
- `server/i18n/`: the English and Arabic dictionaries, split by area. `npm run check:i18n` keeps them in step.
- `src/`: the Next.js interface (App Router, client components, TailAdmin-based UI).
- `plugin/`: the Claude Code plugin (skills that follow the protocol). `templates/`: files the setup dialog writes.

Protocol: [docs/PROTOCOL.md](docs/PROTOCOL.md).
