import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");

    // Initialize Redis queue backend health check
    try {
      const { healthCheckRedis } = await import(
        "@/features/executions/server/redis-queue"
      );
      const isHealthy = await healthCheckRedis();
      if (isHealthy) {
        console.log("[Queue] Redis backend initialized successfully");
      } else {
        console.warn(
          "[Queue] Redis health check failed - queue may not be operational",
        );
      }
    } catch (error) {
      console.error("[Queue] Failed to initialize Redis backend:", error);
    }
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
