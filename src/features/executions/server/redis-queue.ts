import Redis from "ioredis";
import { getExecutionQueuePolicy } from "./queue-policy";

// Singleton Redis connection
let redisConnection: Redis | null = null;

export const getRedisConnection = (): Redis => {
  if (!redisConnection) {
    redisConnection = new Redis({
      host: process.env.REDIS_HOST || "127.0.0.1",
      port: parseInt(process.env.REDIS_PORT || "6379", 10),
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    redisConnection.on("error", (err) => {
      console.error("[Redis Queue] Connection error:", err);
    });
  }

  return redisConnection;
};

export type ExecutionResourceProfile = "heavy" | "standard";

const HEAVY_EXECUTIONS_KEY = "executions:heavy:running";
const HEAVY_QUEUE_KEY = "executions:heavy:queue";
const EXECUTION_STATE_KEY = "executions:state:";

/**
 * Register an execution in the queue
 * Heavy executions go to a FIFO queue with slot limit
 * Standard executions have unlimited concurrency
 */
export const registerExecutionInQueue = async ({
  executionId,
  profile,
}: {
  executionId: string;
  profile: ExecutionResourceProfile;
}): Promise<"QUEUED" | "RUNNING"> => {
  const redis = getRedisConnection();

  if (profile === "standard") {
    // Standard executions run immediately
    await redis.set(
      `${EXECUTION_STATE_KEY}${executionId}`,
      "RUNNING",
      "EX",
      24 * 60 * 60,
    );
    return "RUNNING";
  }

  // Heavy execution - add to queue
  await redis.rpush(HEAVY_QUEUE_KEY, executionId);
  await redis.set(
    `${EXECUTION_STATE_KEY}${executionId}`,
    "QUEUED",
    "EX",
    24 * 60 * 60,
  );

  return "QUEUED";
};

/**
 * Acquire a slot for execution
 * For standard executions, returns immediately
 * For heavy executions, waits for a slot to be available
 */
export const acquireExecutionSlot = async ({
  executionId,
  profile,
}: {
  executionId: string;
  profile: ExecutionResourceProfile;
}): Promise<{ release: () => Promise<void> }> => {
  const policy = getExecutionQueuePolicy();
  const redis = getRedisConnection();

  if (profile === "standard") {
    // Standard executions don't have concurrency limits
    return {
      release: () => releaseExecutionSlot(executionId),
    };
  }

  // For heavy executions, wait for a slot
  const deadline = Date.now() + policy.maxQueueWaitMs;

  while (true) {
    // If this step is a retry, it might already be in the active set
    const isAlreadyRunning = await redis.sismember(
      HEAVY_EXECUTIONS_KEY,
      executionId,
    );
    if (isAlreadyRunning) {
      return {
        release: () => releaseExecutionSlot(executionId),
      };
    }

    // Check current running count
    const runningCount = await redis.scard(HEAVY_EXECUTIONS_KEY);
    const hasCapacity = runningCount < policy.maxConcurrentHeavyExecutions;

    if (hasCapacity) {
      // Try to move from queue to running
      const nextExecution = await redis.lindex(HEAVY_QUEUE_KEY, 0);

      if (nextExecution === executionId) {
        // This is our turn! Remove from queue and add to running
        await redis.lpop(HEAVY_QUEUE_KEY);
        await redis.sadd(HEAVY_EXECUTIONS_KEY, executionId);
        await redis.set(
          `${EXECUTION_STATE_KEY}${executionId}`,
          "RUNNING",
          "EX",
          24 * 60 * 60,
        );

        return {
          release: () => releaseExecutionSlot(executionId),
        };
      }
    }

    if (Date.now() >= deadline) {
      throw new Error(
        "Execution queue wait time exceeded. Please retry after current heavy runs complete.",
      );
    }

    // Wait before checking again
    await new Promise((resolve) =>
      setTimeout(resolve, policy.queuePollIntervalMs),
    );
  }
};

/**
 * Release an execution slot
 * Finds the execution in whichever queue it's in and cleans it up
 */
export const releaseExecutionSlot = async (executionId: string) => {
  const redis = getRedisConnection();

  // Remove from heavy running set if present
  await redis.srem(HEAVY_EXECUTIONS_KEY, executionId);

  // Remove from heavy queue if present
  await redis.lrem(HEAVY_QUEUE_KEY, 1, executionId);

  // Clean up state
  await redis.del(`${EXECUTION_STATE_KEY}${executionId}`);
};

/**
 * Get the state of a single execution
 * Returns null if execution not found or completed
 */
export const getExecutionQueueState = async (
  executionId: string,
): Promise<"QUEUED" | "RUNNING" | null> => {
  const redis = getRedisConnection();

  const state = await redis.get(`${EXECUTION_STATE_KEY}${executionId}`);

  if (state === "RUNNING" || state === "QUEUED") {
    return state;
  }

  return null;
};

/**
 * Get the state of all tracked executions
 * If executionIds array provided, only fetch those
 * Otherwise, fetch all
 */
export const getExecutionQueueStates = async (
  executionIds?: string[],
): Promise<Record<string, "QUEUED" | "RUNNING">> => {
  const redis = getRedisConnection();
  const states: Record<string, "QUEUED" | "RUNNING"> = {};

  if (executionIds && executionIds.length > 0) {
    // Fetch specific executions
    for (const id of executionIds) {
      const state = await getExecutionQueueState(id);
      if (state) {
        states[id] = state;
      }
    }
    return states;
  }

  // Fetch all tracked executions

  // Get all from heavy running set
  const runningIds = await redis.smembers(HEAVY_EXECUTIONS_KEY);
  for (const id of runningIds) {
    states[id] = "RUNNING";
  }

  // Get all from heavy queue
  const queuedIds = await redis.lrange(HEAVY_QUEUE_KEY, 0, -1);
  for (const id of queuedIds) {
    states[id] = "QUEUED";
  }

  // Scan for any remaining registered executions
  let cursor = "0";
  do {
    const result = await redis.scan(cursor, "MATCH", `${EXECUTION_STATE_KEY}*`);
    cursor = result[0];
    const keys = result[1];

    for (const key of keys) {
      const executionId = key.replace(EXECUTION_STATE_KEY, "");
      if (!states[executionId]) {
        const state = await redis.get(key);
        if (state === "RUNNING" || state === "QUEUED") {
          states[executionId] = state;
        }
      }
    }
  } while (cursor !== "0");

  return states;
};

export const healthCheckRedis = async (): Promise<boolean> => {
  try {
    const redis = getRedisConnection();
    const pong = await redis.ping();
    return pong === "PONG";
  } catch {
    return false;
  }
};

export const closeRedisConnections = async () => {
  if (redisConnection) {
    await redisConnection.quit();
    redisConnection = null;
  }
};

/**
 * Sweeps all orphaned logic locks when the Next.js development server boots.
 * Useful to prevent `concurrently` restarts and force-kills from indefinitely hanging
 * the pipeline at `acquireExecutionSlot` due to missed `releaseExecutionSlot()` events.
 */
export const purgeDevQueues = async () => {
  if (process.env.NODE_ENV !== "development") return;
  const redis = getRedisConnection();
  try {
    await redis.del(HEAVY_EXECUTIONS_KEY);
    await redis.del(HEAVY_QUEUE_KEY);

    let cursor = "0";
    do {
      const result = await redis.scan(
        cursor,
        "MATCH",
        `${EXECUTION_STATE_KEY}*`,
      );
      cursor = result[0];
      const keys = result[1];
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== "0");
    console.log(
      "[Redis Queue] Developer environment detected: Cleared all ghost execution locks successfully.",
    );
  } catch (error) {
    console.error("[Redis Queue] Failed to clear dev queues on boot:", error);
  }
};
