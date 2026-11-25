#!/usr/bin/env node
// lanedeck launcher: `npx lanedeck` / `lanedeck`. Starts the production server from the package folder, whatever the cwd is.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const USAGE = `lanedeck: a local control room for AI coding agents

Usage: lanedeck [--port <n>] [--host <addr>]

  --port, -p <n>   port to listen on (default 4280, or "server.port" in the config, or $PORT)
  --host <addr>    address to bind (default 127.0.0.1; a non-loopback host needs server.accessToken in the config)
  --help, -h       show this help
  --version, -v    show the version

Environment: LANEDECK_CONFIG (config file), PORT, LANEDECK_HOST, INBOX_DIR, CLAUDE_PROJECT_DIR.`;

const fail = (m) => { console.error(`lanedeck: ${m}`); process.exit(1); };
const args = process.argv.slice(2);
let port, host;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  const [k, inline] = a.startsWith("--") && a.includes("=") ? [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)] : [a, undefined];
  const val = () => { const v = inline ?? args[++i]; if (v === undefined || v === "" || v.startsWith("-")) fail(`${k} needs a value`); return v; };
  if (k === "--help" || k === "-h") { console.log(USAGE); process.exit(0); }
  else if (k === "--version" || k === "-v") { console.log(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version); process.exit(0); }
  else if (k === "--port" || k === "-p") { port = val(); if (!/^\d+$/.test(port) || +port < 1 || +port > 65535) fail(`invalid port "${port}"`); }
  else if (k === "--host") host = val();
  else fail(`unknown option "${a}"\n\n${USAGE}`);
}

if (Number(process.versions.node.split(".")[0]) < 20) fail(`Node 20 or newer is required (this is ${process.version})`);
if (!existsSync(join(ROOT, ".next", "BUILD_ID"))) {
  fail(`the build output (.next) is missing in ${ROOT}.\n` +
    "From a source checkout run `npm run build` first; from npm, reinstall the package (`npm i -g lanedeck@latest`).");
}

if (port) process.env.PORT = port;
if (host) process.env.LANEDECK_HOST = host;

// An installed package folder can be read-only: keep the runtime cache next to the config file instead (source checkouts keep ./data).
if (!process.env.LANEDECK_DATA_DIR && !existsSync(join(ROOT, ".git"))) {
  const { defaultConfigPath } = await import("../server/config.mjs");
  process.env.LANEDECK_DATA_DIR = dirname(defaultConfigPath());
}

const { default: config } = await import("../server/config.mjs");
const shown = ["0.0.0.0", "::", "[::]"].includes(config.server.host) ? "localhost" : config.server.host;
const url = `http://${shown.includes(":") && !shown.startsWith("[") ? `[${shown}]` : shown}:${config.server.port}`;
console.log(`lanedeck starting on ${url}`);
await import("../server/index.mjs");
