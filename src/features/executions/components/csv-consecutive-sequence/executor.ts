import { NonRetriableError } from "inngest";
import { isDatasetRef } from "@/features/executions/server/datasets/dataset-ref";
import type { DatasetSchema } from "@/features/executions/server/datasets/schema-types";
import {
  availableContextKeys,
  extractInlineRows,
  resolveContextValue,
  withCsvNodeStatus,
} from "../csv-shared/executor-utils";
import type { NodeExecutor } from "../types";

type CsvConsecutiveSequenceData = {
  sourceVariable?: string;
  variableName?: string;
  minimumSequenceLength?: number | string;
  analysisColumn?: string;
  groupByColumns?: string | string[];
  comparisonMode?:
    | "integer-step"
    | "number-step"
    | "date-step"
    | "alphabetic-step"
    | "custom-expression";
  comparisonStep?: number | string;
  dateStepUnit?: "millisecond" | "second" | "minute" | "hour" | "day";
  numberTolerance?: number | string;
  customComparisonExpression?: string;
};

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
      unit?: "millisecond" | "second" | "minute" | "hour" | "day";
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

type CsvConsecutiveSequenceRecord = {
  groupKey: string | null;
  groupValues: Record<string, string | number>;
  startPoint: string | number;
  endPoint: string | number;
  length: number;
};

type CsvConsecutiveSequenceWorkerResult = {
  sequenceCount: number;
  sequenceLengths: Array<number>;
  startPoints: Array<string | number>;
  endPoints: Array<string | number>;
  processedRows: number;
  malformedRows: number;
  groupedBy: string[];
  analysisColumn: string | null;
  comparisonKind:
    | "integer-step"
    | "number-step"
    | "date-step"
    | "alphabetic-step"
    | "custom-expression";
  sequences: CsvConsecutiveSequenceRecord[];
};

const parseMinimumLength = (value: number | string | undefined): number => {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isInteger(parsed)) {
      return parsed;
    }
  }

  return 2;
};

const parseStep = (
  value: number | string | undefined,
  fallback = 1,
): number => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return fallback;
};

const parseOptionalNumber = (
  value: number | string | undefined,
): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
};

const parseCommaList = (value: string | string[] | undefined): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

const buildComparisonConfig = (
  data: CsvConsecutiveSequenceData,
): ComparisonConfig => {
  const mode = data.comparisonMode ?? "integer-step";
  const step = parseStep(data.comparisonStep, 1);

  if (mode === "number-step") {
    return {
      kind: mode,
      step,
      tolerance: Math.abs(parseOptionalNumber(data.numberTolerance) ?? 0),
    };
  }

  if (mode === "date-step") {
    return {
      kind: mode,
      step,
      unit: data.dateStepUnit ?? "day",
    };
  }

  if (mode === "alphabetic-step") {
    return {
      kind: mode,
      step,
      caseInsensitive: true,
    };
  }

  if (mode === "custom-expression") {
    const expression = data.customComparisonExpression?.trim();
    if (!expression) {
      throw new NonRetriableError(
        "Custom comparison expression is required when comparison mode is custom",
      );
    }

    return {
      kind: mode,
      expression,
    };
  }

  return {
    kind: "integer-step",
    step,
  };
};

export const CsvConsecutiveSequenceExecutor: NodeExecutor<
  CsvConsecutiveSequenceData
> = async ({ data, nodeId, executionId, context, publish, step }) =>
  withCsvNodeStatus(nodeId, publish, async () => {
    if (!executionId) {
      throw new NonRetriableError(
        "Execution context is missing executionId for csv-consecutive-sequence",
      );
    }

    const variableName = data.variableName?.trim();
    const sourceVariable = data.sourceVariable?.trim();
    const analysisColumn = data.analysisColumn?.trim();

    if (!variableName) {
      throw new NonRetriableError("Variable name is required");
    }

    if (!sourceVariable) {
      throw new NonRetriableError("Source variable is required");
    }

    if (!analysisColumn) {
      throw new NonRetriableError("Analysis column is required");
    }

    const minimumSequenceLength = parseMinimumLength(
      data.minimumSequenceLength,
    );
    if (minimumSequenceLength < 1) {
      throw new NonRetriableError(
        "Minimum sequence length must be an integer greater than or equal to 1",
      );
    }

    const source = resolveContextValue(context, sourceVariable);
    if (source === undefined) {
      const availableKeys = availableContextKeys(context);
      throw new NonRetriableError(
        `Source variable '${sourceVariable}' not found in workflow context. Available keys: ${availableKeys || "(none)"}`,
      );
    }

    const inlineRows = extractInlineRows(source);
    const sourceRows = isDatasetRef(source)
      ? source.rowCount
      : inlineRows.length;

    if (sourceRows === 0) {
      throw new NonRetriableError(
        "Source variable must contain CSV records (array, records payload, or DatasetRef)",
      );
    }

    const groupByColumns = parseCommaList(data.groupByColumns);
    const comparison = buildComparisonConfig(data);

    const completionPromise = step.waitForEvent(
      "wait-for-csv-consecutive-sequence",
      {
        event: "csv/consecutive-sequence.complete",
        match: "data.executionId",
        timeout: "60m",
      },
    );

    await step.run("enqueue-csv-consecutive-sequence", async () => {
      const { getCsvConsecutiveSequenceQueue } = await import(
        "@/lib/worker-queue"
      );
      const queue = getCsvConsecutiveSequenceQueue();
      await queue.add(
        "analyze",
        {
          executionId,
          variableName,
          sourceRef: source,
          minimumSequenceLength,
          analysisColumn,
          groupByColumns,
          comparison,
        },
        {
          jobId: `${executionId}-${variableName}`,
          removeOnComplete: 50,
          removeOnFail: 20,
        },
      );
    });

    const completion = await completionPromise;
    const failureMessage = completion?.data?.error ?? completion?.data?.reason;

    if (typeof failureMessage === "string" && failureMessage.length > 0) {
      throw new NonRetriableError(
        `CSV consecutive sequence analyzer failed: ${failureMessage}`,
      );
    }

    if (!completion || !completion.data?.result) {
      throw new NonRetriableError(
        "Wait for consecutive sequence analyzer timed out after 60 minutes",
      );
    }

    const result = completion.data.result as CsvConsecutiveSequenceWorkerResult;

    const sequenceRecords = result.sequences.map((sequence) => {
      // Collect group fields separately so sequence_begin/sequence_end always come first
      const groupFields: Record<string, unknown> = {};
      if (
        sequence.groupValues &&
        typeof sequence.groupValues === "object" &&
        !Array.isArray(sequence.groupValues)
      ) {
        Object.assign(groupFields, sequence.groupValues);
      } else if (sequence.groupKey !== null) {
        groupFields.group_key = sequence.groupKey;
      }

      return {
        sequence_begin: sequence.startPoint,
        sequence_end: sequence.endPoint,
        consecutive_count: sequence.length,
        ...groupFields,
      };
    });

    // Build an explicit schema to guarantee column display order:
    // sequence_begin → sequence_end → consecutive_count → (group columns)
    const sequenceSchema: DatasetSchema = {
      sequence_begin: { type: "string", nullable: false },
      sequence_end: { type: "string", nullable: false },
      consecutive_count: { type: "number", nullable: false },
    };
    for (const col of groupByColumns) {
      sequenceSchema[col] = { type: "string", nullable: true };
    }

    return {
      [variableName]: {
        kind: "dataset-summary",
        records: sequenceRecords,
        schema: sequenceSchema,
        metadata: {
          sequenceCount: result.sequenceCount,
          minimumSequenceLength,
          analysisColumn,
          groupedBy: result.groupedBy,
          comparisonKind: result.comparisonKind,
          sourceRows,
          processedRows: result.processedRows,
          malformedRows: result.malformedRows,
        },
      },
    };
  });
