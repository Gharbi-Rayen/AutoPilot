import { cleanupExecutionDatasets } from "@/features/executions/server/datasets/cleanup";
import { cleanupStaleWriteTransactions } from "@/features/executions/server/datasets/write-transaction";
import { getRedisConnection } from "@/features/executions/server/redis-queue";
import { inngest } from "./client";

/**
 * Scheduled cleanup job for Redis queue backend.
 * This runs periodically to clean up stale jobs and maintain queue health.
 * Runs every hour to expire old job records from Redis.
 */
export const cleanupRedisQueue = inngest.createFunction(
  {
    id: "cleanup/redis-queue",
  },
  { cron: "0 * * * *" }, // Run every hour
  async ({ step }) => {
    console.log("[Inngest] Starting Redis queue cleanup...");

    try {
      await step.run("cleanup-stale-jobs", async () => {
        const redis = getRedisConnection();

        // Scan for bull queue keys and set expiry on old entries
        const pattern = "bull:*";
        let cursor = "0";
        let cleaned = 0;

        do {
          const result = await redis.scan(cursor, "MATCH", pattern);
          cursor = result[0];
          const keys = result[1];

          for (const key of keys) {
            try {
              // Check if it's a completed job
              if (key.includes(":completed") || key.includes(":failed")) {
                const ttl = await redis.pttl(key);
                if (ttl === -1) {
                  // No TTL set, set expiry to 7 days
                  await redis.expire(key, 7 * 24 * 60 * 60);
                  cleaned += 1;
                }
              }
            } catch (error) {
              console.warn(
                `Failed to process key ${key}:`,
                error instanceof Error ? error.message : String(error),
              );
            }
          }
        } while (cursor !== "0");

        console.log(`[Inngest] Cleaned up ${cleaned} queue entries`);
        return { cleaned };
      });

      await step.run("cleanup-execution-datasets", async () => {
        console.log("[Inngest] Starting dataset cleanup...");
        try {
          const staleWriteCleaned = await cleanupStaleWriteTransactions();
          const datasetCleanStats = await cleanupExecutionDatasets();
          console.log(
            `[Inngest] Dataset cleanup: Stale writes cleaned: ${staleWriteCleaned}`,
            datasetCleanStats,
          );
          return { staleWriteCleaned, datasetCleanStats };
        } catch (error) {
          console.error(
            "[Inngest] Failed to clean up execution datasets",
            error,
          );
          throw error;
        }
      });

      console.log("[Inngest] Periodic cleanups completed successfully");
      return { status: "success" };
    } catch (error) {
      console.error("[Inngest] Periodic cleanup failed:", error);
    }
  },
);
