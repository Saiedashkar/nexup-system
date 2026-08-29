import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* TypeScript checking during build */
  typescript: {
    ignoreBuildErrors: false,
  },

  /* Experimental optimizations */
  experimental: {
    /* Reduce JS bundle size with SWC minifier */
    optimizePackageImports: ["lucide-react"],
    /* Enable PPR for faster initial loads */
    ppr: false,
    /* Optimize CSS */
    optimizeCss: true,
  },

  /* Compress responses (Brotli/Gzip) */
  compress: true,

  /* Disable x-powered-by header for security */
  poweredByHeader: false,

  /* Production source maps off for smaller bundles */
  productionBrowserSourceMaps: false,

  /* Compiler options */
  compiler: {
    /* Remove console.log in production */
    removeConsole: process.env.NODE_ENV === "production" ? { exclude: ["error", "warn"] } : false,
  },

  /* Image optimization */
  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60 * 60 * 24 * 30, // 30 days
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  },

  /* Custom headers for caching and security */
  async headers() {
    return [
      {
        /* Cache static assets aggressively */
        source: "/(.*)\\.(jpg|jpeg|png|gif|ico|svg|webp|avif|woff|woff2|ttf|eot)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        /* Cache Next.js static files */
        source: "/_next/static/(.*)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        /* Cache JS/CSS bundles */
        source: "/(.*)\\.(js|css)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
      {
        /* Security headers */
        source: "/(.*)",
        headers: [
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-XSS-Protection",
            value: "1; mode=block",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
        ],
      },
    ];
  },

  /* Webpack optimizations */
  webpack: (config, { isServer }) => {
    if (!isServer) {
      /* Don't bundle Prisma client on client side */
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        child_process: false,
      };
    }
    return config;
  },
};

export default nextConfig;
