import { type Job, UnrecoverableError, Worker } from "bullmq";
import Redis from "ioredis";
import { DATASET_STORAGE } from "@/config/constants";
import {
  extractInlineRows,
  streamContextRows,
} from "@/features/executions/components/csv-shared/executor-utils";
import {
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

const HEAVY_CONCURRENCY = 2;
const QUEUE_NAME = "csv-sort";
const SORT_PROGRESS_EVENT_NAME = "csv/sort.progress";
const SORT_WORKER_CODE_VERSION = "csv-sort@2026-04-08-fastpath-v2";
const DATASET_REF_IN_MEMORY_ROW_THRESHOLD = 5_000_000;
const SINGLE_NUMERIC_COLUMN_IN_MEMORY_ROW_THRESHOLD = 5_000_000;

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

const emitSortStageProgress = async (
  job: Job<CsvSortJobData, CsvSortJobResult>,
  stage: string,
  details: Record<string, unknown>,
) => {
  try {
    await inngest.send({
      name: SORT_PROGRESS_EVENT_NAME,
      data: {
        executionId: job.data.executionId,
        datasetId: job.data.datasetId,
        variableName: job.data.variableName,
        stage,
        ...details,
      },
    });
  } catch {
    // Best effort only.
  }
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

  const inlineRows = extractInlineRows(sourceRef);
  const datasetRefFastPathThreshold = isSingleNumericColumnSchema(sourceSchema)
    ? SINGLE_NUMERIC_COLUMN_IN_MEMORY_ROW_THRESHOLD
    : DATASET_REF_IN_MEMORY_ROW_THRESHOLD;

  const useFastPath =
    (isDatasetRef(sourceRef) && sourceRows <= datasetRefFastPathThreshold) ||
    (!isDatasetRef(sourceRef) &&
      inlineRows.length > 0 &&
      inlineRows.length <= DATASET_STORAGE.MAX_INLINE_DATASET_ROWS);

  if (useFastPath) {
    let rowsForSort = inlineRows;

    if (isDatasetRef(sourceRef)) {
      rowsForSort = [];
      for await (const row of streamContextRows(sourceRef)) {
        rowsForSort.push(row);
        if (rowsForSort.length % 10_000 === 0) {
          await job.updateProgress({
            phase: "loading",
            strategy: "in-memory",
            sourceRows,
            rowsScanned: rowsForSort.length,
            rowsWritten: 0,
          });
        }
      }
    }

    await emitSortStageProgress(job, "load_done", {
      strategy: "in-memory",
      rowsScanned: rowsForSort.length,
      elapsedMs: Date.now() - startedAt,
    });

    await job.updateProgress({
      phase: "sorting",
      strategy: "in-memory",
      sourceRows,
      rowsWritten: 0,
    });

    const sorted = rowsForSort
      .map((row, index) => ({ row, index }))
      .sort((left, right) => {
        const rowComparison = compareRows(left.row, right.row);
        if (rowComparison !== 0) {
          return rowComparison;
        }

        return left.index - right.index;
      })
      .map((entry) => entry.row);

    await emitSortStageProgress(job, "sort_done", {
      strategy: "in-memory",
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

    await emitSortStageProgress(job, "persist_done", {
      strategy: "in-memory",
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
  const sourceWithProgress = (async function* () {
    for await (const row of streamContextRows(sourceRef)) {
      rowsScanned += 1;
      if (rowsScanned % 10_000 === 0) {
        await job.updateProgress({
          phase: "sorting",
          strategy: "external",
          sourceRows,
          rowsScanned,
          rowsWritten: 0,
        });
      }
      yield row;
    }
  })();

  const tempManager = new TempFileManager({
    scope: `csv-sort-${executionId}-${job.id ?? "job"}`,
    executionId,
  });

  const externalSort = await externalSortRows({
    source: sourceWithProgress,
    compareRows,
    tempManager,
    runTargetBytes: DATASET_STORAGE.EXTERNAL_SORT_RUN_TARGET_BYTES,
    mergeFanIn: DATASET_STORAGE.EXTERNAL_SORT_MAX_FAN_IN,
  });

  await emitSortStageProgress(job, "run_done", {
    strategy: "external",
    rowsScanned,
    runCount: externalSort.runCount,
    elapsedMs: Date.now() - startedAt,
  });

  let rowsWritten = 0;
  const sortedWithProgress = (async function* () {
    for await (const row of externalSort.rows) {
      rowsWritten += 1;
      if (rowsWritten % 10_000 === 0) {
        await job.updateProgress({
          phase: "writing",
          strategy: "external",
          sourceRows,
          rowsScanned,
          rowsWritten,
          runCount: externalSort.runCount,
        });
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

  await emitSortStageProgress(job, "persist_done", {
    strategy: "external",
    rowsScanned,
    rowsWritten: manifest.rowCount,
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
    settings: {
      backoffStrategy: (attemptsMade) =>
        Math.min(1000 * 2 ** attemptsMade, 30_000),
    },
  },
);

worker.on("completed", async (job, result) => {
  console.log(
    `[csv-sort] job ${job.id} complete - ${result.datasetRef.rowCount.toLocaleString()} rows`,
  );

  try {
    await inngest.send({
      name: "csv/sort.complete",
      data: {
        executionId: job.data.executionId,
        datasetId: result.datasetRef.datasetId,
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
