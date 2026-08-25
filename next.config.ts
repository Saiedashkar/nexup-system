import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Performance: skip type checking during build (we do it separately) */
  typescript: {
    ignoreBuildErrors: false,
  },

  /* Experimental optimizations */
  experimental: {
    /* Reduce JS bundle size with SWC minifier */
    optimizePackageImports: ["lucide-react"],
  },

  /* Compress responses */
  compress: true,

  /* Disable x-powered-by header */
  poweredByHeader: false,

  /* Production source maps off */
  productionBrowserSourceMaps: false,

  /* Compiler options */
  compiler: {
    /* Remove console.log in production */
    removeConsole: process.env.NODE_ENV === "production" ? { exclude: ["error", "warn"] } : false,
  },
};

export default nextConfig;
