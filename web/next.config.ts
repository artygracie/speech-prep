import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Tell Turbopack the workspace root is this directory. Without this
  // it walks up the tree looking for a lockfile and finds an unrelated
  // one in the user's home dir.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
