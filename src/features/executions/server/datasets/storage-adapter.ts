import type {
  DatasetChunkResult,
  DatasetManifest,
  DatasetRow,
  DatasetRowsResult,
  DatasetStorageAdapterType,
  DatasetWriteOptions,
  DatasetWriteSession,
} from "./types";

export interface DatasetStorageCapabilities {
  format: DatasetStorageAdapterType;
  supportsStreamingRead: boolean;
  supportsOffsetRead: boolean;
  supportsSchemaTypedRows: boolean;
  experimental?: boolean;
}

export interface DatasetStorageNegotiation {
  preferredFormat?: DatasetStorageAdapterType;
  allowExperimental?: boolean;
}

export interface DatasetStorageAdapter {
  readonly storageType: DatasetStorageAdapterType;
  readonly capabilities: DatasetStorageCapabilities;

  beginWrite(options: DatasetWriteOptions): Promise<DatasetWriteSession>;

  appendRows(session: DatasetWriteSession, rows: DatasetRow[]): Promise<void>;

  commitWrite(session: DatasetWriteSession): Promise<DatasetManifest>;

  abortWrite(session: DatasetWriteSession): Promise<void>;

  getManifest(executionId: string, datasetId: string): Promise<DatasetManifest>;

  readChunk(
    executionId: string,
    datasetId: string,
    chunkIndex: number,
  ): Promise<DatasetChunkResult>;

  readRows(
    executionId: string,
    datasetId: string,
    chunkIndex: number,
    offset: number,
    limit: number,
  ): Promise<DatasetRowsResult>;

  streamRows(
    executionId: string,
    datasetId: string,
  ): AsyncGenerator<DatasetRow, void, void>;
}
