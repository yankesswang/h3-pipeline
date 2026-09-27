import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // The dev badge sits on top of the sidebar status lights.
  devIndicators: false,
};

export default nextConfig;
