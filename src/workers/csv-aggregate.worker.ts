import { type Job, UnrecoverableError, Worker } from "bullmq";
import Redis from "ioredis";
import { DATASET_STORAGE } from "@/config/constants";
import {
  extractInlineRows,
  parseNumber,
  streamContextRows,
  toDatasetRefOutput,
} from "@/features/executions/components/csv-shared/executor-utils";
import { isDatasetRef } from "@/features/executions/server/datasets/dataset-ref";
import { datasetService } from "@/features/executions/server/datasets/dataset-service";
import {
  applySchemaToRows,
  inferDatasetSchema,
} from "@/features/executions/server/datasets/schema-inference";
import { inngest } from "@/inngest/client";
import {
  DEFAULT_WORKER_SETTINGS,
  DEFAULT_WORKER_STALL_OPTIONS,
} from "@/workers/worker-settings";

const HEAVY_CONCURRENCY = 2;
const QUEUE_NAME = "csv-aggregate";

type AggregateOperation = "count" | "sum" | "avg" | "min" | "max";

export interface CsvAggregateJobData {
  executionId: string;
  variableName: string;
  sourceRef: unknown;
  sourceRows: number;
  groupBy: string;
  operation: AggregateOperation;
  targetField?: string;
}

export interface CsvAggregateJobResult {
  kind: "dataset";
  datasetId: string;
  executionId: string;
  variableName: string;
  storage: string;
  manifestVersion: number;
  rowCount: number;
  chunkCount: number;
  byteSize: number;
  schema?: Record<string, unknown>;
  summary: {
    sourceRows: number;
    groupCount: number;
    operation: AggregateOperation;
    targetField: string | null;
  };
}

const workerConnection = new Redis(
  process.env.REDIS_URL ?? "redis://localhost:6379",
  {
    maxRetriesPerRequest: null,
  },
);

const aggregateRows = async (
  job: Job<CsvAggregateJobData, CsvAggregateJobResult>,
): Promise<CsvAggregateJobResult> => {
  const {
    executionId,
    variableName,
    sourceRef,
    sourceRows,
    groupBy,
    operation,
    targetField,
  } = job.data;

  if (operation !== "count" && !targetField) {
    throw new UnrecoverableError(
      "targetField is required for sum/avg/min/max operations",
    );
  }

  const buckets = new Map<
    string,
    {
      count: number;
      numericCount: number;
      sum: number;
      min: number | null;
      max: number | null;
    }
  >();

  const inlineRows = extractInlineRows(sourceRef);
  const useFastPath =
    !isDatasetRef(sourceRef) &&
    inlineRows.length > 0 &&
    inlineRows.length <= DATASET_STORAGE.MAX_INLINE_DATASET_ROWS;

  const consumeRow = (row: Record<string, unknown>) => {
    const key = String(row[groupBy] ?? "");
    const bucket = buckets.get(key) || {
      count: 0,
      numericCount: 0,
      sum: 0,
      min: null,
      max: null,
    };

    bucket.count += 1;

    if (operation !== "count" && targetField) {
      const numberValue = parseNumber(row[targetField]);
      if (numberValue !== null) {
        bucket.numericCount += 1;
        bucket.sum += numberValue;
        bucket.min =
          bucket.min === null ? numberValue : Math.min(bucket.min, numberValue);
        bucket.max =
          bucket.max === null ? numberValue : Math.max(bucket.max, numberValue);
      }
    }

    buckets.set(key, bucket);
  };

  if (useFastPath) {
    for (const row of inlineRows) {
      consumeRow(row);
    }
  } else {
    for await (const row of streamContextRows(sourceRef)) {
      consumeRow(row);
    }
  }

  const records = Array.from(buckets.entries()).map(([groupKey, bucket]) => {
    const result: Record<string, unknown> = {
      [groupBy]: groupKey,
      count: bucket.count,
      numericCount: bucket.numericCount,
    };

    if (operation === "count") {
      result.value = bucket.count;
      return result;
    }

    if (bucket.numericCount === 0) {
      result.value = null;
      return result;
    }

    if (operation === "sum") {
      result.value = bucket.sum;
      return result;
    }

    if (operation === "avg") {
      result.value = bucket.sum / bucket.numericCount;
      return result;
    }

    if (operation === "min") {
      result.value = bucket.min;
      return result;
    }

    result.value = bucket.max;
    return result;
  });

  const schema = inferDatasetSchema(records);
  const typedRecords = applySchemaToRows(records, schema);

  const manifest = await datasetService.persistRowsFromStream({
    executionId,
    variableName,
    rows: typedRecords,
    chunkSize: DATASET_STORAGE.DEFAULT_CHUNK_SIZE_ROWS,
    schema,
  });

  return {
    ...toDatasetRefOutput(manifest),
    summary: {
      sourceRows,
      groupCount: records.length,
      operation,
      targetField: targetField ?? null,
    },
  };
};

const worker = new Worker<CsvAggregateJobData, CsvAggregateJobResult>(
  QUEUE_NAME,
  async (job) => {
    console.log(`[csv-aggregate] job ${job.id} started`);
    return aggregateRows(job);
  },
  {
    connection: workerConnection,
    concurrency: HEAVY_CONCURRENCY,
    settings: DEFAULT_WORKER_SETTINGS,
    ...DEFAULT_WORKER_STALL_OPTIONS,
  },
);

worker.on("completed", async (job, result) => {
  try {
    await inngest.send({
      name: "csv/aggregate.complete",
      data: {
        executionId: job.data.executionId,
        variableName: job.data.variableName,
        result,
      },
    });
  } catch {
    // Ignore notification failures.
  }
});

worker.on("failed", async (job, error) => {
  const isUnrecoverable = error instanceof UnrecoverableError;

  if (
    isUnrecoverable ||
    (job && job.attemptsMade >= (job.opts.attempts ?? 3))
  ) {
    const failurePayload = {
      executionId: job?.data.executionId,
      variableName: job?.data.variableName,
      error: error.message,
      reason: error.message,
      status: "failed" as const,
    };

    try {
      await inngest.send({
        name: "csv/aggregate.failed",
        data: failurePayload,
      });

      await inngest.send({
        name: "csv/aggregate.complete",
        data: failurePayload,
      });
    } catch {
      // Ignore notification failures.
    }
  }
});

const shutdown = async (signal: string) => {
  console.log(`[csv-aggregate] ${signal} received - draining worker`);
  await worker.close();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

console.log(
  `[csv-aggregate] Worker online - queue="${QUEUE_NAME}" concurrency=${HEAVY_CONCURRENCY}`,
);
