import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { releaseDiskUsage, reserveDiskUsage } from "../resource-budget";
import { getChunkByIndex, normalizeChunkMetadata } from "./chunk-index";
import {
  buildChunkOffsetAnchors,
  resolveChunkOffsetAnchor,
} from "./chunk-offset-index";
import {
  ensureDirectory,
  getDatasetChunkPath,
  getDatasetManifestPath,
} from "./paths";
import {
  normalizeRowAtReadBoundary,
  normalizeRowsAtReadBoundary,
} from "./read-boundary";
import type { DatasetSchema } from "./schema-types";
import type { DatasetStorageAdapter } from "./storage-adapter";
import {
  DATASET_MANIFEST_VERSION,
  type DatasetChunkMetadata,
  type DatasetChunkResult,
  type DatasetManifest,
  type DatasetRow,
  type DatasetRowsResult,
  type DatasetWriteOptions,
  type DatasetWriteSession,
} from "./types";
import {
  commitWriteTransaction,
  createWriteTransaction,
  rollbackWriteTransaction,
} from "./write-transaction";

const chunkFileName = (chunkIndex: number) => {
  return `chunk-${chunkIndex.toString().padStart(6, "0")}.jsonl`;
};

const parseJsonLine = (
  line: string,
  chunkIndex: number,
  lineNumber: number,
): DatasetRow => {
  try {
    const parsed = JSON.parse(line) as DatasetRow;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error("Row is not an object");
    }
    return parsed;
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Invalid JSONL row in chunk ${chunkIndex} at line ${lineNumber}: ${cause}`,
    );
  }
};

const parseJsonlRows = (
  rawText: string,
  chunkIndex: number,
  schema?: DatasetSchema,
): DatasetRow[] => {
  const rows: DatasetRow[] = [];
  const lines = rawText.split(/\r?\n/);

  let parsedLineNumber = 0;
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    parsedLineNumber += 1;
    rows.push(parseJsonLine(line, chunkIndex, parsedLineNumber));
  }

  return normalizeRowsAtReadBoundary(rows, schema);
};

const flushChunk = async (
  session: DatasetWriteSession,
  rows: DatasetRow[],
): Promise<void> => {
  if (rows.length === 0) {
    return;
  }

  const chunkIndex = session.currentChunkIndex;
  const fileName = chunkFileName(chunkIndex);
  const filePath = join(session.tempDirectory, fileName);

  const serializedRows = rows.map((row) => JSON.stringify(row));
  const payload = `${serializedRows.join("\n")}\n`;
  const byteSize = Buffer.byteLength(payload);

  reserveDiskUsage(
    session.executionId,
    byteSize,
    `dataset chunk '${session.variableName}'`,
  );

  try {
    await writeFile(filePath, payload, "utf-8");
  } catch (error) {
    releaseDiskUsage(session.executionId, byteSize);
    throw error;
  }
  const rowStart = session.rowCount + 1;
  const rowEnd = rowStart + rows.length - 1;

  const chunkMetadata: DatasetChunkMetadata = {
    chunkIndex,
    fileName,
    rowStart,
    rowEnd,
    rowCount: rows.length,
    cumulativeRowCount: rowEnd,
    byteSize,
    offsetAnchors: buildChunkOffsetAnchors(serializedRows),
    createdAt: new Date().toISOString(),
  };

  session.chunks.push(chunkMetadata);
  session.currentChunkIndex += 1;
  session.rowCount += rows.length;
  session.byteSize += byteSize;
  session.updatedAt = new Date().toISOString();
};

const readChunkByMetadata = async (
  executionId: string,
  datasetId: string,
  chunk: DatasetChunkMetadata,
  schema?: DatasetSchema,
): Promise<DatasetRow[]> => {
  const chunkPath = getDatasetChunkPath(executionId, datasetId, chunk.fileName);
  const content = await readFile(chunkPath, "utf-8");
  return parseJsonlRows(content, chunk.chunkIndex, schema);
};

const readRowsByOffset = async ({
  executionId,
  datasetId,
  chunk,
  offset,
  limit,
  schema,
}: {
  executionId: string;
  datasetId: string;
  chunk: DatasetChunkMetadata;
  offset: number;
  limit: number;
  schema?: DatasetSchema;
}): Promise<DatasetRow[]> => {
  if (limit <= 0 || offset >= chunk.rowCount) {
    return [];
  }

  const chunkPath = getDatasetChunkPath(executionId, datasetId, chunk.fileName);
  const anchor = resolveChunkOffsetAnchor(chunk.offsetAnchors, offset);
  const stream = createReadStream(chunkPath, {
    encoding: "utf-8",
    start: anchor.byteOffset,
  });
  const reader = createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  const rows: DatasetRow[] = [];
  let rowOffset = anchor.rowOffset;

  try {
    for await (const line of reader) {
      if (!line.trim()) {
        continue;
      }

      if (rowOffset >= chunk.rowCount) {
        break;
      }

      if (rowOffset >= offset && rows.length < limit) {
        const parsedRow = parseJsonLine(line, chunk.chunkIndex, rowOffset + 1);
        rows.push(normalizeRowAtReadBoundary(parsedRow, schema));
      }

      rowOffset += 1;

      if (rows.length >= limit) {
        break;
      }
    }
  } finally {
    reader.close();
    stream.destroy();
  }

  return rows;
};

export class JsonlStorageAdapter implements DatasetStorageAdapter {
  readonly storageType = "jsonl" as const;
  readonly capabilities = {
    format: "jsonl" as const,
    supportsStreamingRead: true,
    supportsOffsetRead: true,
    supportsSchemaTypedRows: true,
    experimental: false,
  };
  private readonly manifestCache = new Map<string, DatasetManifest>();

  private getManifestCacheKey(executionId: string, datasetId: string) {
    return `${executionId}:${datasetId}`;
  }

  async beginWrite(options: DatasetWriteOptions): Promise<DatasetWriteSession> {
    const datasetId = options.datasetId ?? randomUUID();
    const createdAt = new Date().toISOString();
    const transaction = createWriteTransaction({
      executionId: options.executionId,
      datasetId,
    });

    await rm(transaction.tempDirectory, { recursive: true, force: true });
    await ensureDirectory(transaction.tempDirectory);

    return {
      datasetId,
      executionId: options.executionId,
      variableName: options.variableName,
      chunkSize: Math.max(1, options.chunkSize),
      schema: options.schema,
      createdAt,
      updatedAt: createdAt,
      tempDirectory: transaction.tempDirectory,
      finalDirectory: transaction.finalDirectory,
      currentChunkIndex: 0,
      currentChunkRows: [],
      rowCount: 0,
      byteSize: 0,
      chunks: [],
    };
  }

  async appendRows(
    session: DatasetWriteSession,
    rows: DatasetRow[],
  ): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    session.currentChunkRows.push(...rows);

    while (session.currentChunkRows.length >= session.chunkSize) {
      const batch = session.currentChunkRows.splice(0, session.chunkSize);
      await flushChunk(session, batch);
    }
  }

  async commitWrite(session: DatasetWriteSession): Promise<DatasetManifest> {
    if (session.currentChunkRows.length > 0) {
      const remaining = session.currentChunkRows.splice(
        0,
        session.currentChunkRows.length,
      );
      await flushChunk(session, remaining);
    }

    const manifest: DatasetManifest = {
      version: DATASET_MANIFEST_VERSION,
      storage: "jsonl",
      datasetId: session.datasetId,
      executionId: session.executionId,
      variableName: session.variableName,
      ownership: {
        executionId: session.executionId,
        variableName: session.variableName,
      },
      createdAt: session.createdAt,
      updatedAt: new Date().toISOString(),
      rowCount: session.rowCount,
      chunkCount: session.chunks.length,
      byteSize: session.byteSize,
      schema: session.schema,
      chunks: session.chunks,
    };

    const manifestPath = join(session.tempDirectory, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");

    await commitWriteTransaction({
      executionId: session.executionId,
      datasetId: session.datasetId,
      tempDirectory: session.tempDirectory,
      finalDirectory: session.finalDirectory,
    });

    this.manifestCache.set(
      this.getManifestCacheKey(session.executionId, session.datasetId),
      manifest,
    );

    return manifest;
  }

  async abortWrite(session: DatasetWriteSession): Promise<void> {
    await rollbackWriteTransaction({
      executionId: session.executionId,
      datasetId: session.datasetId,
      tempDirectory: session.tempDirectory,
      finalDirectory: session.finalDirectory,
    });
  }

  async getManifest(
    executionId: string,
    datasetId: string,
  ): Promise<DatasetManifest> {
    const cacheKey = this.getManifestCacheKey(executionId, datasetId);
    const cachedManifest = this.manifestCache.get(cacheKey);

    if (cachedManifest) {
      return cachedManifest;
    }

    const manifestPath = getDatasetManifestPath(executionId, datasetId);
    const rawManifest = await readFile(manifestPath, "utf-8");

    const manifest = JSON.parse(rawManifest) as DatasetManifest;

    if (manifest.version !== DATASET_MANIFEST_VERSION) {
      throw new Error(
        `Unsupported dataset manifest version: ${manifest.version}. Expected ${DATASET_MANIFEST_VERSION}.`,
      );
    }

    const normalizedChunks = normalizeChunkMetadata(manifest.chunks);
    const normalizedManifest: DatasetManifest = {
      ...manifest,
      rowCount:
        normalizedChunks[normalizedChunks.length - 1]?.cumulativeRowCount ?? 0,
      chunkCount: normalizedChunks.length,
      chunks: normalizedChunks,
    };

    this.manifestCache.set(cacheKey, normalizedManifest);

    return normalizedManifest;
  }

  async readChunk(
    executionId: string,
    datasetId: string,
    chunkIndex: number,
  ): Promise<DatasetChunkResult> {
    const manifest = await this.getManifest(executionId, datasetId);
    const chunk = getChunkByIndex(manifest.chunks, chunkIndex);

    if (!chunk) {
      throw new Error(
        `Chunk ${chunkIndex} does not exist for dataset ${datasetId}.`,
      );
    }

    const rows = await readChunkByMetadata(
      executionId,
      datasetId,
      chunk,
      manifest.schema,
    );

    return {
      chunk,
      rows,
    };
  }

  async readRows(
    executionId: string,
    datasetId: string,
    chunkIndex: number,
    offset: number,
    limit: number,
  ): Promise<DatasetRowsResult> {
    const manifest = await this.getManifest(executionId, datasetId);
    const chunk = getChunkByIndex(manifest.chunks, chunkIndex);

    if (!chunk) {
      throw new Error(
        `Chunk ${chunkIndex} does not exist for dataset ${datasetId}.`,
      );
    }

    const safeOffset = Math.max(0, offset);
    const safeLimit = Math.max(0, limit);
    const rows = await readRowsByOffset({
      executionId,
      datasetId,
      chunk,
      offset: safeOffset,
      limit: safeLimit,
      schema: manifest.schema,
    });

    return {
      chunk,
      offset: safeOffset,
      limit: safeLimit,
      totalRows: chunk.rowCount,
      rows,
    };
  }

  async *streamRows(
    executionId: string,
    datasetId: string,
  ): AsyncGenerator<DatasetRow, void, void> {
    const manifest = await this.getManifest(executionId, datasetId);
    const chunks = manifest.chunks;

    // Read-ahead window: while processing chunk N, the next PREFETCH chunks
    // are already being read from disk concurrently.  This hides per-file
    // open/close latency (especially significant on cloud-synced or slow
    // storage) without holding more than PREFETCH × chunkSize in memory.
    const PREFETCH = 4;
    const pending = new Map<number, Promise<string>>();

    const kickPrefetch = (i: number): void => {
      const chunk = chunks[i];
      if (!chunk || pending.has(i)) return;
      const path = getDatasetChunkPath(executionId, datasetId, chunk.fileName);
      pending.set(i, readFile(path, "utf-8"));
    };

    // Seed the initial window.
    for (let i = 0; i < Math.min(PREFETCH, chunks.length); i++) {
      kickPrefetch(i);
    }

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk) continue;

      // Extend the window one step ahead.
      kickPrefetch(i + PREFETCH);

      // Await the prefetched content (usually already ready).
      const chunkPath = getDatasetChunkPath(
        executionId,
        datasetId,
        chunk.fileName,
      );
      const content = await (pending.get(i) ?? readFile(chunkPath, "utf-8"));
      pending.delete(i);

      let lineNumber = 0;
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        lineNumber += 1;
        const parsedRow = parseJsonLine(line, chunk.chunkIndex, lineNumber);
        yield normalizeRowAtReadBoundary(parsedRow, manifest.schema);
      }
    }
  }
}
