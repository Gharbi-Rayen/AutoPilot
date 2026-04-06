import { type Job, UnrecoverableError, Worker } from "bullmq";
import { NonRetriableError } from "inngest";
import { DATASET_STORAGE } from "@/config/constants";
import {
  unionAllRows,
  unionRows,
} from "@/features/executions/components/csv-join/union-executor";
import { streamContextRows } from "@/features/executions/components/csv-shared/executor-utils";
import { crossJoinRows } from "@/features/executions/server/datasets/cross-join";
import { datasetService } from "@/features/executions/server/datasets/dataset-service";
import { hashJoinRows } from "@/features/executions/server/datasets/hash-join";
import type { JoinPlan } from "@/features/executions/server/datasets/join-planner";
import { getRedisConnection } from "@/features/executions/server/redis-queue";
import { inngest } from "@/inngest/client";

const HEAVY_CONCURRENCY = 2;
const QUEUE_NAME = "csv-join";

export interface CsvJoinJobData {
  plan: Exclude<JoinPlan, { strategy: "reject" }>;
  executionId: string;
  datasetId: string;
  variableName: string;
  leftRef: any;
  rightRef: any;
  leftKeys: string[];
  rightKeys: string[];
  joinType: string;
  schema?: any;
}

export interface CsvJoinJobResult {
  rowCount: number;
}

import Redis from "ioredis";

const workerConnection = new Redis(
  process.env.REDIS_URL ?? "redis://localhost:6379",
  { maxRetriesPerRequest: null }
);

workerConnection.on("connect", () => {
  console.log("[csv-join] Redis connected:", process.env.REDIS_URL ?? "redis://localhost:6379");
});

const worker = new Worker<CsvJoinJobData, CsvJoinJobResult>(
  QUEUE_NAME,
  async (
    job: Job<CsvJoinJobData, CsvJoinJobResult>,
  ): Promise<CsvJoinJobResult> => {
    console.log(`[csv-join] ▶ WORKER HIT — job ${job.id}`);
    try {
      const {
        plan,
        executionId,
      datasetId,
      variableName,
      leftRef,
      rightRef,
      leftKeys,
      rightKeys,
      joinType,
    } = job.data;

    let joinedRows: AsyncGenerator<Record<string, unknown>, void, void>;

    // Deduplicate shared columns for natural joins (moved to worker logic)
    const deduplicateSharedColumns = (
      merged: Record<string, unknown>,
      sharedColumns: string[],
    ): Record<string, unknown> => {
      const result = { ...merged };
      for (const col of sharedColumns) {
        delete result[`right_${col}`]; // left-side version already present
      }
      return result;
    };

    if (plan.strategy === "hash") {
      let _joinedRows = hashJoinRows({
        leftRows: streamContextRows(leftRef),
        rightRows: streamContextRows(rightRef),
        leftKeys: leftKeys || [],
        rightKeys: rightKeys || [],
        joinType: joinType as any,
        buildSide: plan.buildSide,
        caseInsensitive: plan.caseInsensitive,
        outputColumns: plan.outputColumns,
      });

      if (joinType === "natural" && plan.sharedColumns) {
        const sharedColumns = plan.sharedColumns;
        const baseGenerator = _joinedRows;
        _joinedRows = (async function* () {
          for await (const row of baseGenerator) {
            yield deduplicateSharedColumns(row, sharedColumns);
          }
        })();
      }
      joinedRows = _joinedRows;
    } else if ((plan.strategy as string) === "nested_loop") {
      joinedRows = crossJoinRows({
        leftRows: streamContextRows(leftRef),
        rightRows: streamContextRows(rightRef),
        outputColumns: (plan as any).outputColumns,
      });
    } else if (
      (plan.strategy as string) === "union" ||
      (plan.strategy as string) === "union_all"
    ) {
      const isAll = (plan.strategy as string) === "union_all";
      const _unionRows = isAll
        ? unionAllRows(streamContextRows(leftRef), streamContextRows(rightRef))
        : unionRows(streamContextRows(leftRef), streamContextRows(rightRef));

      joinedRows = (async function* () {
        for await (const row of _unionRows) {
          yield row as Record<string, unknown>;
        }
      })();
    } else {
      throw new UnrecoverableError(
        `Unsupported join strategy: ${plan.strategy}`,
      );
    }

    let rowsProcessed = 0;
    const progressGenerator = async function* () {
      console.log("[csv-join] PROGRESS GENERATOR STARTED.");
      for await (const row of joinedRows) {
        if (rowsProcessed === 0) console.log("[csv-join] YIELDED FIRST ROW.");
        rowsProcessed++;
if (rowsProcessed % 10_000 === 0) {
await job.updateProgress(rowsProcessed);
}
        yield row;
      }
      console.log("[csv-join] PROGRESS GENERATOR DONE, processed:", rowsProcessed);
    };

    console.log("[csv-join] Calling datasetService.persistRowsFromStream...");
    const manifest = await datasetService.persistRowsFromStream({
      executionId,
      variableName,
      rows: progressGenerator(),
      chunkSize: DATASET_STORAGE.DEFAULT_CHUNK_SIZE_ROWS,
      schema: job.data.schema ?? undefined,
    });
    console.log("[csv-join] Persist finished:", manifest.rowCount);

    return { rowCount: manifest.rowCount };
    } catch (err) {
      console.error(`[csv-join] ✗ HANDLER CRASH:`, err);
      throw err;
    }
  },
  {
    connection: workerConnection,
    concurrency: HEAVY_CONCURRENCY,
    settings: {
      backoffStrategy: (attemptsMade) =>
        Math.min(1000 * 2 ** attemptsMade, 30_000),
    },
  },
);

worker.on("completed", async (job, result) => {
  console.log(
    `[csv-join] COMPLETED job ${job.id} — ${result.rowCount.toLocaleString()} rows`,
  );
  try {
    await inngest.send({
      name: "csv/join.complete",
      data: {
        executionId: job.data.executionId,
        datasetId: job.data.datasetId,
        variableName: job.data.variableName,
        rowCount: result.rowCount,
      },
    });
  } catch (err) {
    console.error("Failed to signal inngest", err);
  }
});

worker.on("failed", async (job, err) => {
  const isUnrecoverable = err instanceof UnrecoverableError;
  console.error(`[csv-join] FAILED job ${job?.id}:`, err?.message);
  console.error(`[csv-join] Full error:`, err);
  if (
    isUnrecoverable ||
    (job && job.attemptsMade >= (job.opts.attempts ?? 3))
  ) {
    try {
      await inngest.send({
        name: "csv/join.failed",
        data: { executionId: job?.data.executionId, reason: err.message },
      });
    } catch {}
  }
});

const shutdown = async (signal: string) => {
  console.log(`[csv-join] ${signal} received � draining worker...`);
  await worker.close();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
console.log(
  `[csv-join] Worker online � queue="${QUEUE_NAME}" concurrency=${HEAVY_CONCURRENCY}`,
);

