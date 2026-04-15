import { type Job, UnrecoverableError, Worker } from "bullmq";
import Redis from "ioredis";
import { DATASET_STORAGE } from "@/config/constants";
import {
  extractInlineRows,
  streamContextRows,
} from "@/features/executions/components/csv-shared/executor-utils";
import {
  createKeyComparator,
  createKeyExtractor,
  createRowComparator,
  type SortDirection,
  type SortNulls,
} from "@/features/executions/server/datasets/comparator";
import { isDatasetRef } from "@/features/executions/server/datasets/dataset-ref";
import { datasetService } from "@/features/executions/server/datasets/dataset-service";
import { externalSortRows } from "@/features/executions/server/datasets/external-sort";
import {
  applySchemaToRows,
  inferDatasetSchema,
} from "@/features/executions/server/datasets/schema-inference";
import type { DatasetSchema } from "@/features/executions/server/datasets/schema-types";
import { TempFileManager } from "@/features/executions/server/datasets/temp-file-manager";
import { inngest } from "@/inngest/client";
import {
  DEFAULT_WORKER_SETTINGS,
  DEFAULT_WORKER_STALL_OPTIONS,
} from "@/workers/worker-settings";

const HEAVY_CONCURRENCY = 2;
const QUEUE_NAME = "csv-sort";
const SORT_PROGRESS_EVENT_NAME = "csv/sort.progress";
const SORT_WORKER_CODE_VERSION = "csv-sort@2026-04-08-fastpath-v2";
const DATASET_REF_IN_MEMORY_ROW_THRESHOLD = 5_000_000;
const SINGLE_NUMERIC_COLUMN_IN_MEMORY_ROW_THRESHOLD = 5_000_000;
const SORT_PROGRESS_EMIT_INTERVAL_ROWS = 1_000_000;

type SortCompareAs = "string" | "number" | "date";

type CsvSortSummary = {
  sourceRows: number;
  strategy: "in-memory" | "external";
  sortField: string;
  direction: SortDirection;
  compareAs: SortCompareAs;
  nulls: SortNulls;
  runCount?: number;
  mergeFanIn?: number;
};

export interface CsvSortJobData {
  executionId: string;
  datasetId: string;
  nodeId: string;
  variableName: string;
  sourceRef: unknown;
  sortField: string;
  direction: SortDirection;
  compareAs: SortCompareAs;
  nulls: SortNulls;
  sourceRows: number;
  sourceSchema?: DatasetSchema;
}

export interface CsvSortJobResult {
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
  summary: CsvSortSummary;
}

const isSingleNumericColumnSchema = (schema: DatasetSchema | undefined) => {
  if (!schema) {
    return false;
  }

  const fields = Object.values(schema);
  return fields.length === 1 && fields[0]?.type === "number";
};

const emitSortStageProgress = (
  job: Job<CsvSortJobData, CsvSortJobResult>,
  stage: string,
  details: Record<string, unknown>,
): void => {
  // Fire-and-forget — never await progress events inside hot paths.
  // Awaiting was blocking the stream generator for every HTTP roundtrip.
  inngest
    .send({
      name: SORT_PROGRESS_EVENT_NAME,
      data: {
        executionId: job.data.executionId,
        datasetId: job.data.datasetId,
        nodeId: job.data.nodeId,
        variableName: job.data.variableName,
        stage,
        ...details,
      },
    })
    .catch(() => {
      // Best effort only.
    });
};

const logSortLifecycle = (
  job: Job<CsvSortJobData, CsvSortJobResult>,
  message: string,
  details?: Record<string, unknown>,
  lineHint?: string,
) => {
  const messageWithLineHint = lineHint
    ? `${message} (lineHint=${lineHint})`
    : message;

  if (details && Object.keys(details).length > 0) {
    console.log(
      `[csv-sort] job ${job.id} ${messageWithLineHint} ${JSON.stringify(details)}`,
    );
    return;
  }

  console.log(`[csv-sort] job ${job.id} ${messageWithLineHint}`);
};

const workerConnection = new Redis(
  process.env.REDIS_URL ?? "redis://localhost:6379",
  {
    maxRetriesPerRequest: null,
  },
);

workerConnection.on("connect", () => {
  console.log(
    "[csv-sort] Redis connected:",
    process.env.REDIS_URL ?? "redis://localhost:6379",
  );
});

const sortRows = async (
  job: Job<CsvSortJobData, CsvSortJobResult>,
): Promise<CsvSortJobResult> => {
  const startedAt = Date.now();
  const {
    executionId,
    datasetId,
    variableName,
    sourceRef,
    sortField,
    direction,
    compareAs,
    nulls,
    sourceRows,
    sourceSchema,
  } = job.data;

  if (!sortField || sortField.trim().length === 0) {
    throw new UnrecoverableError("Sort field is required");
  }

  if (!Number.isInteger(sourceRows) || sourceRows <= 0) {
    throw new UnrecoverableError("Source dataset is empty or invalid");
  }

  const compareRows = createRowComparator({
    field: sortField,
    direction,
    compareAs,
    nulls,
    schema: sourceSchema,
  });

  // Precomputed key helpers — used for both in-memory and external sort.
  // Key is computed once per row; comparisons then work on the scalar key
  // value instead of re-running type coercion on every comparison call.
  const extractKey = createKeyExtractor({
    field: sortField,
    direction,
    compareAs,
    nulls,
    schema: sourceSchema,
  });
  const compareKeys = createKeyComparator(direction, nulls);

  const inlineRows = extractInlineRows(sourceRef);
  const datasetRefFastPathThreshold = isSingleNumericColumnSchema(sourceSchema)
    ? SINGLE_NUMERIC_COLUMN_IN_MEMORY_ROW_THRESHOLD
    : DATASET_REF_IN_MEMORY_ROW_THRESHOLD;

  logSortLifecycle(job, "received payload", {
    sourceRows,
    sourceType: isDatasetRef(sourceRef) ? "dataset-ref" : "inline",
    sortField,
    direction,
    compareAs,
    nulls,
  });

  const useFastPath =
    (isDatasetRef(sourceRef) && sourceRows <= datasetRefFastPathThreshold) ||
    (!isDatasetRef(sourceRef) &&
      inlineRows.length > 0 &&
      inlineRows.length <= DATASET_STORAGE.MAX_INLINE_DATASET_ROWS);

  logSortLifecycle(job, "selected strategy", {
    strategy: useFastPath ? "in-memory" : "external",
    sourceRows,
  });

  if (useFastPath) {
    let rowsForSort = inlineRows;

    emitSortStageProgress(job, "scanning", {
      strategy: "in-memory",
      sourceRows,
      rowsScanned: 0,
      rowsWritten: 0,
      elapsedMs: Date.now() - startedAt,
    });

    if (isDatasetRef(sourceRef)) {
      logSortLifecycle(job, "loading rows for in-memory sort", {
        sourceRows,
      });

      rowsForSort = [];
      for await (const row of streamContextRows(sourceRef)) {
        rowsForSort.push(row);

        if (rowsForSort.length % SORT_PROGRESS_EMIT_INTERVAL_ROWS === 0) {
          emitSortStageProgress(job, "scanning", {
            strategy: "in-memory",
            sourceRows,
            rowsScanned: rowsForSort.length,
            rowsWritten: 0,
            elapsedMs: Date.now() - startedAt,
          });
        }

        if (rowsForSort.length % 500_000 === 0) {
          await job.updateProgress({
            phase: "loading",
            strategy: "in-memory",
            sourceRows,
            rowsScanned: rowsForSort.length,
            rowsWritten: 0,
          });
        }

        if (rowsForSort.length % 100_000 === 0) {
          logSortLifecycle(
            job,
            "in-memory load progress",
            {
              rowsScanned: rowsForSort.length,
              sourceRows,
            },
            "csv-sort.worker.ts:208",
          );
        }
      }
    }

    emitSortStageProgress(job, "sorting", {
      strategy: "in-memory",
      rowsScanned: rowsForSort.length,
      rowsWritten: 0,
      elapsedMs: Date.now() - startedAt,
    });

    logSortLifecycle(job, "starting in-memory sort", {
      rowsToSort: rowsForSort.length,
    });

    await job.updateProgress({
      phase: "sorting",
      strategy: "in-memory",
      sourceRows,
      rowsWritten: 0,
    });

    // Precompute one sort key per row — eliminates repeated type coercion
    // inside comparisons (O(N log N) calls → O(N) key extractions).
    const sortKeys = rowsForSort.map((r) =>
      extractKey(r as Record<string, unknown>),
    );

    const comparatorLogInterval = 1_000_000;
    let compareCount = 0;
    let nextComparatorLogAt = comparatorLogInterval;

    const indices = Array.from({ length: rowsForSort.length }, (_, i) => i);
    indices.sort((a, b) => {
      compareCount += 1;

      if (compareCount >= nextComparatorLogAt) {
        logSortLifecycle(
          job,
          "in-memory comparator heartbeat",
          {
            compareCount,
            rowsToSort: rowsForSort.length,
            elapsedMs: Date.now() - startedAt,
          },
          "csv-sort.worker.ts:243",
        );
        nextComparatorLogAt += comparatorLogInterval;
      }

      return compareKeys(
        sortKeys[a] as number | string | null,
        sortKeys[b] as number | string | null,
        a,
        b,
      );
    });

    logSortLifecycle(
      job,
      "in-memory comparator finished",
      {
        compareCount,
        rowsToSort: rowsForSort.length,
        elapsedMs: Date.now() - startedAt,
      },
      "csv-sort.worker.ts:243",
    );

    const sorted = indices.map(
      (i) => rowsForSort[i] as Record<string, unknown>,
    );

    emitSortStageProgress(job, "persisting", {
      strategy: "in-memory",
      sourceRows,
      rowsScanned: rowsForSort.length,
      rowsWritten: 0,
      elapsedMs: Date.now() - startedAt,
    });

    logSortLifecycle(job, "in-memory sort completed", {
      rowsSorted: sorted.length,
      elapsedMs: Date.now() - startedAt,
    });

    const schema = sourceSchema ?? inferDatasetSchema(sorted);
    const typedRows = applySchemaToRows(sorted, schema);

    const manifest = await datasetService.persistRowsFromStream({
      executionId,
      datasetId,
      variableName,
      rows: typedRows,
      chunkSize: DATASET_STORAGE.DEFAULT_CHUNK_SIZE_ROWS,
      schema,
    });

    await job.updateProgress({
      phase: "done",
      strategy: "in-memory",
      sourceRows,
      rowsWritten: manifest.rowCount,
      completed: true,
    });

    emitSortStageProgress(job, "completed", {
      strategy: "in-memory",
      sourceRows,
      rowsScanned: rowsForSort.length,
      rowsWritten: manifest.rowCount,
      elapsedMs: Date.now() - startedAt,
    });

    logSortLifecycle(job, "in-memory output persisted", {
      rowsWritten: manifest.rowCount,
      elapsedMs: Date.now() - startedAt,
    });

    return {
      datasetRef: {
        kind: "dataset",
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
      summary: {
        sourceRows,
        strategy: "in-memory",
        sortField,
        direction,
        compareAs,
        nulls,
      },
    };
  }

  let rowsScanned = 0;
  emitSortStageProgress(job, "scanning", {
    strategy: "external",
    sourceRows,
    rowsScanned: 0,
    rowsWritten: 0,
    elapsedMs: Date.now() - startedAt,
  });

  logSortLifecycle(job, "starting external sort", {
    sourceRows,
    runTargetBytes: DATASET_STORAGE.EXTERNAL_SORT_RUN_TARGET_BYTES,
    mergeFanIn: DATASET_STORAGE.EXTERNAL_SORT_MAX_FAN_IN,
  });

  const sourceWithProgress = (async function* () {
    for await (const row of streamContextRows(sourceRef)) {
      rowsScanned += 1;

      if (rowsScanned % SORT_PROGRESS_EMIT_INTERVAL_ROWS === 0) {
        emitSortStageProgress(job, "scanning", {
          strategy: "external",
          sourceRows,
          rowsScanned,
          rowsWritten: 0,
          elapsedMs: Date.now() - startedAt,
        });
      }

      if (rowsScanned % 500_000 === 0) {
        await job.updateProgress({
          phase: "sorting",
          strategy: "external",
          sourceRows,
          rowsScanned,
          rowsWritten: 0,
        });
      }

      if (rowsScanned % 100_000 === 0) {
        logSortLifecycle(
          job,
          "external scan progress",
          {
            rowsScanned,
            sourceRows,
          },
          "csv-sort.worker.ts:350",
        );
      }

      yield row;
    }
  })();

  const tempManager = new TempFileManager({
    scope: `csv-sort-${executionId}-${job.id ?? "job"}`,
    executionId,
  });

  emitSortStageProgress(job, "building_runs", {
    strategy: "external",
    sourceRows,
    rowsScanned,
    rowsWritten: 0,
    elapsedMs: Date.now() - startedAt,
  });

  const externalSort = await externalSortRows({
    source: sourceWithProgress,
    compareRows,
    extractKey: extractKey as (row: unknown) => number | string | null,
    compareKeys,
    tempManager,
    runTargetBytes: DATASET_STORAGE.EXTERNAL_SORT_RUN_TARGET_BYTES,
    mergeFanIn: DATASET_STORAGE.EXTERNAL_SORT_MAX_FAN_IN,
  });

  const estimatedMergePasses =
    externalSort.runCount <= 1
      ? 0
      : Math.ceil(
          Math.log(externalSort.runCount) /
            Math.log(Math.max(DATASET_STORAGE.EXTERNAL_SORT_MAX_FAN_IN, 2)),
        );

  emitSortStageProgress(job, "merging", {
    strategy: "external",
    sourceRows,
    rowsScanned,
    runCount: externalSort.runCount,
    mergePass: estimatedMergePasses > 0 ? 1 : 0,
    mergeFanIn: DATASET_STORAGE.EXTERNAL_SORT_MAX_FAN_IN,
    rowsWritten: 0,
    elapsedMs: Date.now() - startedAt,
  });

  logSortLifecycle(job, "external run generation completed", {
    rowsScanned,
    runCount: externalSort.runCount,
    elapsedMs: Date.now() - startedAt,
  });

  let rowsWritten = 0;
  emitSortStageProgress(job, "persisting", {
    strategy: "external",
    sourceRows,
    rowsScanned,
    rowsWritten: 0,
    runCount: externalSort.runCount,
    mergePass: estimatedMergePasses,
    mergeFanIn: DATASET_STORAGE.EXTERNAL_SORT_MAX_FAN_IN,
    elapsedMs: Date.now() - startedAt,
  });

  const sortedWithProgress = (async function* () {
    for await (const row of externalSort.rows) {
      rowsWritten += 1;

      if (rowsWritten % SORT_PROGRESS_EMIT_INTERVAL_ROWS === 0) {
        emitSortStageProgress(job, "persisting", {
          strategy: "external",
          sourceRows,
          rowsScanned,
          rowsWritten,
          runCount: externalSort.runCount,
          mergePass: estimatedMergePasses,
          mergeFanIn: DATASET_STORAGE.EXTERNAL_SORT_MAX_FAN_IN,
          elapsedMs: Date.now() - startedAt,
        });
      }

      if (rowsWritten % 500_000 === 0) {
        await job.updateProgress({
          phase: "writing",
          strategy: "external",
          sourceRows,
          rowsScanned,
          rowsWritten,
          runCount: externalSort.runCount,
        });
      }

      if (rowsWritten % 100_000 === 0) {
        logSortLifecycle(
          job,
          "external write progress",
          {
            rowsWritten,
            rowsScanned,
            runCount: externalSort.runCount,
          },
          "csv-sort.worker.ts:402",
        );
      }

      yield row;
    }
  })();

  const manifest = await datasetService.persistRowsFromStream({
    executionId,
    datasetId,
    variableName,
    rows: sortedWithProgress,
    chunkSize: DATASET_STORAGE.DEFAULT_CHUNK_SIZE_ROWS,
    schema: sourceSchema,
  });

  await job.updateProgress({
    phase: "done",
    strategy: "external",
    sourceRows,
    rowsScanned,
    rowsWritten: manifest.rowCount,
    runCount: externalSort.runCount,
    completed: true,
  });

  emitSortStageProgress(job, "completed", {
    strategy: "external",
    sourceRows,
    rowsScanned,
    rowsWritten: manifest.rowCount,
    runCount: externalSort.runCount,
    mergePass: estimatedMergePasses,
    mergeFanIn: DATASET_STORAGE.EXTERNAL_SORT_MAX_FAN_IN,
    elapsedMs: Date.now() - startedAt,
  });

  logSortLifecycle(job, "external output persisted", {
    rowsWritten: manifest.rowCount,
    rowsScanned,
    runCount: externalSort.runCount,
    elapsedMs: Date.now() - startedAt,
  });

  return {
    datasetRef: {
      kind: "dataset",
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
    summary: {
      sourceRows,
      strategy: "external",
      sortField,
      direction,
      compareAs,
      nulls,
      runCount: externalSort.runCount,
      mergeFanIn: DATASET_STORAGE.EXTERNAL_SORT_MAX_FAN_IN,
    },
  };
};

const worker = new Worker<CsvSortJobData, CsvSortJobResult>(
  QUEUE_NAME,
  async (job) => {
    console.log(`[csv-sort] job ${job.id} started`);
    return sortRows(job);
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
    `[csv-sort] job ${job.id} complete - ${result.datasetRef.rowCount.toLocaleString()} rows (strategy=${result.summary.strategy})`,
  );

  try {
    await inngest.send({
      name: "csv/sort.complete",
      data: {
        executionId: job.data.executionId,
        datasetId: result.datasetRef.datasetId,
        nodeId: job.data.nodeId,
        variableName: job.data.variableName,
        result,
      },
    });
  } catch (error) {
    console.error("Failed to signal csv sort completion", error);
  }
});

worker.on("failed", async (job, error) => {
  const isUnrecoverable = error instanceof UnrecoverableError;

  console.error(`[csv-sort] job ${job?.id} failed:`, error.message);

  if (
    isUnrecoverable ||
    (job && job.attemptsMade >= (job.opts.attempts ?? 3))
  ) {
    const failurePayload = {
      executionId: job?.data.executionId,
      datasetId: job?.data.datasetId,
      nodeId: job?.data.nodeId,
      variableName: job?.data.variableName,
      error: error.message,
      reason: error.message,
      status: "failed" as const,
    };

    try {
      await inngest.send({
        name: "csv/sort.failed",
        data: failurePayload,
      });

      await inngest.send({
        name: "csv/sort.complete",
        data: failurePayload,
      });
    } catch {
      // Ignore notification failures.
    }
  }
});

const shutdown = async (signal: string) => {
  console.log(`[csv-sort] ${signal} received - draining worker`);
  await worker.close();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

console.log(
  `[csv-sort] boot ${JSON.stringify({
    version: SORT_WORKER_CODE_VERSION,
    queue: QUEUE_NAME,
    concurrency: HEAVY_CONCURRENCY,
    datasetRefFastPathEnabled: true,
    datasetRefThreshold: DATASET_REF_IN_MEMORY_ROW_THRESHOLD,
    inlineThreshold: DATASET_STORAGE.MAX_INLINE_DATASET_ROWS,
    externalRunTargetBytes: DATASET_STORAGE.EXTERNAL_SORT_RUN_TARGET_BYTES,
  })}`,
);
