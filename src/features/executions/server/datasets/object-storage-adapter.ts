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

const toObjectStorageManifest = (
  manifest: DatasetManifest,
): DatasetManifest => {
  return {
    ...manifest,
    storage: "object-storage",
  };
};

export class ObjectStorageAdapter implements DatasetStorageAdapter {
  readonly storageType = "object-storage" as const;
  readonly capabilities = {
    format: "object-storage" as const,
    supportsStreamingRead: true,
    supportsOffsetRead: true,
    supportsSchemaTypedRows: true,
    experimental: true,
  };

  private readonly delegate = new JsonlStorageAdapter();

  async beginWrite(options: DatasetWriteOptions): Promise<DatasetWriteSession> {
    return this.delegate.beginWrite(options);
  }

  async appendRows(
    session: DatasetWriteSession,
    rows: DatasetRow[],
  ): Promise<void> {
    return this.delegate.appendRows(session, rows);
  }

  async commitWrite(session: DatasetWriteSession): Promise<DatasetManifest> {
    const manifest = await this.delegate.commitWrite(session);
    return toObjectStorageManifest(manifest);
  }

  async abortWrite(session: DatasetWriteSession): Promise<void> {
    return this.delegate.abortWrite(session);
  }

  async getManifest(
    executionId: string,
    datasetId: string,
  ): Promise<DatasetManifest> {
    const manifest = await this.delegate.getManifest(executionId, datasetId);
    return toObjectStorageManifest(manifest);
  }

  async readChunk(
    executionId: string,
    datasetId: string,
    chunkIndex: number,
  ): Promise<DatasetChunkResult> {
    return this.delegate.readChunk(executionId, datasetId, chunkIndex);
  }

  async readRows(
    executionId: string,
    datasetId: string,
    chunkIndex: number,
    offset: number,
    limit: number,
  ): Promise<DatasetRowsResult> {
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
    yield* this.delegate.streamRows(executionId, datasetId);
  }
}
