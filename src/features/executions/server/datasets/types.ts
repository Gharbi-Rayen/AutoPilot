import type { ChunkOffsetAnchor } from "./chunk-offset-index";
import type { DatasetSchema } from "./schema-types";

export const DATASET_MANIFEST_VERSION = 1 as const;

export type DatasetStorageAdapterType = "jsonl" | "object-storage" | "columnar";

export type DatasetRow = Record<string, unknown>;

export interface DatasetChunkMetadata {
  chunkIndex: number;
  fileName: string;
  rowStart: number;
  rowEnd: number;
  rowCount: number;
  cumulativeRowCount: number;
  byteSize: number;
  offsetAnchors?: ChunkOffsetAnchor[];
  checksum?: string;
  createdAt: string;
}

export interface DatasetManifestV1 {
  version: typeof DATASET_MANIFEST_VERSION;
  storage: DatasetStorageAdapterType;
  datasetId: string;
  executionId: string;
  variableName: string;
  ownership?: {
    executionId: string;
    variableName: string;
  };
  createdAt: string;
  updatedAt: string;
  rowCount: number;
  chunkCount: number;
  byteSize: number;
  schema?: DatasetSchema;
  chunks: DatasetChunkMetadata[];
}

export type DatasetManifest = DatasetManifestV1;

export interface DatasetWriteOptions {
  executionId: string;
  variableName: string;
  datasetId?: string;
  chunkSize: number;
  schema?: DatasetSchema;
}

export interface DatasetWriteSession {
  datasetId: string;
  executionId: string;
  variableName: string;
  chunkSize: number;
  schema?: DatasetSchema;
  createdAt: string;
  updatedAt: string;
  tempDirectory: string;
  finalDirectory: string;
  currentChunkIndex: number;
  currentChunkRows: DatasetRow[];
  rowCount: number;
  byteSize: number;
  chunks: DatasetChunkMetadata[];
}

export interface DatasetChunkResult {
  chunk: DatasetChunkMetadata;
  rows: DatasetRow[];
}

export interface DatasetRowsResult {
  chunk: DatasetChunkMetadata;
  offset: number;
  limit: number;
  totalRows: number;
  rows: DatasetRow[];
}

export interface DatasetPageAdapterWindow {
  chunkIndex: number;
  offset: number;
  limit: number;
  globalOffset: number;
}

export interface DatasetPageRowsResult {
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
  window: DatasetPageAdapterWindow | null;
  rows: DatasetRow[];
}

export interface DatasetMetaResult {
  datasetId: string;
  executionId: string;
  variableName: string;
  storage: DatasetStorageAdapterType;
  version: number;
  rowCount: number;
  chunkCount: number;
  byteSize: number;
  schema?: DatasetSchema;
  chunks: DatasetChunkMetadata[];
  createdAt: string;
  updatedAt: string;
}
