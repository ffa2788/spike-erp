import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["bcryptjs", "qrcode", "@prisma/client", "puppeteer-core"],
};

export default nextConfig;
