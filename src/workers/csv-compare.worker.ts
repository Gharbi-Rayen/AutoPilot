import { type Job, UnrecoverableError, Worker } from "bullmq";
import Redis from "ioredis";
import { DATASET_STORAGE } from "@/config/constants";
import { streamContextRows } from "@/features/executions/components/csv-shared/executor-utils";
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
}

export interface CsvCompareJobResult {
  isIdentical: boolean;
  summary: string;
  keyField: string | null;
  compareFields: string[];
  added: Array<Record<string, unknown>>;
  removed: Array<Record<string, unknown>>;
  changed: Array<{
    key: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    differences: Array<{ field: string; before: unknown; after: unknown }>;
  }>;
  addedCount: number;
  removedCount: number;
  changedCount: number;
  unchangedCount: number;
  samplesTruncated: {
    added: boolean;
    removed: boolean;
    changed: boolean;
  };
}

const workerConnection = new Redis(
  process.env.REDIS_URL ?? "redis://localhost:6379",
  {
    maxRetriesPerRequest: null,
  },
);

const stableStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const valuesEqual = (left: unknown, right: unknown): boolean => {
  return stableStringify(left ?? null) === stableStringify(right ?? null);
};

const pushBounded = <T>(target: T[], value: T, limit: number): boolean => {
  if (target.length >= limit) {
    return false;
  }

  target.push(value);
  return true;
};

const compareRows = async (
  job: Job<CsvCompareJobData, CsvCompareJobResult>,
): Promise<CsvCompareJobResult> => {
  const {
    leftSource,
    rightSource,
    leftRows,
    rightRows,
    keyField,
    compareFields,
  } = job.data;

  if (keyField && !KEY_NAME_PATTERN.test(keyField)) {
    throw new UnrecoverableError(
      `keyField '${keyField}' is unsupported. Use a single field name without nesting.`,
    );
  }

  const requestedFields = Array.isArray(compareFields) ? compareFields : [];

  const sampleLimit = DATASET_STORAGE.COMPARE_MAX_DIFF_SAMPLES;
  const added: Array<Record<string, unknown>> = [];
  const removed: Array<Record<string, unknown>> = [];
  const changed: Array<{
    key: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
    differences: Array<{ field: string; before: unknown; after: unknown }>;
  }> = [];

  let addedTruncated = false;
  let removedTruncated = false;
  let changedTruncated = false;

  let addedCount = 0;
  let removedCount = 0;
  let changedCount = 0;
  let unchangedCount = 0;

  const compareFieldSet = new Set<string>(requestedFields);
  const buildLeft = leftRows <= rightRows;

  if (keyField) {
    const keyedField = keyField;
    const buildSource = buildLeft ? leftSource : rightSource;
    const probeSource = buildLeft ? rightSource : leftSource;

    const index = new Map<string, Array<Record<string, unknown>>>();

    for await (const row of streamContextRows(buildSource)) {
      const key = String(row[keyedField] ?? "");
      const entries = index.get(key);
      if (entries) {
        entries.push(row);
      } else {
        index.set(key, [row]);
      }
    }

    for await (const probeRow of streamContextRows(probeSource)) {
      const key = String(probeRow[keyedField] ?? "");
      const candidates = index.get(key) ?? [];
      const matched = candidates.shift();

      if (matched) {
        const leftRow = buildLeft ? matched : probeRow;
        const rightRow = buildLeft ? probeRow : matched;

        if (requestedFields.length === 0) {
          for (const field of Object.keys(leftRow)) {
            if (field !== keyedField) {
              compareFieldSet.add(field);
            }
          }
          for (const field of Object.keys(rightRow)) {
            if (field !== keyedField) {
              compareFieldSet.add(field);
            }
          }
        }

        const activeCompareFields = Array.from(compareFieldSet);
        const differences = activeCompareFields
          .map((field) => ({
            field,
            before: leftRow[field],
            after: rightRow[field],
          }))
          .filter((entry) => !valuesEqual(entry.before, entry.after));

        if (differences.length === 0) {
          unchangedCount += 1;
        } else {
          changedCount += 1;
          if (
            !pushBounded(
              changed,
              { key, before: leftRow, after: rightRow, differences },
              sampleLimit,
            )
          ) {
            changedTruncated = true;
          }
        }

        continue;
      }

      if (buildLeft) {
        addedCount += 1;
        if (!pushBounded(added, probeRow, sampleLimit)) {
          addedTruncated = true;
        }
      } else {
        removedCount += 1;
        if (!pushBounded(removed, probeRow, sampleLimit)) {
          removedTruncated = true;
        }
      }
    }

    for (const rows of index.values()) {
      for (const row of rows) {
        if (buildLeft) {
          removedCount += 1;
          if (!pushBounded(removed, row, sampleLimit)) {
            removedTruncated = true;
          }
        } else {
          addedCount += 1;
          if (!pushBounded(added, row, sampleLimit)) {
            addedTruncated = true;
          }
        }
      }
    }
  } else {
    const leftIterator = streamContextRows(leftSource)[Symbol.asyncIterator]();
    const rightIterator =
      streamContextRows(rightSource)[Symbol.asyncIterator]();
    let rowIndex = 0;

    while (true) {
      rowIndex += 1;
      const leftResult = await leftIterator.next();
      const rightResult = await rightIterator.next();

      if (leftResult.done && rightResult.done) {
        break;
      }

      if (!leftResult.done && rightResult.done) {
        removedCount += 1;
        if (!pushBounded(removed, leftResult.value, sampleLimit)) {
          removedTruncated = true;
        }
      } else if (leftResult.done && !rightResult.done) {
        addedCount += 1;
        if (!pushBounded(added, rightResult.value, sampleLimit)) {
          addedTruncated = true;
        }
      } else if (!leftResult.done && !rightResult.done) {
        const leftRow = leftResult.value;
        const rightRow = rightResult.value;

        if (requestedFields.length === 0) {
          for (const field of Object.keys(leftRow)) {
            compareFieldSet.add(field);
          }
          for (const field of Object.keys(rightRow)) {
            compareFieldSet.add(field);
          }
        }

        const activeCompareFields = Array.from(compareFieldSet);
        const differences = activeCompareFields
          .map((field) => ({
            field,
            before: leftRow[field],
            after: rightRow[field],
          }))
          .filter((entry) => !valuesEqual(entry.before, entry.after));

        if (differences.length === 0) {
          unchangedCount += 1;
        } else {
          changedCount += 1;
          if (
            !pushBounded(
              changed,
              {
                key: `Line ${rowIndex}`,
                before: leftRow,
                after: rightRow,
                differences,
              },
              sampleLimit,
            )
          ) {
            changedTruncated = true;
          }
        }
      }
    }
  }

  const isIdentical =
    addedCount === 0 && removedCount === 0 && changedCount === 0;

  let summary = "Datasets are completely identical.";
  if (!isIdentical) {
    const changes = [];
    if (addedCount > 0) changes.push(`+${addedCount} lines added`);
    if (removedCount > 0) changes.push(`-${removedCount} lines removed`);
    if (changedCount > 0) changes.push(`~${changedCount} lines changed`);
    summary = `Datasets differ: ${changes.join(", ")}. Check the 'compareFields' array for columns that had values updated.`;
  }

  return {
    isIdentical,
    summary,
    keyField: keyField ?? null,
    compareFields: Array.from(compareFieldSet),
    added,
    removed,
    changed,
    addedCount,
    removedCount,
    changedCount,
    unchangedCount,
    samplesTruncated: {
      added: addedTruncated,
      removed: removedTruncated,
      changed: changedTruncated,
    },
  };
};

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
      await inngest.send({
        name: "csv/compare.failed",
        data: failurePayload,
      });

      await inngest.send({
        name: "csv/compare.complete",
        data: failurePayload,
      });
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
