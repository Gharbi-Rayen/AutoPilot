import { type Job, UnrecoverableError, Worker } from "bullmq";
import Redis from "ioredis";
import {
  parseNumber,
  streamContextRows,
} from "@/features/executions/components/csv-shared/executor-utils";
import { inngest } from "@/inngest/client";

const HEAVY_CONCURRENCY = 2;
const QUEUE_NAME = "csv-consecutive-sequence";

const DEFAULT_GROUP_KEY = "__all__";

type DateStepUnit = "millisecond" | "second" | "minute" | "hour" | "day";

type ComparisonConfig =
  | {
      kind?: "integer-step";
      step?: number;
    }
  | {
      kind: "number-step";
      step?: number;
      tolerance?: number;
    }
  | {
      kind: "date-step";
      step?: number;
      unit?: DateStepUnit;
    }
  | {
      kind: "alphabetic-step";
      step?: number;
      caseInsensitive?: boolean;
    }
  | {
      kind: "custom-expression";
      expression: string;
    };

export interface CsvConsecutiveSequenceJobData {
  executionId: string;
  variableName: string;
  sourceRef: unknown;
  minimumSequenceLength: number;
  analysisColumn?: string;
  groupByColumns?: string[];
  comparison?: ComparisonConfig;
}

export interface CsvConsecutiveSequenceRecord {
  groupKey: string | null;
  groupValues: Record<string, string | number>;
  startPoint: string | number;
  endPoint: string | number;
  length: number;
}

export interface CsvConsecutiveSequenceJobResult {
  sequenceCount: number;
  sequenceLengths: Array<number>;
  startPoints: Array<string | number>;
  endPoints: Array<string | number>;
  processedRows: number;
  malformedRows: number;
  groupedBy: string[];
  analysisColumn: string | null;
  comparisonKind: NonNullable<ComparisonConfig["kind"]>;
  sequences: CsvConsecutiveSequenceRecord[];
}

const workerConnection = new Redis(
  process.env.REDIS_URL ?? "redis://localhost:6379",
  {
    maxRetriesPerRequest: null,
  },
);

workerConnection.on("connect", () => {
  console.log(
    "[csv-consecutive-sequence] Redis connected:",
    process.env.REDIS_URL ?? "redis://localhost:6379",
  );
});

const toInteger = (value: unknown): number | null => {
  const numeric = parseNumber(value);
  if (numeric === null || !Number.isInteger(numeric)) {
    return null;
  }

  return numeric;
};

const toFiniteNumber = (value: unknown): number | null => {
  const numeric = parseNumber(value);
  if (numeric === null || !Number.isFinite(numeric)) {
    return null;
  }

  return numeric;
};

const toDateTimestamp = (value: unknown): number | null => {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isNaN(timestamp) ? null : timestamp;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? null : timestamp;
  }

  return null;
};

const toAlphabeticIndex = (
  value: unknown,
  caseInsensitive: boolean,
): number | null => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = caseInsensitive
    ? value.trim().toUpperCase()
    : value.trim();
  if (!/^[A-Za-z]+$/.test(normalized)) {
    return null;
  }

  let index = 0;
  for (const char of normalized.toUpperCase()) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }

  return index;
};

const toOutputScalar = (value: unknown): string | number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "boolean") {
    return String(value);
  }

  if (value === null || value === undefined) {
    return "";
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const parsePositiveStep = (value: number | undefined, fallback = 1): number => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  return fallback;
};

const DATE_UNIT_MILLISECONDS: Record<DateStepUnit, number> = {
  millisecond: 1,
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
};

type ComparatorContext = {
  groupKey: string;
  groupValues: Record<string, unknown>;
  previousRow: Record<string, unknown>;
  currentRow: Record<string, unknown>;
};

type ComparisonRuntime = {
  kind: NonNullable<ComparisonConfig["kind"]>;
  toComparable: (value: unknown) => unknown | null;
  isConsecutive: (
    previousComparable: unknown,
    currentComparable: unknown,
    context: ComparatorContext,
  ) => boolean;
};

type CustomComparatorFunction = (
  previous: unknown,
  current: unknown,
  context: ComparatorContext,
  helpers: {
    toNumber: typeof toFiniteNumber;
    toInteger: typeof toInteger;
    toDateTimestamp: typeof toDateTimestamp;
    toAlphabeticIndex: (value: unknown) => number | null;
  },
) => boolean;

const buildComparisonRuntime = (
  config: ComparisonConfig | undefined,
): ComparisonRuntime => {
  const kind = config?.kind ?? "integer-step";

  if (kind === "integer-step") {
    const step = parsePositiveStep(
      config && "step" in config ? config.step : undefined,
      1,
    );
    return {
      kind,
      toComparable: (value) => toInteger(value),
      isConsecutive: (previousComparable, currentComparable) => {
        const previous = previousComparable as number;
        const current = currentComparable as number;
        return current === previous + step;
      },
    };
  }

  if (kind === "number-step") {
    const numberConfig =
      config?.kind === "number-step"
        ? config
        : { kind: "number-step" as const };
    const step = parsePositiveStep(numberConfig.step, 1);
    const tolerance =
      typeof numberConfig.tolerance === "number" &&
      Number.isFinite(numberConfig.tolerance)
        ? Math.abs(numberConfig.tolerance)
        : 0;

    return {
      kind,
      toComparable: (value) => toFiniteNumber(value),
      isConsecutive: (previousComparable, currentComparable) => {
        const previous = previousComparable as number;
        const current = currentComparable as number;
        return Math.abs(current - previous - step) <= tolerance;
      },
    };
  }

  if (kind === "date-step") {
    const dateConfig =
      config?.kind === "date-step" ? config : { kind: "date-step" as const };
    const step = parsePositiveStep(dateConfig.step, 1);
    const unit = dateConfig.unit ?? "day";
    const multiplier =
      DATE_UNIT_MILLISECONDS[unit] ?? DATE_UNIT_MILLISECONDS.day;
    const expectedDelta = step * multiplier;

    return {
      kind,
      toComparable: (value) => toDateTimestamp(value),
      isConsecutive: (previousComparable, currentComparable) => {
        const previous = previousComparable as number;
        const current = currentComparable as number;
        return current - previous === expectedDelta;
      },
    };
  }

  if (kind === "alphabetic-step") {
    const alphaConfig =
      config?.kind === "alphabetic-step"
        ? config
        : { kind: "alphabetic-step" as const };
    const step = parsePositiveStep(alphaConfig.step, 1);
    const caseInsensitive = alphaConfig.caseInsensitive ?? true;
    return {
      kind,
      toComparable: (value) => toAlphabeticIndex(value, caseInsensitive),
      isConsecutive: (previousComparable, currentComparable) => {
        const previous = previousComparable as number;
        const current = currentComparable as number;
        return current === previous + step;
      },
    };
  }

  const customConfig =
    config?.kind === "custom-expression"
      ? config
      : { kind: "custom-expression" as const, expression: "" };

  const expression = customConfig.expression?.trim();
  if (!expression) {
    throw new UnrecoverableError(
      "Custom comparison expression is required when comparison kind is custom-expression",
    );
  }

  let customComparator: CustomComparatorFunction;
  try {
    const functionBody = expression.includes("return")
      ? expression
      : `return Boolean(${expression});`;

    customComparator = new Function(
      "previous",
      "current",
      "context",
      "helpers",
      `"use strict"; ${functionBody}`,
    ) as CustomComparatorFunction;
  } catch {
    throw new UnrecoverableError(
      "Custom comparison expression could not be compiled",
    );
  }

  return {
    kind,
    toComparable: (value) => {
      if (value === undefined || value === null || value === "") {
        return null;
      }

      return value;
    },
    isConsecutive: (previousComparable, currentComparable, context) => {
      try {
        return Boolean(
          customComparator(previousComparable, currentComparable, context, {
            toNumber: toFiniteNumber,
            toInteger,
            toDateTimestamp,
            toAlphabeticIndex: (value: unknown) =>
              toAlphabeticIndex(value, true),
          }),
        );
      } catch {
        throw new UnrecoverableError(
          "Custom comparison expression failed during execution",
        );
      }
    },
  };
};

const extractIntegerValue = (row: Record<string, unknown>): number | null => {
  const keys = Object.keys(row);

  if (keys.length === 0) {
    return null;
  }

  if (keys.length === 1) {
    return toInteger(row[keys[0]]);
  }

  const valueCandidate = toInteger(row.value);
  if (valueCandidate !== null) {
    return valueCandidate;
  }

  const integerCandidates = keys
    .map((key) => toInteger(row[key]))
    .filter((value): value is number => value !== null);

  if (integerCandidates.length === 1) {
    return integerCandidates[0];
  }

  return null;
};

const parseList = (values: unknown): string[] => {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
};

const getGroupValues = (
  row: Record<string, unknown>,
  groupByColumns: string[],
): Record<string, unknown> => {
  if (groupByColumns.length === 0) {
    return {};
  }

  return Object.fromEntries(
    groupByColumns.map((column) => [column, row[column]]),
  );
};

const getGroupKey = (
  row: Record<string, unknown>,
  groupByColumns: string[],
): string => {
  if (groupByColumns.length === 0) {
    return DEFAULT_GROUP_KEY;
  }

  const parts = groupByColumns.map(
    (column) => `${column}:${toOutputScalar(row[column])}`,
  );
  return parts.join("|");
};

type SequenceState = {
  groupKey: string;
  groupValues: Record<string, unknown>;
  startRaw: unknown;
  endRaw: unknown;
  startComparable: unknown;
  endComparable: unknown;
  length: number;
  previousRow: Record<string, unknown>;
};

const analyzeConsecutiveSequences = async (
  job: Job<CsvConsecutiveSequenceJobData, CsvConsecutiveSequenceJobResult>,
): Promise<CsvConsecutiveSequenceJobResult> => {
  const { sourceRef, minimumSequenceLength, analysisColumn, comparison } =
    job.data;

  const groupByColumns = parseList(job.data.groupByColumns);

  if (!Number.isInteger(minimumSequenceLength) || minimumSequenceLength < 1) {
    throw new UnrecoverableError(
      "minimumSequenceLength must be an integer greater than or equal to 1",
    );
  }

  const runtime = buildComparisonRuntime(comparison);

  const sequenceLengths: number[] = [];
  const startPoints: Array<string | number> = [];
  const endPoints: Array<string | number> = [];
  const sequences: CsvConsecutiveSequenceRecord[] = [];

  let processedRows = 0;
  let malformedRows = 0;

  const groupStates = new Map<string, SequenceState>();

  const flushSequence = (state: SequenceState) => {
    if (state.length < minimumSequenceLength) {
      return;
    }

    const sequence: CsvConsecutiveSequenceRecord = {
      groupKey: state.groupKey === DEFAULT_GROUP_KEY ? null : state.groupKey,
      groupValues: Object.fromEntries(
        Object.entries(state.groupValues).map(([key, value]) => [
          key,
          toOutputScalar(value),
        ]),
      ),
      startPoint: toOutputScalar(state.startRaw),
      endPoint: toOutputScalar(state.endRaw),
      length: state.length,
    };

    sequences.push(sequence);
    sequenceLengths.push(sequence.length);
    startPoints.push(sequence.startPoint);
    endPoints.push(sequence.endPoint);
  };

  const readAnalysisValue = (row: Record<string, unknown>): unknown | null => {
    if (analysisColumn && analysisColumn.trim().length > 0) {
      const value = row[analysisColumn];
      return value === undefined || value === null || value === ""
        ? null
        : value;
    }

    return extractIntegerValue(row);
  };

  let sawConfiguredAnalysisColumn = false;

  for await (const rawRow of streamContextRows(sourceRef)) {
    processedRows += 1;

    const row = rawRow as Record<string, unknown>;

    if (analysisColumn && Object.hasOwn(row, analysisColumn)) {
      sawConfiguredAnalysisColumn = true;
    }

    const analysisValue = readAnalysisValue(row);
    const comparableValue = runtime.toComparable(analysisValue);

    if (analysisValue === null || comparableValue === null) {
      malformedRows += 1;
      continue;
    }

    const groupKey = getGroupKey(row, groupByColumns);
    const groupValues = getGroupValues(row, groupByColumns);
    const currentState = groupStates.get(groupKey);

    if (!currentState) {
      groupStates.set(groupKey, {
        groupKey,
        groupValues,
        startRaw: analysisValue,
        endRaw: analysisValue,
        startComparable: comparableValue,
        endComparable: comparableValue,
        length: 1,
        previousRow: row,
      });
    } else {
      const isConsecutive = runtime.isConsecutive(
        currentState.endComparable,
        comparableValue,
        {
          groupKey,
          groupValues,
          previousRow: currentState.previousRow,
          currentRow: row,
        },
      );

      if (isConsecutive) {
        currentState.endRaw = analysisValue;
        currentState.endComparable = comparableValue;
        currentState.length += 1;
        currentState.previousRow = row;
      } else {
        flushSequence(currentState);
        groupStates.set(groupKey, {
          groupKey,
          groupValues,
          startRaw: analysisValue,
          endRaw: analysisValue,
          startComparable: comparableValue,
          endComparable: comparableValue,
          length: 1,
          previousRow: row,
        });
      }
    }

    if (processedRows % 10_000 === 0) {
      await job.updateProgress({
        processedRows,
        malformedRows,
        sequenceCount: sequenceLengths.length,
        groupCount: groupStates.size,
      });
    }
  }

  if (processedRows === 0) {
    throw new UnrecoverableError("Source dataset is empty");
  }

  if (analysisColumn && !sawConfiguredAnalysisColumn) {
    throw new UnrecoverableError(
      `Analysis column '${analysisColumn}' was not found in source rows`,
    );
  }

  if (processedRows === malformedRows) {
    throw new UnrecoverableError(
      "Source dataset does not contain usable values for the selected analysis column and comparison",
    );
  }

  for (const state of groupStates.values()) {
    flushSequence(state);
  }

  await job.updateProgress({
    processedRows,
    malformedRows,
    sequenceCount: sequenceLengths.length,
    groupCount: groupStates.size,
    completed: true,
  });

  return {
    sequenceCount: sequenceLengths.length,
    sequenceLengths,
    startPoints,
    endPoints,
    processedRows,
    malformedRows,
    groupedBy: groupByColumns,
    analysisColumn: analysisColumn ?? null,
    comparisonKind: runtime.kind,
    sequences,
  };
};

const worker = new Worker<
  CsvConsecutiveSequenceJobData,
  CsvConsecutiveSequenceJobResult
>(
  QUEUE_NAME,
  async (job) => {
    console.log(`[csv-consecutive-sequence] job ${job.id} started`);
    return analyzeConsecutiveSequences(job);
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
    `[csv-consecutive-sequence] job ${job.id} complete - ${result.sequenceCount.toLocaleString()} sequences`,
  );

  try {
    await inngest.send({
      name: "csv/consecutive-sequence.complete",
      data: {
        executionId: job.data.executionId,
        variableName: job.data.variableName,
        result,
      },
    });
  } catch (error) {
    console.error(
      "Failed to signal csv consecutive sequence completion",
      error,
    );
  }
});

worker.on("failed", async (job, error) => {
  const isUnrecoverable = error instanceof UnrecoverableError;

  console.error(
    `[csv-consecutive-sequence] job ${job?.id} failed:`,
    error.message,
  );

  if (
    isUnrecoverable ||
    (job && job.attemptsMade >= (job.opts.attempts ?? 3))
  ) {
    try {
      await inngest.send({
        name: "csv/consecutive-sequence.failed",
        data: {
          executionId: job?.data.executionId,
          reason: error.message,
        },
      });
    } catch {
      // Ignore notification failures.
    }
  }
});

const shutdown = async (signal: string) => {
  console.log(
    `[csv-consecutive-sequence] ${signal} received - draining worker`,
  );
  await worker.close();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

console.log(
  `[csv-consecutive-sequence] Worker online - queue="${QUEUE_NAME}" concurrency=${HEAVY_CONCURRENCY}`,
);
