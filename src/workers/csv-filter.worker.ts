import { type Job, UnrecoverableError, Worker } from "bullmq";
import Redis from "ioredis";
import { DATASET_STORAGE } from "@/config/constants";
import {
  applyCsvPredicate,
  type CsvOperator,
  extractInlineRows,
  streamContextRows,
} from "@/features/executions/components/csv-shared/executor-utils";
import { isDatasetRef } from "@/features/executions/server/datasets/dataset-ref";
import { datasetService } from "@/features/executions/server/datasets/dataset-service";
import type { DatasetSchema } from "@/features/executions/server/datasets/schema-types";
import { inngest } from "@/inngest/client";
import {
  DEFAULT_WORKER_SETTINGS,
  DEFAULT_WORKER_STALL_OPTIONS,
} from "@/workers/worker-settings";

const HEAVY_CONCURRENCY = 3;
const QUEUE_NAME = "csv-filter";
const FILTER_PROGRESS_EVENT_NAME = "csv/filter.progress";
const FILTER_WORKER_CODE_VERSION = "csv-filter@2026-04-09-v1";
const FILTER_PROGRESS_EMIT_INTERVAL_ROWS = 1_000_000;

export interface CsvFilterJobData {
  executionId: string;
  datasetId: string;
  nodeId: string;
  variableName: string;
  sourceRef: unknown;
  field: string;
  operator: CsvOperator;
  value?: string;
  sourceRows: number;
  sourceSchema?: DatasetSchema;
}

export interface CsvFilterJobResult {
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
  summary: {
    sourceRows: number;
    matchedRows: number;
    filteredOut: number;
    field: string;
    operator: CsvOperator;
    value?: string;
  };
}

const emitFilterProgress = (
  job: Job<CsvFilterJobData, CsvFilterJobResult>,
  stage: string,
  details: Record<string, unknown>,
): void => {
  inngest
    .send({
      name: FILTER_PROGRESS_EVENT_NAME,
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

const logFilterLifecycle = (
  job: Job<CsvFilterJobData, CsvFilterJobResult>,
  message: string,
  details?: Record<string, unknown>,
) => {
  if (details && Object.keys(details).length > 0) {
    console.log(
      `[csv-filter] job ${job.id} ${message} ${JSON.stringify(details)}`,
    );
    return;
  }
  console.log(`[csv-filter] job ${job.id} ${message}`);
};

const filterRows = async (
  job: Job<CsvFilterJobData, CsvFilterJobResult>,
): Promise<CsvFilterJobResult> => {
  const startedAt = Date.now();
  const {
    executionId,
    datasetId,
    variableName,
    sourceRef,
    field,
    operator,
    value,
    sourceRows,
    sourceSchema,
  } = job.data;

  if (!field || field.trim().length === 0) {
    throw new UnrecoverableError("Filter field is required");
  }

  if (!Number.isInteger(sourceRows) || sourceRows <= 0) {
    throw new UnrecoverableError("Source dataset is empty or invalid");
  }

  logFilterLifecycle(job, "received payload", {
    sourceRows,
    sourceType: isDatasetRef(sourceRef) ? "dataset-ref" : "inline",
    field,
    operator,
    hasValue: value !== undefined,
  });

  emitFilterProgress(job, "filtering", {
    sourceRows,
    rowsScanned: 0,
    rowsMatched: 0,
    elapsedMs: 0,
  });

  let rowsScanned = 0;
  let rowsMatched = 0;

  const inlineRows = extractInlineRows(sourceRef);
  const useInlinePath =
    !isDatasetRef(sourceRef) &&
    inlineRows.length > 0 &&
    inlineRows.length <= DATASET_STORAGE.MAX_INLINE_DATASET_ROWS;

  const filteredStream = (async function* () {
    if (useInlinePath) {
      for (const row of inlineRows) {
        rowsScanned += 1;
        if (applyCsvPredicate(row, field, operator, value)) {
          rowsMatched += 1;
          yield row;
        }
      }
      return;
    }

    for await (const row of streamContextRows(sourceRef)) {
      rowsScanned += 1;

      if (applyCsvPredicate(row, field, operator, value)) {
        rowsMatched += 1;
        yield row;
      }

      if (rowsScanned % FILTER_PROGRESS_EMIT_INTERVAL_ROWS === 0) {
        emitFilterProgress(job, "filtering", {
          sourceRows,
          rowsScanned,
          rowsMatched,
          elapsedMs: Date.now() - startedAt,
        });
      }

      if (rowsScanned % 500_000 === 0) {
        await job.updateProgress({
          phase: "filtering",
          sourceRows,
          rowsScanned,
          rowsMatched,
        });
      }

      if (rowsScanned % 100_000 === 0) {
        logFilterLifecycle(job, "filter progress", {
          rowsScanned,
          rowsMatched,
          sourceRows,
          elapsedMs: Date.now() - startedAt,
        });
      }
    }
  })();

  emitFilterProgress(job, "persisting", {
    sourceRows,
    rowsScanned: 0,
    rowsMatched: 0,
    elapsedMs: Date.now() - startedAt,
  });

  const manifest = await datasetService.persistRowsFromStream({
    executionId,
    datasetId,
    variableName,
    rows: filteredStream,
    chunkSize: DATASET_STORAGE.DEFAULT_CHUNK_SIZE_ROWS,
    schema: sourceSchema,
  });

  await job.updateProgress({
    phase: "done",
    sourceRows,
    rowsScanned,
    rowsMatched,
    rowsWritten: manifest.rowCount,
    completed: true,
  });

  emitFilterProgress(job, "completed", {
    sourceRows,
    rowsScanned,
    rowsMatched,
    rowsWritten: manifest.rowCount,
    elapsedMs: Date.now() - startedAt,
  });

  logFilterLifecycle(job, "completed", {
    rowsScanned,
    rowsMatched,
    filteredOut: Math.max(sourceRows - rowsMatched, 0),
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
      matchedRows: rowsMatched,
      filteredOut: Math.max(sourceRows - rowsMatched, 0),
      field,
      operator,
      value,
    },
  };
};

const workerConnection = new Redis(
  process.env.REDIS_URL ?? "redis://localhost:6379",
  {
    maxRetriesPerRequest: null,
  },
);

workerConnection.on("connect", () => {
  console.log(
    "[csv-filter] Redis connected:",
    process.env.REDIS_URL ?? "redis://localhost:6379",
  );
});

const worker = new Worker<CsvFilterJobData, CsvFilterJobResult>(
  QUEUE_NAME,
  async (job) => {
    console.log(`[csv-filter] job ${job.id} started`);
    return filterRows(job);
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
    `[csv-filter] job ${job.id} complete - ${result.summary.matchedRows.toLocaleString()} / ${result.summary.sourceRows.toLocaleString()} rows matched`,
  );

  try {
    await inngest.send({
      name: "csv/filter.complete",
      data: {
        executionId: job.data.executionId,
        datasetId: result.datasetRef.datasetId,
        nodeId: job.data.nodeId,
        variableName: job.data.variableName,
        result,
      },
    });
  } catch (error) {
    console.error("[csv-filter] failed to signal filter completion", error);
  }
});

worker.on("failed", async (job, error) => {
  const isUnrecoverable = error instanceof UnrecoverableError;

  console.error(`[csv-filter] job ${job?.id} failed:`, error.message);

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
        name: "csv/filter.failed",
        data: failurePayload,
      });

      await inngest.send({
        name: "csv/filter.complete",
        data: failurePayload,
      });
    } catch {
      // Ignore notification failures.
    }
  }
});

const shutdown = async (signal: string) => {
  console.log(`[csv-filter] ${signal} received - draining worker`);
  await worker.close();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

console.log(
  `[csv-filter] boot ${JSON.stringify({
    version: FILTER_WORKER_CODE_VERSION,
    queue: QUEUE_NAME,
    concurrency: HEAVY_CONCURRENCY,
    progressInterval: FILTER_PROGRESS_EMIT_INTERVAL_ROWS,
  })}`,
);
