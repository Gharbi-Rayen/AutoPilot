/**
 * PM2 process configuration.
 * Used in production (Dockerfile CMD) to manage Next.js + all CSV workers.
 *
 * Workers restart automatically on crash (max 20 times, 5s backoff).
 * If a worker crashes more than 20 times it stays down and logs the error —
 * the Next.js server and other workers keep running.
 */

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const STORAGE_ROOT = process.env.DATASET_STORAGE_ROOT ?? "/app/data/datasets";

const workerBase = {
  interpreter: "./node_modules/.bin/tsx",
  autorestart: true,
  max_restarts: 20,
  min_uptime: "5s",
  restart_delay: 5000,
  env: {
    NODE_ENV: "production",
    REDIS_URL,
    DATASET_STORAGE_ROOT: STORAGE_ROOT,
  },
};

module.exports = {
  apps: [
    // ── Next.js web server ──────────────────────────────────────────────────
    {
      name: "web",
      script: "./node_modules/.bin/next",
      args: "start",
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: "production",
        PORT: process.env.PORT ?? "3000",
        REDIS_URL,
        DATASET_STORAGE_ROOT: STORAGE_ROOT,
      },
    },

    // ── Workers ─────────────────────────────────────────────────────────────
    {
      ...workerBase,
      name: "worker-parse",
      script: "./src/workers/csv-parse.worker.ts",
      node_args: "--max-old-space-size=512",
    },
    {
      ...workerBase,
      name: "worker-sort",
      script: "./src/workers/csv-sort.worker.ts",
      node_args: "--max-old-space-size=2048",
    },
    {
      ...workerBase,
      name: "worker-filter",
      script: "./src/workers/csv-filter.worker.ts",
      node_args: "--max-old-space-size=512",
    },
    {
      ...workerBase,
      name: "worker-join",
      script: "./src/workers/csv-join.worker.ts",
      node_args: "--max-old-space-size=1024",
    },
    {
      ...workerBase,
      name: "worker-sequence",
      script: "./src/workers/csv-consecutive-sequence.worker.ts",
      node_args: "--max-old-space-size=1024",
    },
    {
      ...workerBase,
      name: "worker-aggregate",
      script: "./src/workers/csv-aggregate.worker.ts",
      node_args: "--max-old-space-size=768",
    },
    {
      ...workerBase,
      name: "worker-compare",
      script: "./src/workers/csv-compare.worker.ts",
      node_args: "--max-old-space-size=1024",
    },
    {
      ...workerBase,
      name: "worker-column-stats",
      script: "./src/workers/csv-column-stats.worker.ts",
      node_args: "--max-old-space-size=1024",
    },
    {
      ...workerBase,
      name: "worker-deduplicate",
      script: "./src/workers/csv-deduplicate.worker.ts",
      node_args: "--max-old-space-size=1024",
    },
  ],
};
