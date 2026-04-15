import { type Job, UnrecoverableError, Worker } from "bullmq";
import Redis from "ioredis";
import { DATASET_STORAGE } from "@/config/constants";
import { streamContextRows } from "@/features/executions/components/csv-shared/executor-utils";
import { datasetService } from "@/features/executions/server/datasets/dataset-service";
import { inngest } from "@/inngest/client";
import {
  DEFAULT_WORKER_SETTINGS,
  DEFAULT_WORKER_STALL_OPTIONS,
} from "@/workers/worker-settings";

const HEAVY_CONCURRENCY = 2;
const QUEUE_NAME = "csv-compare";

const KEY_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface CsvCompareJobData {
  executionId: string;
  variableName: string;
  leftSource: unknown;
  rightSource: unknown;
  leftRows: number;
  rightRows: number;
  keyField?: string;
  compareFields?: string[];
  addedDatasetId: string;
  removedDatasetId: string;
  changedDatasetId: string;
}

interface DatasetRef {
  kind: "dataset";
  datasetId: string;
  executionId: string;
  variableName: string;
  storage: string;
  manifestVersion: number;
  rowCount: number;
  chunkCount: number;
  byteSize: number;
}

export interface CsvCompareJobResult {
  isIdentical: boolean;
  summary: string;
  keyField: string | null;
  compareFields: string[];
  addedCount: number;
  removedCount: number;
  changedCount: number;
  unchangedCount: number;
  changedDiffRowCount: number;
  addedRef: DatasetRef | null;
  removedRef: DatasetRef | null;
  /** Flat diff dataset: _diff_key | _diff_field | _diff_before | _diff_after */
  changedRef: DatasetRef | null;
}

// ── helpers ───────────────────────────────────────────────────────────────────

const workerConnection = new Redis(
  process.env.REDIS_URL ?? "redis://localhost:6379",
  { maxRetriesPerRequest: null },
);

const stableStringify = (v: unknown): string => {
  try { return JSON.stringify(v); } catch { return String(v); }
};

const valuesEqual = (l: unknown, r: unknown): boolean =>
  stableStringify(l ?? null) === stableStringify(r ?? null);

async function* arrayToStream<T>(arr: T[]): AsyncGenerator<T> {
  yield* arr;
}

// ── counters shared between the diff generators and the outer scope ────────────

interface Counters {
  addedCount: number;
  removedCount: number;
  changedCount: number;
  unchangedCount: number;
  changedDiffRowCount: number;
  compareFieldSet: Set<string>;
  added: Array<Record<string, unknown>>;
  removed: Array<Record<string, unknown>>;
}

const makeCounters = (requestedFields: string[]): Counters => ({
  addedCount: 0,
  removedCount: 0,
  changedCount: 0,
  unchangedCount: 0,
  changedDiffRowCount: 0,
  compareFieldSet: new Set<string>(requestedFields),
  added: [],
  removed: [],
});

// Compute per-row field diffs and yield ONE side-by-side row per changed pair.
// Columns: _diff_key | _diff_changed | _before_<field> … | _after_<field> …
// Also updates counter.changedCount / unchangedCount / compareFieldSet.
function* yieldRowDiff(
  c: Counters,
  diffKey: string,
  leftRow: Record<string, unknown>,
  rightRow: Record<string, unknown>,
  keyedField: string | undefined,
  requestedFields: string[],
): Generator<Record<string, unknown>> {
  if (requestedFields.length === 0) {
    for (const f of Object.keys(leftRow)) {
      if (!keyedField || f !== keyedField) c.compareFieldSet.add(f);
    }
    for (const f of Object.keys(rightRow)) {
      if (!keyedField || f !== keyedField) c.compareFieldSet.add(f);
    }
  }

  const changedFields = Array.from(c.compareFieldSet).filter(
    (f) => !valuesEqual(leftRow[f], rightRow[f]),
  );

  if (changedFields.length === 0) {
    c.unchangedCount += 1;
    return;
  }

  c.changedCount += 1;
  c.changedDiffRowCount += 1;

  // Build one row: _diff_key, _diff_changed (CSV of changed field names),
  // then all left values prefixed with _before_, all right values with _after_.
  const row: Record<string, unknown> = {
    _diff_key: diffKey,
    _diff_changed: changedFields.join(","),
  };
  for (const [k, v] of Object.entries(leftRow)) {
    row[`_before_${k}`] = v;
  }
  for (const [k, v] of Object.entries(rightRow)) {
    row[`_after_${k}`] = v;
  }
  yield row;
}

// ── Sequential comparison ─────────────────────────────────────────────────────
// Yields flat diff rows (changed) as they are discovered; accumulates
// added/removed into counters.added / counters.removed (typically small).

async function* sequentialChangedStream(
  c: Counters,
  leftSource: unknown,
  rightSource: unknown,
  requestedFields: string[],
): AsyncGenerator<Record<string, unknown>> {
  const leftIt = streamContextRows(leftSource)[Symbol.asyncIterator]();
  const rightIt = streamContextRows(rightSource)[Symbol.asyncIterator]();
  let rowIndex = 0;

  while (true) {
    rowIndex += 1;
    const [L, R] = await Promise.all([leftIt.next(), rightIt.next()]);

    if (L.done && R.done) break;

    if (!L.done && R.done) {
      c.removedCount += 1;
      c.removed.push(L.value);
    } else if (L.done && !R.done) {
      c.addedCount += 1;
      c.added.push(R.value);
    } else if (!L.done && !R.done) {
      yield* yieldRowDiff(c, `Line ${rowIndex}`, L.value, R.value, undefined, requestedFields);
    }
  }
}

// ── Keyed comparison ──────────────────────────────────────────────────────────

async function* keyedChangedStream(
  c: Counters,
  leftSource: unknown,
  rightSource: unknown,
  leftRows: number,
  rightRows: number,
  keyedField: string,
  requestedFields: string[],
): AsyncGenerator<Record<string, unknown>> {
  const buildLeft = leftRows <= rightRows;
  const buildSrc = buildLeft ? leftSource : rightSource;
  const probeSrc = buildLeft ? rightSource : leftSource;

  // Build the in-memory index from the smaller side
  const index = new Map<string, Array<Record<string, unknown>>>();
  for await (const row of streamContextRows(buildSrc)) {
    const key = String(row[keyedField] ?? "");
    const entries = index.get(key);
    if (entries) entries.push(row);
    else index.set(key, [row]);
  }

  // Probe — stream diff rows as we go
  for await (const probeRow of streamContextRows(probeSrc)) {
    const key = String(probeRow[keyedField] ?? "");
    const candidates = index.get(key) ?? [];
    const matched = candidates.shift();

    if (matched) {
      const leftRow = buildLeft ? matched : probeRow;
      const rightRow = buildLeft ? probeRow : matched;
      yield* yieldRowDiff(c, key, leftRow, rightRow, keyedField, requestedFields);
      continue;
    }

    if (buildLeft) {
      c.addedCount += 1;
      c.added.push(probeRow);
    } else {
      c.removedCount += 1;
      c.removed.push(probeRow);
    }
  }

  // Remaining index entries are unmatched
  for (const rows of index.values()) {
    for (const row of rows) {
      if (buildLeft) {
        c.removedCount += 1;
        c.removed.push(row);
      } else {
        c.addedCount += 1;
        c.added.push(row);
      }
    }
  }
}

// ── main job handler ──────────────────────────────────────────────────────────

const compareRows = async (
  job: Job<CsvCompareJobData, CsvCompareJobResult>,
): Promise<CsvCompareJobResult> => {
  const {
    executionId,
    variableName,
    leftSource,
    rightSource,
    leftRows,
    rightRows,
    keyField,
    compareFields,
    addedDatasetId,
    removedDatasetId,
    changedDatasetId,
  } = job.data;

  if (keyField && !KEY_NAME_PATTERN.test(keyField)) {
    throw new UnrecoverableError(
      `keyField '${keyField}' is unsupported. Use a single field name without nesting.`,
    );
  }

  const requestedFields = Array.isArray(compareFields) ? compareFields : [];
  const c = makeCounters(requestedFields);
  const chunkSize = DATASET_STORAGE.DEFAULT_CHUNK_SIZE_ROWS;

  const addedVarName = `${variableName}__added`;
  const removedVarName = `${variableName}__removed`;
  const changedVarName = `${variableName}__changed`;

  // ── Stream changed diff rows straight to storage (no memory accumulation) ──
  const changedStream = keyField
    ? keyedChangedStream(c, leftSource, rightSource, leftRows, rightRows, keyField, requestedFields)
    : sequentialChangedStream(c, leftSource, rightSource, requestedFields);

  const changedManifest = await datasetService.persistRowsFromStream({
    executionId,
    datasetId: changedDatasetId,
    variableName: changedVarName,
    rows: changedStream,
    chunkSize,
  });

  // ── Persist added / removed from in-memory arrays (typically small) ─────────
  const [addedManifest, removedManifest] = await Promise.all([
    c.added.length > 0
      ? datasetService.persistRowsFromStream({
          executionId,
          datasetId: addedDatasetId,
          variableName: addedVarName,
          rows: arrayToStream(c.added),
          chunkSize,
        })
      : null,
    c.removed.length > 0
      ? datasetService.persistRowsFromStream({
          executionId,
          datasetId: removedDatasetId,
          variableName: removedVarName,
          rows: arrayToStream(c.removed),
          chunkSize,
        })
      : null,
  ]);

  // ── Build result ─────────────────────────────────────────────────────────────

  const toRef = (
    datasetId: string,
    varName: string,
    manifest: Awaited<ReturnType<typeof datasetService.persistRowsFromStream>> | null,
  ): DatasetRef | null => {
    if (!manifest || manifest.rowCount === 0) return null;
    return {
      kind: "dataset",
      datasetId,
      executionId,
      variableName: varName,
      storage: manifest.storage,
      manifestVersion: manifest.version,
      rowCount: manifest.rowCount,
      chunkCount: manifest.chunkCount,
      byteSize: manifest.byteSize,
    };
  };

  const isIdentical =
    c.addedCount === 0 && c.removedCount === 0 && c.changedCount === 0;

  let summary = "Datasets are completely identical.";
  if (!isIdentical) {
    const parts: string[] = [];
    if (c.addedCount > 0) parts.push(`+${c.addedCount} rows added`);
    if (c.removedCount > 0) parts.push(`-${c.removedCount} rows removed`);
    if (c.changedCount > 0) parts.push(`~${c.changedCount} rows changed`);
    summary = `Datasets differ: ${parts.join(", ")}.`;
  }

  return {
    isIdentical,
    summary,
    keyField: keyField ?? null,
    compareFields: Array.from(c.compareFieldSet),
    addedCount: c.addedCount,
    removedCount: c.removedCount,
    changedCount: c.changedCount,
    unchangedCount: c.unchangedCount,
    changedDiffRowCount: c.changedDiffRowCount,
    addedRef: toRef(addedDatasetId, addedVarName, addedManifest),
    removedRef: toRef(removedDatasetId, removedVarName, removedManifest),
    changedRef: toRef(changedDatasetId, changedVarName, changedManifest),
  };
};

// ── worker setup ──────────────────────────────────────────────────────────────

const worker = new Worker<CsvCompareJobData, CsvCompareJobResult>(
  QUEUE_NAME,
  async (job) => {
    console.log(`[csv-compare] job ${job.id} started`);
    return compareRows(job);
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
      name: "csv/compare.complete",
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
      await inngest.send({ name: "csv/compare.failed", data: failurePayload });
      await inngest.send({ name: "csv/compare.complete", data: failurePayload });
    } catch {
      // Ignore notification failures.
    }
  }
});

const shutdown = async (signal: string) => {
  console.log(`[csv-compare] ${signal} received - draining worker`);
  await worker.close();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

console.log(
  `[csv-compare] Worker online - queue="${QUEUE_NAME}" concurrency=${HEAVY_CONCURRENCY}`,
);
