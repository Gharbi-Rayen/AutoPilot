import { isDatasetRef } from "@/features/executions/server/datasets/dataset-ref";
import { datasetService } from "@/features/executions/server/datasets/dataset-service";
import { normalizeRowAtReadBoundary } from "@/features/executions/server/datasets/read-boundary";
import type { DatasetSchema } from "@/features/executions/server/datasets/schema-types";
import type { DatasetManifest } from "@/features/executions/server/datasets/types";
import { FileChannel } from "@/inngest/channels/file";
import type { NodeExecutor } from "../types";

export type CsvOperator =
  | "eq"
  | "ne"
  | "contains"
  | "not_contains"
  | "starts_with"
  | "ends_with"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "is_empty"
  | "is_not_empty";

export const parseNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
};

const normalizeVariableReference = (reference: string): string => {
  const trimmed = reference.trim();
  if (!trimmed) {
    return "";
  }

  const unwrapped = /^\{\{\s*(.+?)\s*\}\}$/.exec(trimmed)?.[1] ?? trimmed;

  return unwrapped
    .replace(/^context\./, "")
    .replace(/^\$\./, "")
    .trim();
};

export const resolveContextValue = (
  context: Record<string, unknown>,
  reference: string | undefined,
): unknown => {
  if (!reference) {
    return undefined;
  }

  const normalized = normalizeVariableReference(reference);
  if (!normalized) {
    return undefined;
  }

  if (Object.hasOwn(context, normalized)) {
    return context[normalized];
  }

  const segments = normalized
    .split(".")
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return undefined;
  }

  let current: unknown = context;
  for (const segment of segments) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }

    if (!Object.hasOwn(current as Record<string, unknown>, segment)) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
};

export const availableContextKeys = (
  context: Record<string, unknown>,
): string => Object.keys(context).slice(0, 20).join(", ");

export const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const resolveSchemaFromValue = (value: unknown): DatasetSchema | undefined => {
  if (!isRecord(value) || !isRecord(value.schema)) {
    return undefined;
  }

  return value.schema as DatasetSchema;
};

export const extractInlineRows = (
  value: unknown,
): Array<Record<string, unknown>> => {
  const schema = resolveSchemaFromValue(value);
  const normalizeRows = (rows: Array<Record<string, unknown>>) =>
    schema
      ? rows.map(
          (row) =>
            normalizeRowAtReadBoundary(row, schema) as Record<string, unknown>,
        )
      : rows;

  if (Array.isArray(value)) {
    return normalizeRows(value.filter(isRecord));
  }

  if (!isRecord(value)) {
    return [];
  }

  if (Array.isArray(value.records)) {
    return normalizeRows(value.records.filter(isRecord));
  }

  if (Array.isArray(value.data)) {
    return normalizeRows(value.data.filter(isRecord));
  }

  return [];
};

export const streamContextRows = async function* (
  value: unknown,
): AsyncGenerator<Record<string, unknown>, void, void> {
  if (isDatasetRef(value)) {
    for await (const row of datasetService.streamDatasetRows(
      value.executionId,
      value.datasetId,
    )) {
      if (isRecord(row)) {
        yield normalizeRowAtReadBoundary(row, value.schema) as Record<
          string,
          unknown
        >;
      }
    }

    return;
  }

  for (const row of extractInlineRows(value)) {
    yield row;
  }
};

export const applyCsvPredicate = (
  row: Record<string, unknown>,
  field: string,
  operator: CsvOperator,
  expectedValue: unknown,
): boolean => {
  const rawValue = row[field];

  if (operator === "is_empty") {
    return (
      rawValue === undefined ||
      rawValue === null ||
      (typeof rawValue === "string" && rawValue.trim() === "")
    );
  }

  if (operator === "is_not_empty") {
    return !(
      rawValue === undefined ||
      rawValue === null ||
      (typeof rawValue === "string" && rawValue.trim() === "")
    );
  }

  const actual = rawValue ?? "";
  const left = String(actual);
  const right = String(expectedValue ?? "");

  if (operator === "eq") return left === right;
  if (operator === "ne") return left !== right;
  if (operator === "contains") return left.includes(right);
  if (operator === "not_contains") return !left.includes(right);
  if (operator === "starts_with") return left.startsWith(right);
  if (operator === "ends_with") return left.endsWith(right);

  const leftNumber = parseNumber(actual);
  const rightNumber = parseNumber(expectedValue);
  if (leftNumber === null || rightNumber === null) {
    return false;
  }

  if (operator === "gt") return leftNumber > rightNumber;
  if (operator === "gte") return leftNumber >= rightNumber;
  if (operator === "lt") return leftNumber < rightNumber;
  return leftNumber <= rightNumber;
};

export const toDatasetRefOutput = (manifest: DatasetManifest) => {
  return {
    kind: "dataset" as const,
    datasetId: manifest.datasetId,
    executionId: manifest.executionId,
    variableName: manifest.variableName,
    storage: manifest.storage,
    manifestVersion: manifest.version,
    rowCount: manifest.rowCount,
    chunkCount: manifest.chunkCount,
    byteSize: manifest.byteSize,
    schema: manifest.schema,
  };
};

export const withCsvNodeStatus = async <T>(
  nodeId: string,
  publish: Parameters<NodeExecutor>[0]["publish"],
  task: () => Promise<T>,
): Promise<T> => {
  const publishStatus = async (status: "loading" | "error" | "success") =>
    publish(
      FileChannel().status({
        nodeId,
        status,
      }),
    );

  await publishStatus("loading");

  try {
    const result = await task();
    await publishStatus("success");
    return result;
  } catch (error) {
    await publishStatus("error");
    throw error;
  }
};
