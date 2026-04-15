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
const QUEUE_NAME = "csv-column-stats";
const MAX_UNIQUE_VALUES_TRACKED = 10_000;

export interface CsvColumnStatsJobData {
  executionId: string;
  variableName: string;
  sourceRef: unknown;
  sourceRows: number;
  fields?: string[];
}

export interface CsvColumnStatsJobResult {
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
    rowCount: number;
    fieldCount: number;
    columns: Record<string, unknown>;
  };
}

const collectFieldNames = (rows: Array<Record<string, unknown>>): string[] =>
  Array.from(new Set(rows.flatMap((row) => Object.keys(row))));

const workerConnection = new Redis(
  process.env.REDIS_URL ?? "redis://localhost:6379",
  {
    maxRetriesPerRequest: null,
  },
);

const computeColumnStats = async (
  job: Job<CsvColumnStatsJobData, CsvColumnStatsJobResult>,
): Promise<CsvColumnStatsJobResult> => {
  const { executionId, variableName, sourceRef, sourceRows } = job.data;

  const inlineRows = extractInlineRows(sourceRef);
  const requestedFields = Array.isArray(job.data.fields) ? job.data.fields : [];

  const fields =
    requestedFields.length > 0
      ? requestedFields
      : !isDatasetRef(sourceRef)
        ? collectFieldNames(inlineRows)
        : sourceRef.schema
          ? Object.keys(sourceRef.schema)
          : [];

  if (fields.length === 0) {
    throw new UnrecoverableError(
      "fields is required when source is a dataset reference",
    );
  }

  const stats = new Map<
    string,
    {
      total: number;
      nonNull: number;
      nullCount: number;
      numericCount: number;
      sum: number;
      min: number | null;
      max: number | null;
      uniqueValues: Set<string>;
      frequencies: Map<string, number>;
      frequencyTableTruncated: boolean;
    }
  >();

  for (const field of fields) {
    stats.set(field, {
      total: sourceRows,
      nonNull: 0,
      nullCount: 0,
      numericCount: 0,
      sum: 0,
      min: null,
      max: null,
      uniqueValues: new Set<string>(),
      frequencies: new Map<string, number>(),
      frequencyTableTruncated: false,
    });
  }

  const useFastPath =
    !isDatasetRef(sourceRef) &&
    inlineRows.length > 0 &&
    inlineRows.length <= DATASET_STORAGE.MAX_INLINE_DATASET_ROWS;

  const consumeRow = (row: Record<string, unknown>) => {
    for (const field of fields) {
      const entry = stats.get(field);
      if (!entry) {
        continue;
      }

      const value = row[field];
      const isNullish =
        value === undefined ||
        value === null ||
        (typeof value === "string" && value.trim() === "");

      if (isNullish) {
        entry.nullCount += 1;
        continue;
      }

      entry.nonNull += 1;

      const serialized = String(value);
      if (
        entry.uniqueValues.size < MAX_UNIQUE_VALUES_TRACKED ||
        entry.uniqueValues.has(serialized)
      ) {
        entry.uniqueValues.add(serialized);
        entry.frequencies.set(
          serialized,
          (entry.frequencies.get(serialized) || 0) + 1,
        );
      } else {
        entry.frequencyTableTruncated = true;
      }

      const numericValue = parseNumber(value);
      if (numericValue !== null) {
        entry.numericCount += 1;
        entry.sum += numericValue;
        entry.min =
          entry.min === null ? numericValue : Math.min(entry.min, numericValue);
        entry.max =
          entry.max === null ? numericValue : Math.max(entry.max, numericValue);
      }
    }
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

  const records = Array.from(stats.entries()).map(([field, entry]) => {
    const topValues = Array.from(entry.frequencies.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([value, count]) => ({ value, count }));

    const isTruncated = entry.frequencyTableTruncated;
    const uniqueCountValue = isTruncated
      ? `${MAX_UNIQUE_VALUES_TRACKED}+`
      : String(entry.uniqueValues.size);

    return {
      field,
      total: entry.total,
      nonNull: entry.nonNull,
      nullCount: entry.nullCount,
      uniqueCount: uniqueCountValue,
      numericCount: entry.numericCount,
      min: entry.min,
      max: entry.max,
      sum: entry.numericCount > 0 ? entry.sum : null,
      avg: entry.numericCount > 0 ? entry.sum / entry.numericCount : null,
      topValues,
      frequencyTableTruncated: isTruncated,
    };
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

  const columns = Object.fromEntries(
    records.map((record) => [record.field, record]),
  );

  return {
    ...toDatasetRefOutput(manifest),
    summary: {
      rowCount: sourceRows,
      fieldCount: fields.length,
      columns,
    },
  };
};

const worker = new Worker<CsvColumnStatsJobData, CsvColumnStatsJobResult>(
  QUEUE_NAME,
  async (job) => {
    console.log(`[csv-column-stats] job ${job.id} started`);
    return computeColumnStats(job);
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
      name: "csv/column-stats.complete",
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
        name: "csv/column-stats.failed",
        data: failurePayload,
      });

      await inngest.send({
        name: "csv/column-stats.complete",
        data: failurePayload,
      });
    } catch {
      // Ignore notification failures.
    }
  }
});

const shutdown = async (signal: string) => {
  console.log(`[csv-column-stats] ${signal} received - draining worker`);
  await worker.close();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

console.log(
  `[csv-column-stats] Worker online - queue="${QUEUE_NAME}" concurrency=${HEAVY_CONCURRENCY}`,
);
