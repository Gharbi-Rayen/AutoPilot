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
const QUEUE_NAME = "csv-transform";

export type TransformOperator =
  | "eq"
  | "ne"
  | "contains"
  | "not_contains"
  | "starts_with"
  | "ends_with"
  | "is_empty"
  | "is_not_empty"
  | "regex"
  | "gt"
  | "gte"
  | "lt"
  | "lte";

export type TransformAction =
  | "replace_value" // replace the matched column's value
  | "clear_cell" // set matched column to ""
  | "delete_row" // remove the entire row
  | "set_value"; // set targetColumn to replacement (regardless of search col)

export interface TransformRule {
  column: string;
  operator: TransformOperator;
  searchValue: string;
  action: TransformAction;
  replacement?: string;
  targetColumn?: string; // used by set_value; defaults to column
}

export interface CsvTransformJobData {
  executionId: string;
  variableName: string;
  sourceRef: unknown;
  rules: TransformRule[];
  matchMode: "all" | "any"; // AND vs OR across rules
  caseSensitive: boolean;
}

export interface CsvTransformJobResult {
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
    inputRows: number;
    outputRows: number;
    deletedRows: number;
    modifiedRows: number;
  };
}

const workerConnection = new Redis(
  process.env.REDIS_URL ?? "redis://localhost:6379",
  { maxRetriesPerRequest: null },
);

// ─── Matching logic ───────────────────────────────────────────────────────────

const normalize = (val: unknown, caseSensitive: boolean): string => {
  const s = String(val ?? "");
  return caseSensitive ? s : s.toLowerCase();
};

const matchesOperator = (
  cellValue: unknown,
  operator: TransformOperator,
  searchValue: string,
  caseSensitive: boolean,
): boolean => {
  const cell = normalize(cellValue, caseSensitive);
  const search = normalize(searchValue, caseSensitive);
  const num = Number(cell);
  const searchNum = Number(search);

  switch (operator) {
    case "eq":
      return cell === search;
    case "ne":
      return cell !== search;
    case "contains":
      return cell.includes(search);
    case "not_contains":
      return !cell.includes(search);
    case "starts_with":
      return cell.startsWith(search);
    case "ends_with":
      return cell.endsWith(search);
    case "is_empty":
      return cell.trim() === "";
    case "is_not_empty":
      return cell.trim() !== "";
    case "regex": {
      try {
        const flags = caseSensitive ? "" : "i";
        return new RegExp(searchValue, flags).test(String(cellValue ?? ""));
      } catch {
        return false;
      }
    }
    case "gt":
      return (
        Number.isFinite(num) && Number.isFinite(searchNum) && num > searchNum
      );
    case "gte":
      return (
        Number.isFinite(num) && Number.isFinite(searchNum) && num >= searchNum
      );
    case "lt":
      return (
        Number.isFinite(num) && Number.isFinite(searchNum) && num < searchNum
      );
    case "lte":
      return (
        Number.isFinite(num) && Number.isFinite(searchNum) && num <= searchNum
      );
  }
};

/**
 * Apply all rules to a row. Returns null if the row should be deleted,
 * or the (possibly mutated) row otherwise.
 */
const applyRules = (
  row: Record<string, unknown>,
  rules: TransformRule[],
  matchMode: "all" | "any",
  caseSensitive: boolean,
): Record<string, unknown> | null => {
  let outputRow = { ...row };
  let modifiedByAny = false;

  for (const rule of rules) {
    const cellValue = outputRow[rule.column];
    const matches = matchesOperator(
      cellValue,
      rule.operator,
      rule.searchValue,
      caseSensitive,
    );

    if (!matches) continue;

    // At least one rule matched — relevant for matchMode="any" early-apply
    modifiedByAny = true;

    if (rule.action === "delete_row") {
      if (matchMode === "any") return null; // immediate delete on first match
      // for "all" we record a pending delete and check all rules first
      // — handled by tracking below
    } else if (rule.action === "replace_value") {
      outputRow = {
        ...outputRow,
        [rule.column]: rule.replacement ?? "",
      };
    } else if (rule.action === "clear_cell") {
      outputRow = { ...outputRow, [rule.column]: "" };
    } else if (rule.action === "set_value") {
      const target = rule.targetColumn || rule.column;
      outputRow = { ...outputRow, [target]: rule.replacement ?? "" };
    }
  }

  if (!modifiedByAny) return outputRow; // no rules matched — pass through

  // matchMode "all": only apply if ALL rules that apply to this row were matched.
  // We handle delete_row for matchMode="all" here:
  if (matchMode === "all") {
    const allMatch = rules.every((rule) =>
      matchesOperator(
        row[rule.column],
        rule.operator,
        rule.searchValue,
        caseSensitive,
      ),
    );
    if (!allMatch) {
      // Not all rules matched — re-apply only the ones that actually matched
      // (outputRow was mutated above; re-run cleanly)
      outputRow = { ...row };
      for (const rule of rules) {
        const matches = matchesOperator(
          outputRow[rule.column],
          rule.operator,
          rule.searchValue,
          caseSensitive,
        );
        if (!matches) continue;
        if (rule.action === "delete_row") {
          // in matchMode=all, delete only if all match — skip
          continue;
        } else if (rule.action === "replace_value") {
          outputRow = { ...outputRow, [rule.column]: rule.replacement ?? "" };
        } else if (rule.action === "clear_cell") {
          outputRow = { ...outputRow, [rule.column]: "" };
        } else if (rule.action === "set_value") {
          const target = rule.targetColumn || rule.column;
          outputRow = { ...outputRow, [target]: rule.replacement ?? "" };
        }
      }
      return outputRow;
    }
    // All match — check if any rule wants to delete the row
    const hasDeleteRule = rules.some((r) => r.action === "delete_row");
    if (hasDeleteRule) return null;
  }

  return outputRow;
};

// ─── Worker logic ─────────────────────────────────────────────────────────────

const transformRows = async (
  job: Job<CsvTransformJobData, CsvTransformJobResult>,
): Promise<CsvTransformJobResult> => {
  const {
    executionId,
    variableName,
    sourceRef,
    rules,
    matchMode,
    caseSensitive,
  } = job.data;

  if (rules.length === 0) {
    throw new UnrecoverableError("At least one transform rule is required");
  }

  const inlineRows = extractInlineRows(sourceRef);
  const useInlinePath =
    !isDatasetRef(sourceRef) &&
    inlineRows.length > 0 &&
    inlineRows.length <= DATASET_STORAGE.MAX_INLINE_DATASET_ROWS;

  // ── INLINE PATH ────────────────────────────────────────────────────────────
  if (useInlinePath) {
    let inputRows = 0;
    let deletedRows = 0;
    let modifiedRows = 0;
    const output: Record<string, unknown>[] = [];

    for (const row of inlineRows) {
      inputRows++;
      const result = applyRules(row, rules, matchMode, caseSensitive);
      if (result === null) {
        deletedRows++;
      } else {
        if (JSON.stringify(result) !== JSON.stringify(row)) modifiedRows++;
        output.push(result);
      }
    }

    const schema = inferDatasetSchema(output);
    const normalized = applySchemaToRows(output, schema);

    const manifest = await datasetService.persistRowsFromStream({
      executionId,
      variableName,
      rows: normalized,
      chunkSize: DATASET_STORAGE.DEFAULT_CHUNK_SIZE_ROWS,
      schema,
    });

    return {
      ...toDatasetRefOutput(manifest),
      summary: {
        inputRows,
        outputRows: output.length,
        deletedRows,
        modifiedRows,
      },
    };
  }

  // ── STREAMING PATH ─────────────────────────────────────────────────────────
  const tempManager = new TempFileManager({ executionId });

  try {
    const outPath = await tempManager.createTempFilePath("transform-out");
    const outStream = createWriteStream(outPath);

    const writeLine = async (line: string) => {
      if (!outStream.write(line)) await once(outStream, "drain");
    };

    let inputRows = 0;
    let deletedRows = 0;
    let modifiedRows = 0;
    const schemaTracker: Record<string, unknown>[] = [];

    for await (const row of streamContextRows(sourceRef)) {
      inputRows++;
      if (inputRows % 10_000 === 0) await job.updateProgress(inputRows);

      const result = applyRules(row, rules, matchMode, caseSensitive);
      if (result === null) {
        deletedRows++;
        continue;
      }

      if (JSON.stringify(result) !== JSON.stringify(row)) modifiedRows++;
      await writeLine(`${JSON.stringify(result)}\n`);
      if (schemaTracker.length < 500) schemaTracker.push(result);
    }

    outStream.end();
    await once(outStream, "close");

    const schema: DatasetSchema =
      schemaTracker.length > 0 ? inferDatasetSchema(schemaTracker) : {};

    const manifest = await datasetService.persistRowsFromStream({
      executionId,
      variableName,
      rows: createReadStream(outPath),
      chunkSize: DATASET_STORAGE.DEFAULT_CHUNK_SIZE_ROWS,
      schema,
    });

    return {
      ...toDatasetRefOutput(manifest),
      summary: {
        inputRows,
        outputRows: inputRows - deletedRows,
        deletedRows,
        modifiedRows,
      },
    };
  } finally {
    await tempManager.cleanup();
  }
};

const worker = new Worker<CsvTransformJobData, CsvTransformJobResult>(
  QUEUE_NAME,
  async (job) => {
    console.log(`[csv-transform] job ${job.id} started`);
    return transformRows(job);
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
      name: "csv/transform.complete",
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
      await inngest.send({ name: "csv/transform.failed", data: payload });
      await inngest.send({ name: "csv/transform.complete", data: payload });
    } catch {
      // ignore
    }
  }
});

const shutdown = async (signal: string) => {
  console.log(`[csv-transform] ${signal} received - draining worker`);
  await worker.close();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

console.log(
  `[csv-transform] Worker online - queue="${QUEUE_NAME}" concurrency=${HEAVY_CONCURRENCY}`,
);
