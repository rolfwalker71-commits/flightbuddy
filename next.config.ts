import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Keep Node-only libs out of the webpack graph (web-push → agent-base
  // needs http/https/net; bullmq optionally imports @valkey/valkey-glide).
  serverExternalPackages: ["web-push", "bullmq"],
};

export default nextConfig;
