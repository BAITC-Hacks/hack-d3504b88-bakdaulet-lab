import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "mammoth", "pdf-parse", "xlsx"],
  devIndicators: false,
};

export default config;
