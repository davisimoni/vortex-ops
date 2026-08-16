import type { NextConfig } from "next";

/**
 * Vortex Ops — Next.js configuration.
 *
 * Lint is intentionally decoupled from `next build`: CI runs `npm run lint` as its
 * own job so a style violation is reported as a lint failure, not as a broken build.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  /*
   * Prisma ships a native query engine and generates its client into
   * node_modules. Bundling it breaks the engine's file resolution, and the
   * dynamic import in `src/server/repository/index.ts` — the thing that lets a
   * missing client degrade to the in-memory driver instead of failing the build
   * — only behaves if the module stays external.
   */
  serverExternalPackages: ["@prisma/client", ".prisma/client"],
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Type errors must break the build. Never set this to true.
    ignoreBuildErrors: false,
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.npm_package_version ?? "1.0.0",
    NEXT_PUBLIC_REGION: process.env.VORTEX_REGION ?? "eu-central-1",
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
