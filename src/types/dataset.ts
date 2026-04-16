/**
 * Shared dataset types for offline PWA.
 * These are client-safe — no server/Node.js dependencies.
 */

export type DatasetFieldType =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "null"
  | "unknown";

export interface DatasetFieldSchema {
  type: DatasetFieldType;
  nullable: boolean;
  sampleValues?: string[];
}

export type DatasetSchema = Record<string, DatasetFieldSchema>;

export type DatasetRow = Record<string, unknown>;

export const DATASET_MANIFEST_VERSION = 1 as const;

export interface DatasetChunkMetadata {
  chunkIndex: number;
  fileName: string;
  rowStart: number;
  rowEnd: number;
  rowCount: number;
  cumulativeRowCount: number;
  byteSize: number;
  createdAt: string;
}

export interface DatasetManifest {
  version: typeof DATASET_MANIFEST_VERSION;
  datasetId: string;
  executionId: string;
  variableName: string;
  createdAt: string;
  updatedAt: string;
  rowCount: number;
  chunkCount: number;
  byteSize: number;
  schema?: DatasetSchema;
  chunks: DatasetChunkMetadata[];
}

/** A lightweight reference to a dataset stored in OPFS. Passed between nodes. */
export interface DatasetRef {
  kind: "dataset";
  datasetId: string;
  executionId: string;
  variableName: string;
  rowCount: number;
  chunkCount: number;
  byteSize: number;
  schema?: DatasetSchema;
}

export const isDatasetRef = (value: unknown): value is DatasetRef =>
  typeof value === "object" &&
  value !== null &&
  (value as DatasetRef).kind === "dataset";

export interface DatasetPageRowsResult {
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
  rows: DatasetRow[];
}

export const getFieldSchema = (
  schema: DatasetSchema | undefined,
  fieldName: string,
): DatasetFieldSchema | undefined => schema?.[fieldName];

export const resolveComparableFieldType = (
  schema: DatasetSchema | undefined,
  fieldName: string,
): Extract<DatasetFieldType, "string" | "number" | "boolean" | "date"> => {
  const t = getFieldSchema(schema, fieldName)?.type;
  if (t === "number" || t === "boolean" || t === "date") return t;
  return "string";
};
