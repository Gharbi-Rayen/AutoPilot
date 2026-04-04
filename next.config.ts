import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",  webpack: (config, { dev }) => {
    if (dev) {
      const existingIgnored = config.watchOptions?.ignored || [];
      const ignoredArray = Array.isArray(existingIgnored)
        ? existingIgnored
        : [existingIgnored];
      
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [...ignoredArray, "**/node_modules/**", "**/.autopilot-data/**"],
      };
    }
    return config;
  },  serverExternalPackages: ["pdf-parse", "pdf2json", "@napi-rs/canvas", "bullmq", "ioredis"],
  /* config options here */
  async redirects() {
    return [
      {
        source: "/",
        destination: "/workflows",
        permanent: false,
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "rayen-gharbi",

  project: "autopilote",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  // Webpack configuration for tree-shaking and Vercel monitors
  // Note: disableLogger and automaticVercelMonitors are deprecated, use webpack options instead
  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
    automaticVercelMonitors: true,
  },
});
