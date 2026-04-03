import { DATASET_STORAGE } from "@/config/constants";
import { initializeExecutionBudget } from "../resource-budget";
import {
  type AsyncOrSyncIterable,
  batchAsyncIterator,
  throwIfAborted,
} from "./async-batch-iterator";
import { resolveChunkWindowByPage } from "./chunk-index";
import { cleanupExecutionDatasets } from "./cleanup";
import { ColumnarStorageAdapter } from "./columnar-storage-adapter";
import { JsonlStorageAdapter } from "./jsonl-storage-adapter";
import { ObjectStorageAdapter } from "./object-storage-adapter";
import { canonicalizeRowsForStorage } from "./read-boundary";
import type { DatasetSchema } from "./schema-types";
import type {
  DatasetStorageAdapter,
  DatasetStorageNegotiation,
} from "./storage-adapter";
import type {
  DatasetChunkResult,
  DatasetManifest,
  DatasetMetaResult,
  DatasetPageRowsResult,
  DatasetRow,
  DatasetRowsResult,
  DatasetStorageAdapterType,
  DatasetWriteSession,
} from "./types";
import { cleanupStaleWriteTransactions } from "./write-transaction";

const createDefaultStorageAdapter = (): DatasetStorageAdapter => {
  if (DATASET_STORAGE.DEFAULT_STORAGE_FORMAT === "object-storage") {
    return new ObjectStorageAdapter();
  }

  if (
    DATASET_STORAGE.DEFAULT_STORAGE_FORMAT === "columnar" &&
    DATASET_STORAGE.ENABLE_COLUMNAR_ADAPTER
  ) {
    return new ColumnarStorageAdapter({
      prototypeMode: DATASET_STORAGE.COLUMNAR_PROTOTYPE_MODE,
    });
  }

  return new JsonlStorageAdapter();
};

const resolveChunkSize = (chunkSize: number | undefined) => {
  if (!chunkSize) {
    return DATASET_STORAGE.DEFAULT_CHUNK_SIZE_ROWS;
  }

  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    return DATASET_STORAGE.DEFAULT_CHUNK_SIZE_ROWS;
  }

  return chunkSize;
};

const resolveReadLimit = (limit: number) => {
  if (!Number.isInteger(limit) || limit <= 0) {
    return 0;
  }

  return Math.min(limit, DATASET_STORAGE.MAX_CHUNK_READ_ROWS);
};

export interface BeginDatasetWriteOptions {
  executionId: string;
  variableName: string;
  datasetId?: string;
  chunkSize?: number;
  schema?: DatasetSchema;
  storageNegotiation?: DatasetStorageNegotiation;
}

export interface PersistDatasetRowsOptions extends BeginDatasetWriteOptions {
  rows: DatasetRow[];
}

export interface PersistDatasetStreamOptions extends BeginDatasetWriteOptions {
  rows: AsyncOrSyncIterable<DatasetRow>;
  signal?: AbortSignal;
}

export class DatasetService {
  private startupCleanupPromise: Promise<void> | null = null;

  constructor(
    private readonly adapter: DatasetStorageAdapter = createDefaultStorageAdapter(),
  ) {}

  negotiateStorageFormat(negotiation?: DatasetStorageNegotiation): {
    selectedFormat: DatasetStorageAdapterType;
    requestedFormat: DatasetStorageAdapterType;
    fallbackApplied: boolean;
    capabilities: DatasetStorageAdapter["capabilities"];
  } {
    const requestedFormat =
      negotiation?.preferredFormat ??
      (DATASET_STORAGE.DEFAULT_STORAGE_FORMAT as DatasetStorageAdapterType);
    const supportsRequestedFormat =
      requestedFormat === this.adapter.storageType;
    const canUseExperimental =
      negotiation?.allowExperimental ?? DATASET_STORAGE.ENABLE_COLUMNAR_ADAPTER;

    if (
      supportsRequestedFormat &&
      (canUseExperimental || !this.adapter.capabilities.experimental)
    ) {
      return {
        requestedFormat,
        selectedFormat: this.adapter.storageType,
        fallbackApplied: false,
        capabilities: this.adapter.capabilities,
      };
    }

    return {
      requestedFormat,
      selectedFormat: this.adapter.storageType,
      fallbackApplied: requestedFormat !== this.adapter.storageType,
      capabilities: this.adapter.capabilities,
    };
  }

  private async ensureStartupCleanup() {
    if (!this.startupCleanupPromise) {
      this.startupCleanupPromise = (async () => {
        await cleanupStaleWriteTransactions();
        await cleanupExecutionDatasets();
      })();
    }

    await this.startupCleanupPromise;
  }

  async beginWrite(
    options: BeginDatasetWriteOptions,
  ): Promise<DatasetWriteSession> {
    await this.ensureStartupCleanup();
    initializeExecutionBudget(options.executionId);
    this.negotiateStorageFormat(options.storageNegotiation);

    return this.adapter.beginWrite({
      executionId: options.executionId,
      variableName: options.variableName,
      datasetId: options.datasetId,
      schema: options.schema,
      chunkSize: resolveChunkSize(options.chunkSize),
    });
  }

  appendRows(session: DatasetWriteSession, rows: DatasetRow[]): Promise<void> {
    const canonicalRows = canonicalizeRowsForStorage(rows, session.schema);
    return this.adapter.appendRows(session, canonicalRows);
  }

  commitWrite(session: DatasetWriteSession): Promise<DatasetManifest> {
    return this.adapter.commitWrite(session);
  }

  abortWrite(session: DatasetWriteSession): Promise<void> {
    return this.adapter.abortWrite(session);
  }

  async persistRows(
    options: PersistDatasetRowsOptions,
  ): Promise<DatasetManifest> {
    return this.persistRowsFromStream(options);
  }

  async persistRowsFromStream(
    options: PersistDatasetStreamOptions,
  ): Promise<DatasetManifest> {
    const session = await this.beginWrite(options);
    const batchSize = resolveChunkSize(options.chunkSize);

    try {
      for await (const batch of batchAsyncIterator(
        options.rows,
        batchSize,
        options.signal,
        {
          executionId: options.executionId,
          stage: `dataset-write:${options.variableName}`,
        },
      )) {
        throwIfAborted(options.signal);
        await this.appendRows(session, batch);
      }

      return await this.commitWrite(session);
    } catch (error) {
      await this.abortWrite(session);
      throw error;
    }
  }

  async getDatasetMeta(
    executionId: string,
    datasetId: string,
  ): Promise<DatasetMetaResult> {
    await this.ensureStartupCleanup();

    const manifest = await this.adapter.getManifest(executionId, datasetId);

    return {
      datasetId: manifest.datasetId,
      executionId: manifest.executionId,
      variableName: manifest.variableName,
      storage: manifest.storage,
      version: manifest.version,
      rowCount: manifest.rowCount,
      chunkCount: manifest.chunkCount,
      byteSize: manifest.byteSize,
      schema: manifest.schema,
      chunks: manifest.chunks,
      createdAt: manifest.createdAt,
      updatedAt: manifest.updatedAt,
    };
  }

  async getDatasetChunk(
    executionId: string,
    datasetId: string,
    chunkIndex: number,
  ): Promise<DatasetChunkResult> {
    await this.ensureStartupCleanup();
    return this.adapter.readChunk(executionId, datasetId, chunkIndex);
  }

  async getDatasetRows(
    executionId: string,
    datasetId: string,
    chunkIndex: number,
    offset: number,
    limit: number,
  ): Promise<DatasetRowsResult> {
    await this.ensureStartupCleanup();
    const safeOffset = Math.max(0, offset);
    const safeLimit = resolveReadLimit(limit);

    return this.adapter.readRows(
      executionId,
      datasetId,
      chunkIndex,
      safeOffset,
      safeLimit,
    );
  }

  async getDatasetRowsByPage(
    executionId: string,
    datasetId: string,
    page: number,
    pageSize: number,
  ): Promise<DatasetPageRowsResult> {
    await this.ensureStartupCleanup();

    const safePageSize = Math.max(1, resolveReadLimit(pageSize));
    const manifest = await this.adapter.getManifest(executionId, datasetId);
    const resolution = resolveChunkWindowByPage({
      chunks: manifest.chunks,
      page,
      pageSize: safePageSize,
    });

    if (!resolution.window) {
      return {
        page: resolution.page,
        pageSize: resolution.pageSize,
        totalRows: resolution.totalRows,
        totalPages: resolution.totalPages,
        window: null,
        rows: [],
      };
    }

    const rows: DatasetRow[] = [];
    let remaining = resolution.pageSize;
    let nextChunkIndex = resolution.window.chunkIndex;
    let nextOffset = resolution.window.offset;

    while (remaining > 0 && nextChunkIndex < manifest.chunkCount) {
      const pageResult = await this.adapter.readRows(
        executionId,
        datasetId,
        nextChunkIndex,
        nextOffset,
        remaining,
      );

      if (pageResult.rows.length === 0) {
        break;
      }

      rows.push(...pageResult.rows);
      remaining -= pageResult.rows.length;
      nextChunkIndex += 1;
      nextOffset = 0;
    }

    return {
      page: resolution.page,
      pageSize: resolution.pageSize,
      totalRows: resolution.totalRows,
      totalPages: resolution.totalPages,
      window: resolution.window,
      rows,
    };
  }

  async *streamDatasetRows(
    executionId: string,
    datasetId: string,
  ): AsyncGenerator<DatasetRow, void, void> {
    await this.ensureStartupCleanup();
    yield* this.adapter.streamRows(executionId, datasetId);
  }
}

export const datasetService = new DatasetService();
