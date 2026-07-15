import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  transpilePackages: ["@faultspan/domain"],
  turbopack: { root: path.resolve(__dirname, "../..") },
  experimental: { externalDir: true }
};

export default nextConfig;
