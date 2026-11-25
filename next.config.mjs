import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Served by server/index.mjs on 127.0.0.1:4280 (not a static export: the page needs the live API).
// Plain .mjs (not .ts) so the installed package does not need TypeScript at runtime.
/** @type {import("next").NextConfig} */
const nextConfig = {
  // Pin the tracing root to this folder (otherwise Next guesses it from lockfiles in parent folders).
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
  poweredByHeader: false,
  reactStrictMode: true,
  images: { unoptimized: true },
  devIndicators: false,
  // The inbox server code is plain Node ESM next to the app; keep it out of the type-check.
  typescript: { tsconfigPath: "tsconfig.json" },
};

export default nextConfig;
