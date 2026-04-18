import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: {
      canvas: "./node_modules/canvas/index.js",
    },
  },
};

export default nextConfig;
