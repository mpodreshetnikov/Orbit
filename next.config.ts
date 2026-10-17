import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// A self-hosted instance serves Storage from its own domain rather than *.supabase.co, so the
// image optimizer has to accept whatever origin NEXT_PUBLIC_SUPABASE_URL names at build time.
function selfHostedStoragePattern() {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return [];
  try {
    const url = new URL(raw);
    if (url.hostname.endsWith(".supabase.co")) return [];
    return [
      {
        protocol: url.protocol.replace(":", "") as "http" | "https",
        hostname: url.hostname,
        port: url.port,
        pathname: "/storage/v1/**",
      },
    ];
  } catch {
    return [];
  }
}

const nextConfig: NextConfig = {
  // The Docker image (deploy/web.Dockerfile) runs Next's standalone server; Vercel builds without it.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  eslint: {
    ignoreDuringBuilds: true,
  },
  // The self-hosted image build skips the type check: CI has already run it on every commit that
  // reaches main, and on a small server it is the most memory-hungry step of the build.
  typescript: {
    ignoreBuildErrors: process.env.ORBIT_SKIP_BUILD_TYPECHECK === "1",
  },
  // Each build worker holds its own copy of the module graph; on a small server fewer workers trade
  // a little build time for a lower memory peak.
  experimental: process.env.ORBIT_BUILD_CPUS ? { cpus: Number(process.env.ORBIT_BUILD_CPUS) } : {},
  images: {
    remotePatterns: [
      {
        // Local Supabase storage
        protocol: "http",
        hostname: "127.0.0.1",
        port: "54321",
        pathname: "/storage/v1/**",
      },
      {
        // Local Supabase storage (localhost)
        protocol: "http",
        hostname: "localhost",
        port: "54321",
        pathname: "/storage/v1/**",
      },
      {
        // Production Supabase storage
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/**",
      },
      ...selfHostedStoragePattern(),
    ],
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
