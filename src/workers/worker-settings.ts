export const DEFAULT_WORKER_SETTINGS = {
  // Keep retry backoff bounded and deterministic across all workers.
  backoffStrategy: (attemptsMade: number) =>
    Math.min(1000 * 2 ** attemptsMade, 30_000),
};

export const DEFAULT_WORKER_STALL_OPTIONS = {
  // Detect stalled jobs quickly and fail them instead of hanging silently.
  stalledInterval: 30_000,
  maxStalledCount: 1,
  lockDuration: 300_000,
};
