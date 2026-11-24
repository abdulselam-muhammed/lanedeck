import type { NextConfig } from "next";

// Served by server/index.mjs on 127.0.0.1:4280 (not a static export: the page needs the live API).
const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  images: { unoptimized: true },
  devIndicators: false,
  // The inbox server code is plain Node ESM next to the app; keep it out of the type-check.
  typescript: { tsconfigPath: "tsconfig.json" },
};

export default nextConfig;
