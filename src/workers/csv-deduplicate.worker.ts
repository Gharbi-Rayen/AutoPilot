import { once } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import { type Job, UnrecoverableError, Worker } from "bullmq";
import Redis from "ioredis";
import { DATASET_STORAGE } from "@/config/constants";
import {
  extractInlineRows,
  streamContextRows,
  toDatasetRefOutput,
} from "@/features/executions/components/csv-shared/executor-utils";
import { isDatasetRef } from "@/features/executions/server/datasets/dataset-ref";
import { datasetService } from "@/features/executions/server/datasets/dataset-service";
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
const QUEUE_NAME = "csv-deduplicate";

export interface CsvDeduplicateJobData {
  executionId: string;
  variableName: string;
  duplicatesVariableName: string;
  sourceRef: unknown;
  sourceRows: number;
  fields: string[]; // empty array = compare all columns
  keep: "first" | "last";
  includeDuplicates: boolean;
}

export interface CsvDeduplicateJobResult {
  deduped: {
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
  };
  duplicates?: {
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
  } | null;
}

const workerConnection = new Redis(
  process.env.REDIS_URL ?? "redis://localhost:6379",
  { maxRetriesPerRequest: null },
);

/**
 * Build a dedup key from specific fields or all fields in the row.
 * Length-prefixed format prevents collisions: "5:hello|3:foo".
 * When fields is empty, derives keys dynamically from the row.
 */
const buildDedupeKey = (
  row: Record<string, unknown>,
  fields: string[],
): string => {
  const keys = fields.length > 0 ? fields : Object.keys(row).sort();
  return keys
    .map((field) => {
      const value = String(row[field] ?? "");
      return `${value.length}:${value}`;
    })
    .join("|");
};

const deduplicateRows = async (
  job: Job<CsvDeduplicateJobData, CsvDeduplicateJobResult>,
): Promise<CsvDeduplicateJobResult> => {
  const {
    executionId,
    variableName,
    duplicatesVariableName,
    sourceRef,
    fields,
    keep,
    includeDuplicates,
  } = job.data;

  const inlineRows = extractInlineRows(sourceRef);
  const useInlinePath =
    !isDatasetRef(sourceRef) &&
    inlineRows.length > 0 &&
    inlineRows.length <= DATASET_STORAGE.MAX_INLINE_DATASET_ROWS;

  // ─── INLINE (small dataset) PATH ─────────────────────────────────────────
  if (useInlinePath) {
    const seen = new Set<string>();
    const dedupedRows: Record<string, unknown>[] = [];
    const duplicateRows: Record<string, unknown>[] = [];

    const orderedRows =
      keep === "last" ? [...inlineRows].reverse() : [...inlineRows];

    for (const row of orderedRows) {
      const key = buildDedupeKey(row, fields);
      if (!seen.has(key)) {
        seen.add(key);
        dedupedRows.push(row);
      } else if (includeDuplicates) {
        duplicateRows.push(row);
      }
    }

    if (keep === "last") {
      dedupedRows.reverse();
      if (includeDuplicates) duplicateRows.reverse();
    }

    const schema = inferDatasetSchema(dedupedRows);
    const normalized = applySchemaToRows(dedupedRows, schema);

    const manifest = await datasetService.persistRowsFromStream({
      executionId,
      variableName,
      rows: normalized,
      chunkSize: DATASET_STORAGE.DEFAULT_CHUNK_SIZE_ROWS,
      schema,
    });

    let duplicatesResult: CsvDeduplicateJobResult["duplicates"] = null;

    if (includeDuplicates && duplicateRows.length > 0) {
      const dupSchema = inferDatasetSchema(duplicateRows);
      const dupNormalized = applySchemaToRows(duplicateRows, dupSchema);
      const dupManifest = await datasetService.persistRowsFromStream({
        executionId,
        variableName: duplicatesVariableName,
        rows: dupNormalized,
        chunkSize: DATASET_STORAGE.DEFAULT_CHUNK_SIZE_ROWS,
        schema: dupSchema,
      });
      duplicatesResult = toDatasetRefOutput(dupManifest);
    }

    return {
      deduped: toDatasetRefOutput(manifest),
      duplicates: duplicatesResult,
    };
  }

  // ─── STREAMING (large dataset) PATH ──────────────────────────────────────
  const tempManager = new TempFileManager({ executionId });

  try {
    const dedupedPath = await tempManager.createTempFilePath("dedupe-out");
    const dedupedStream = createWriteStream(dedupedPath);
    const dupPath = includeDuplicates
      ? await tempManager.createTempFilePath("dedupe-dup")
      : null;
    const dupStream = dupPath ? createWriteStream(dupPath) : null;

    const writeTo = async (
      stream: ReturnType<typeof createWriteStream>,
      line: string,
    ) => {
      if (!stream.write(line)) await once(stream, "drain");
    };

    let duplicatesCount = 0;
    const schemaTracker: Record<string, unknown>[] = [];
    const dupSchemaTracker: Record<string, unknown>[] = [];

    if (keep === "first") {
      // Single pass: emit first occurrence, route rest to duplicates
      const seen = new Set<string>();

      for await (const row of streamContextRows(sourceRef)) {
        const key = buildDedupeKey(row, fields);
        if (!seen.has(key)) {
          seen.add(key);
          await writeTo(dedupedStream, `${JSON.stringify(row)}\n`);

          if (schemaTracker.length < 500) schemaTracker.push(row);
        } else if (dupStream) {
          await writeTo(dupStream, `${JSON.stringify(row)}\n`);
          duplicatesCount++;
          if (dupSchemaTracker.length < 500) dupSchemaTracker.push(row);
        }
      }
    } else {
      // keep === "last"
      // Pass 1: record the last index for every key
      const lastSeenIndex = new Map<string, number>();
      let idx = 0;
      for await (const row of streamContextRows(sourceRef)) {
        lastSeenIndex.set(buildDedupeKey(row, fields), idx++);
      }

      // Pass 2: emit only the row whose index matches last-seen
      let secondIdx = 0;
      for await (const row of streamContextRows(sourceRef)) {
        const key = buildDedupeKey(row, fields);
        if (lastSeenIndex.get(key) === secondIdx) {
          await writeTo(dedupedStream, `${JSON.stringify(row)}\n`);

          if (schemaTracker.length < 500) schemaTracker.push(row);
        } else if (dupStream) {
          await writeTo(dupStream, `${JSON.stringify(row)}\n`);
          duplicatesCount++;
          if (dupSchemaTracker.length < 500) dupSchemaTracker.push(row);
        }
        secondIdx++;
      }
    }

    dedupedStream.end();
    await once(dedupedStream, "close");
    if (dupStream) {
      dupStream.end();
      await once(dupStream, "close");
    }

    const schema: DatasetSchema =
      schemaTracker.length > 0 ? inferDatasetSchema(schemaTracker) : {};

    const manifest = await datasetService.persistRowsFromStream({
      executionId,
      variableName,
      rows: createReadStream(dedupedPath),
      chunkSize: DATASET_STORAGE.DEFAULT_CHUNK_SIZE_ROWS,
      schema,
    });

    let duplicatesResult: CsvDeduplicateJobResult["duplicates"] = null;

    if (includeDuplicates && dupPath && duplicatesCount > 0) {
      const dupSchema: DatasetSchema =
        dupSchemaTracker.length > 0 ? inferDatasetSchema(dupSchemaTracker) : {};
      const dupManifest = await datasetService.persistRowsFromStream({
        executionId,
        variableName: duplicatesVariableName,
        rows: createReadStream(dupPath),
        chunkSize: DATASET_STORAGE.DEFAULT_CHUNK_SIZE_ROWS,
        schema: dupSchema,
      });
      duplicatesResult = toDatasetRefOutput(dupManifest);
    }

    return {
      deduped: toDatasetRefOutput(manifest),
      duplicates: duplicatesResult,
    };
  } finally {
    await tempManager.cleanup();
  }
};

const worker = new Worker<CsvDeduplicateJobData, CsvDeduplicateJobResult>(
  QUEUE_NAME,
  async (job) => {
    console.log(`[csv-deduplicate] job ${job.id} started`);
    return deduplicateRows(job);
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
      name: "csv/deduplicate.complete",
      data: {
        executionId: job.data.executionId,
        variableName: job.data.variableName,
        result,
      },
    });
  } catch {
    // ignore
  }
});

worker.on("failed", async (job, error) => {
  const isUnrecoverable = error instanceof UnrecoverableError;
  if (
    isUnrecoverable ||
    (job && job.attemptsMade >= (job.opts.attempts ?? 3))
  ) {
    const payload = {
      executionId: job?.data.executionId,
      variableName: job?.data.variableName,
      error: error.message,
      reason: error.message,
      status: "failed" as const,
    };
    try {
      await inngest.send({ name: "csv/deduplicate.failed", data: payload });
      await inngest.send({ name: "csv/deduplicate.complete", data: payload });
    } catch {
      // ignore
    }
  }
});

const shutdown = async (signal: string) => {
  console.log(`[csv-deduplicate] ${signal} received - draining worker`);
  await worker.close();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

console.log(
  `[csv-deduplicate] Worker online - queue="${QUEUE_NAME}" concurrency=${HEAVY_CONCURRENCY}`,
);
