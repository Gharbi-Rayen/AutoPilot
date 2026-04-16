/**
 * CSV executor utilities — client-side (offline) version.
 * All server/Inngest dependencies removed; uses OPFS + types/dataset instead.
 */

import { isDatasetRef } from "@/types/dataset";
import { readDataset } from "@/lib/opfs";
import { db } from "@/lib/db";

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
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const normalizeVariableReference = (reference: string): string => {
  const trimmed = reference.trim();
  if (!trimmed) return "";
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
  if (!reference) return undefined;
  const normalized = normalizeVariableReference(reference);
  if (!normalized) return undefined;
  if (Object.hasOwn(context, normalized)) return context[normalized];
  const segments = normalized.split(".").filter((s) => s.length > 0);
  if (segments.length === 0) return undefined;
  let current: unknown = context;
  for (const segment of segments) {
    if (typeof current !== "object" || current === null) return undefined;
    if (!Object.hasOwn(current as Record<string, unknown>, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
};

export const availableContextKeys = (context: Record<string, unknown>): string =>
  Object.keys(context).slice(0, 20).join(", ");

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const extractInlineRows = (
  value: unknown,
): Array<Record<string, unknown>> => {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  if (Array.isArray(value.records)) return value.records.filter(isRecord);
  if (Array.isArray(value.data)) return value.data.filter(isRecord);
  return [];
};

/**
 * Stream rows from either a DatasetRef (OPFS) or inline rows.
 */
export const streamContextRows = async function* (
  value: unknown,
): AsyncGenerator<Record<string, unknown>, void, void> {
  if (isDatasetRef(value)) {
    const datasetRecord = await db.datasets.get(value.datasetId);
    if (!datasetRecord) {
      throw new Error(`streamContextRows: dataset ${value.datasetId} not found`);
    }
    const rows = await readDataset(value.executionId, value.datasetId, datasetRecord.manifest);
    for (const row of rows) {
      if (isRecord(row)) yield row;
    }
    return;
  }
  for (const row of extractInlineRows(value)) yield row;
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
  if (leftNumber === null || rightNumber === null) return false;

  if (operator === "gt") return leftNumber > rightNumber;
  if (operator === "gte") return leftNumber >= rightNumber;
  if (operator === "lt") return leftNumber < rightNumber;
  return leftNumber <= rightNumber;
};
