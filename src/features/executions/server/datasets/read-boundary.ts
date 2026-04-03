import { applySchemaToRow, applySchemaToRows } from "./schema-inference";
import type { DatasetSchema } from "./schema-types";
import type { DatasetRow } from "./types";

const cloneRow = (row: DatasetRow): DatasetRow => {
  return { ...row };
};

export const canonicalizeRowForStorage = (
  row: DatasetRow,
  schema?: DatasetSchema,
): DatasetRow => {
  if (!schema) {
    return cloneRow(row);
  }

  return applySchemaToRow(row, schema);
};

export const canonicalizeRowsForStorage = (
  rows: DatasetRow[],
  schema?: DatasetSchema,
): DatasetRow[] => {
  if (!schema) {
    return rows.map((row) => cloneRow(row));
  }

  return applySchemaToRows(rows, schema);
};

export const normalizeRowAtReadBoundary = (
  row: DatasetRow,
  schema?: DatasetSchema,
): DatasetRow => {
  return canonicalizeRowForStorage(row, schema);
};

export const normalizeRowsAtReadBoundary = (
  rows: DatasetRow[],
  schema?: DatasetSchema,
): DatasetRow[] => {
  return canonicalizeRowsForStorage(rows, schema);
};
