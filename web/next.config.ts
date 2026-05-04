import type { NextConfig } from "next";
import path from "node:path";

const IS_INDEXABLE = process.env.NEXT_PUBLIC_INDEXABLE === "true";

const securityHeaders = [
  // HSTS — once a browser has seen this, it will refuse to load the site over
  // plain HTTP for the next two years. Only flip preload on after launch.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    // Recording needs the microphone on /app routes; everything else is denied.
    value: "camera=(), geolocation=(), microphone=(self), interest-cohort=()",
  },
];

const noindexHeader = {
  key: "X-Robots-Tag",
  value: "noindex, nofollow, noarchive",
};

const nextConfig: NextConfig = {
  // Tell Turbopack the workspace root is this directory. Without this
  // it walks up the tree looking for a lockfile and finds an unrelated
  // one in the user's home dir.
  turbopack: {
    root: path.resolve(__dirname),
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: IS_INDEXABLE
          ? securityHeaders
          : [...securityHeaders, noindexHeader],
      },
    ];
  },
};

export default nextConfig;
