import { type Job, UnrecoverableError, Worker } from "bullmq";
import { DATASET_STORAGE } from "@/config/constants";
import { streamContextRows } from "@/features/executions/components/csv-shared/executor-utils";
import { datasetService } from "@/features/executions/server/datasets/dataset-service";
import { hashJoinRows } from "@/features/executions/server/datasets/hash-join";
import type {
  JoinPlan,
  JoinType,
} from "@/features/executions/server/datasets/join-planner";
import { inferDatasetSchema } from "@/features/executions/server/datasets/schema-inference";
import type { DatasetSchema } from "@/features/executions/server/datasets/schema-types";
import { inngest } from "@/inngest/client";
import {
  DEFAULT_WORKER_SETTINGS,
  DEFAULT_WORKER_STALL_OPTIONS,
} from "@/workers/worker-settings";

const HEAVY_CONCURRENCY = 2;
const QUEUE_NAME = "csv-join";

export interface CsvJoinJobData {
  plan: Exclude<JoinPlan, { strategy: "reject" }>;
  executionId: string;
  datasetId: string;
  variableName: string;
  leftRef: unknown;
  rightRef: unknown;
  leftKeys: string[];
  rightKeys: string[];
  joinType: JoinType;
  schema?: DatasetSchema;
}

export interface CsvJoinJobResult {
  datasetRef: {
    kind: "dataset";
    datasetId: string;
    executionId: string;
    variableName: string;
    storage: string;
    manifestVersion: number;
    rowCount: number;
    chunkCount: number;
    byteSize: number;
    schema?: DatasetSchema;
  };
}

import Redis from "ioredis";

const workerConnection = new Redis(
  process.env.REDIS_URL ?? "redis://localhost:6379",
  { maxRetriesPerRequest: null },
);

workerConnection.on("connect", () => {
  console.log(
    "[csv-join] Redis connected:",
    process.env.REDIS_URL ?? "redis://localhost:6379",
  );
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
        variableName,
        leftRef,
        rightRef,
        leftKeys,
        rightKeys,
        joinType,
      } = job.data;

      let joinedRows: AsyncGenerator<Record<string, unknown>, void, void>;

      if (plan.strategy === "hash") {
        joinedRows = hashJoinRows({
          leftRows: streamContextRows(leftRef),
          rightRows: streamContextRows(rightRef),
          leftKeys: leftKeys || [],
          rightKeys: rightKeys || [],
          joinType,
          buildSide: plan.buildSide,
          caseInsensitive: plan.caseInsensitive,
          outputColumns: plan.outputColumns,
        });
      } else {
        throw new UnrecoverableError(
          `Unsupported join strategy: ${plan.strategy}`,
        );
      }

      // Buffer the first N rows to infer the schema from the actual output
      // columns (which are the merged left+right columns, not just the left
      // source schema that the executor passes in).
      const SCHEMA_SAMPLE_SIZE = 500;
      const sampleBuffer: Array<Record<string, unknown>> = [];
      const joinedRowsIterator = joinedRows[Symbol.asyncIterator]();

      // Drain up to SCHEMA_SAMPLE_SIZE rows so we can infer the real output schema
      // (merged left+right columns) before writing begins.
      let streamExhausted = false;
      for (let i = 0; i < SCHEMA_SAMPLE_SIZE; i++) {
        const { value, done } = await joinedRowsIterator.next();
        if (done) {
          streamExhausted = true;
          break;
        }
        sampleBuffer.push(value);
      }

      const inferredSchema: DatasetSchema =
        sampleBuffer.length > 0
          ? inferDatasetSchema(sampleBuffer)
          : (job.data.schema ?? {});

      // Re-assemble: yield the buffered rows first, then the rest of the stream.
      const fullStream = async function* () {
        for (const row of sampleBuffer) {
          yield row;
        }
        if (!streamExhausted) {
          let next = await joinedRowsIterator.next();
          while (!next.done) {
            yield next.value;
            next = await joinedRowsIterator.next();
          }
        }
      };

      let rowsProcessed = 0;
      const progressGenerator = async function* () {
        console.log("[csv-join] PROGRESS GENERATOR STARTED.");
        for await (const row of fullStream()) {
          if (rowsProcessed === 0) console.log("[csv-join] YIELDED FIRST ROW.");
          rowsProcessed++;
          if (rowsProcessed % 10_000 === 0) {
            await job.updateProgress(rowsProcessed);
          }
          yield row;
        }
        console.log(
          "[csv-join] PROGRESS GENERATOR DONE, processed:",
          rowsProcessed,
        );
      };

      console.log("[csv-join] Calling datasetService.persistRowsFromStream...");
      const manifest = await datasetService.persistRowsFromStream({
        executionId,
        datasetId: job.data.datasetId,
        variableName,
        rows: progressGenerator(),
        chunkSize: DATASET_STORAGE.DEFAULT_CHUNK_SIZE_ROWS,
        schema: inferredSchema,
      });
      console.log("[csv-join] Persist finished:", manifest.rowCount);

      return {
        datasetRef: {
          kind: "dataset" as const,
          datasetId: manifest.datasetId,
          executionId: manifest.executionId,
          variableName: manifest.variableName,
          storage: manifest.storage,
          manifestVersion: manifest.version,
          rowCount: manifest.rowCount,
          chunkCount: manifest.chunkCount,
          byteSize: manifest.byteSize,
          schema: manifest.schema,
        },
      };
    } catch (err) {
      console.error(`[csv-join] ✗ HANDLER CRASH:`, err);
      throw err;
    }
  },
  {
    connection: workerConnection,
    concurrency: HEAVY_CONCURRENCY,
    settings: DEFAULT_WORKER_SETTINGS,
    ...DEFAULT_WORKER_STALL_OPTIONS,
  },
);

worker.on("completed", async (job, result) => {
  console.log(
    `[csv-join] COMPLETED job ${job.id} — ${result.datasetRef.rowCount.toLocaleString()} rows`,
  );
  try {
    await inngest.send({
      name: "csv/join.complete",
      data: {
        executionId: job.data.executionId,
        datasetId: result.datasetRef.datasetId,
        variableName: job.data.variableName,
        rowCount: result.datasetRef.rowCount,
        result,
      },
    });
  } catch (err) {
    console.error("Failed to signal inngest", err);
  }
});

worker.on("failed", async (job, err) => {
  const isUnrecoverable = err instanceof UnrecoverableError;
  const isFinalAttempt =
    isUnrecoverable || (job && job.attemptsMade >= (job.opts.attempts ?? 3));

  console.error(
    `[csv-join] FAILED job ${job?.id} (attempt ${job?.attemptsMade}):`,
    err?.message,
  );

  if (isFinalAttempt && job) {
    const executionId = job.data.executionId;
    const reason = err?.message ?? "csv-join worker failed";

    // Send .complete with failed:true so the executor's waitForEvent resolves
    // immediately instead of hanging for 60 minutes.
    try {
      await inngest.send({
        name: "csv/join.complete",
        data: { executionId, error: reason, failed: true },
      });
    } catch (signalErr) {
      console.error(
        "[csv-join] Failed to signal inngest completion:",
        signalErr,
      );
    }

    // Also send the dedicated failure event for any listeners / dashboards.
    try {
      await inngest.send({
        name: "csv/join.failed",
        data: { executionId, reason },
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
