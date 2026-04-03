import { JsonlStorageAdapter } from "./jsonl-storage-adapter";
import type { DatasetStorageAdapter } from "./storage-adapter";
import type {
  DatasetChunkResult,
  DatasetManifest,
  DatasetRow,
  DatasetRowsResult,
  DatasetWriteOptions,
  DatasetWriteSession,
} from "./types";

interface ColumnarStorageAdapterOptions {
  prototypeMode?: boolean;
}

const toColumnarManifest = (manifest: DatasetManifest): DatasetManifest => {
  return {
    ...manifest,
    storage: "columnar",
  };
};

export class ColumnarStorageAdapter implements DatasetStorageAdapter {
  readonly storageType = "columnar" as const;
  readonly capabilities = {
    format: "columnar" as const,
    supportsStreamingRead: true,
    supportsOffsetRead: true,
    supportsSchemaTypedRows: true,
    experimental: true,
  };

  private readonly delegate = new JsonlStorageAdapter();
  private readonly prototypeMode: boolean;

  constructor(options: ColumnarStorageAdapterOptions = {}) {
    this.prototypeMode = options.prototypeMode ?? true;
  }

  private ensureEnabled() {
    if (!this.prototypeMode) {
      throw new Error(
        "Columnar storage adapter is disabled. Enable prototype mode or switch DATASET_STORAGE_FORMAT to jsonl.",
      );
    }
  }

  async beginWrite(options: DatasetWriteOptions): Promise<DatasetWriteSession> {
    this.ensureEnabled();
    return this.delegate.beginWrite(options);
  }

  async appendRows(
    session: DatasetWriteSession,
    rows: DatasetRow[],
  ): Promise<void> {
    this.ensureEnabled();
    return this.delegate.appendRows(session, rows);
  }

  async commitWrite(session: DatasetWriteSession): Promise<DatasetManifest> {
    this.ensureEnabled();
    const manifest = await this.delegate.commitWrite(session);
    return toColumnarManifest(manifest);
  }

  async abortWrite(session: DatasetWriteSession): Promise<void> {
    return this.delegate.abortWrite(session);
  }

  async getManifest(
    executionId: string,
    datasetId: string,
  ): Promise<DatasetManifest> {
    this.ensureEnabled();
    const manifest = await this.delegate.getManifest(executionId, datasetId);
    return toColumnarManifest(manifest);
  }

  async readChunk(
    executionId: string,
    datasetId: string,
    chunkIndex: number,
  ): Promise<DatasetChunkResult> {
    this.ensureEnabled();
    return this.delegate.readChunk(executionId, datasetId, chunkIndex);
  }

  async readRows(
    executionId: string,
    datasetId: string,
    chunkIndex: number,
    offset: number,
    limit: number,
  ): Promise<DatasetRowsResult> {
    this.ensureEnabled();
    return this.delegate.readRows(
      executionId,
      datasetId,
      chunkIndex,
      offset,
      limit,
    );
  }

  async *streamRows(
    executionId: string,
    datasetId: string,
  ): AsyncGenerator<DatasetRow, void, void> {
    this.ensureEnabled();
    yield* this.delegate.streamRows(executionId, datasetId);
  }
}
