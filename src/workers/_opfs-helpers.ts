/**
 * Shared OPFS helpers for browser workers.
 * Kept minimal — no imports from @/ aliases (workers load standalone).
 */

import type { DatasetRow } from "@/types/dataset";

async function getDatasetDir(
  executionId: string,
  datasetId: string,
  create = false,
): Promise<FileSystemDirectoryHandle> {
  const opfsRoot = await navigator.storage.getDirectory();
  return opfsRoot
    .getDirectoryHandle("autopilot", { create })
    .then((a) => a.getDirectoryHandle("executions", { create }))
    .then((e) => e.getDirectoryHandle(executionId, { create }))
    .then((ex) => ex.getDirectoryHandle(datasetId, { create }));
}

export async function readChunkFromOPFS(
  executionId: string,
  datasetId: string,
  chunkIndex: number,
): Promise<DatasetRow[]> {
  const dir = await getDatasetDir(executionId, datasetId, false);
  const fileName = `chunk-${String(chunkIndex).padStart(6, "0")}.json`;
  const fh = await dir.getFileHandle(fileName);
  return JSON.parse(await (await fh.getFile()).text()) as DatasetRow[];
}

export async function readFromOPFS(
  executionId: string,
  datasetId: string,
  chunkCount: number,
): Promise<DatasetRow[]> {
  const rows: DatasetRow[] = [];
  for (let i = 0; i < chunkCount; i++) {
    const chunk = await readChunkFromOPFS(executionId, datasetId, i);
    for (const row of chunk) rows.push(row);
  }
  return rows;
}

export async function writeToOPFS(
  executionId: string,
  datasetId: string,
  rows: DatasetRow[],
  chunkSize = 10_000,
) {
  const dir = await getDatasetDir(executionId, datasetId, true);

  const chunks = [];
  let cum = 0;
  let totalBytes = 0;
  const now = new Date().toISOString();

  for (
    let i = 0;
    i * chunkSize < rows.length || (i === 0 && rows.length === 0);
    i++
  ) {
    const c = rows.slice(i * chunkSize, (i + 1) * chunkSize);
    if (!c.length) break;
    const fn = `chunk-${String(i).padStart(6, "0")}.json`;
    const bytes = new TextEncoder().encode(JSON.stringify(c));
    const w = await (await dir.getFileHandle(fn, { create: true })).createWritable();
    await w.write(bytes);
    await w.close();
    cum += c.length;
    totalBytes += bytes.byteLength;
    chunks.push({
      chunkIndex: i,
      fileName: fn,
      rowStart: i * chunkSize,
      rowEnd: i * chunkSize + c.length - 1,
      rowCount: c.length,
      cumulativeRowCount: cum,
      byteSize: bytes.byteLength,
      createdAt: now,
    });
  }
  return { chunks, totalBytes };
}

/**
 * Streaming OPFS writer — accepts rows incrementally and flushes to OPFS in
 * chunkSize batches.  Call `finish()` to flush the final partial batch and
 * get the manifest chunks + byte totals.
 *
 * Usage:
 *   const writer = new ChunkedOPFSWriter(executionId, datasetId, chunkSize);
 *   await writer.init();
 *   for (const rows of ...) await writer.write(rows);
 *   const { chunks, totalBytes, totalRows } = await writer.finish();
 */
export type OPFSChunkMeta = {
  chunkIndex: number;
  fileName: string;
  rowStart: number;
  rowEnd: number;
  rowCount: number;
  cumulativeRowCount: number;
  byteSize: number;
  createdAt: string;
};

export async function deleteDatasetFromOPFS(
  executionId: string,
  datasetId: string,
): Promise<void> {
  try {
    const opfsRoot = await navigator.storage.getDirectory();
    const execDir = await opfsRoot
      .getDirectoryHandle("autopilot", { create: false })
      .then((a) => a.getDirectoryHandle("executions", { create: false }))
      .then((e) => e.getDirectoryHandle(executionId, { create: false }));
    await execDir.removeEntry(datasetId, { recursive: true });
  } catch {
    // already gone or never existed — ignore
  }
}

export class ChunkedOPFSWriter {
  private dir!: FileSystemDirectoryHandle;
  private buffer: DatasetRow[] = [];
  private chunkIndex = 0;
  private totalRows = 0;
  private totalBytes = 0;
  private readonly chunks: OPFSChunkMeta[] = [];
  private readonly createdAt = new Date().toISOString();

  constructor(
    private readonly executionId: string,
    private readonly datasetId: string,
    private readonly chunkSize = 10_000,
  ) {}

  async init(): Promise<void> {
    this.dir = await getDatasetDir(this.executionId, this.datasetId, true);
  }

  async write(rows: DatasetRow[]): Promise<void> {
    // Avoid large spread calls; they can overflow the JS call stack on big datasets.
    for (const row of rows) this.buffer.push(row);
    while (this.buffer.length >= this.chunkSize) {
      await this._flush(this.buffer.splice(0, this.chunkSize));
    }
  }

  async forceFlush(): Promise<void> {
    if (this.buffer.length > 0) await this._flush(this.buffer.splice(0));
  }

  async finish(): Promise<{ chunks: OPFSChunkMeta[]; totalBytes: number; totalRows: number }> {
    if (this.buffer.length > 0) await this._flush(this.buffer);
    this.buffer = [];
    return { chunks: this.chunks, totalBytes: this.totalBytes, totalRows: this.totalRows };
  }

  private async _flush(rows: DatasetRow[]): Promise<void> {
    const fn = `chunk-${String(this.chunkIndex).padStart(6, "0")}.json`;
    const bytes = new TextEncoder().encode(JSON.stringify(rows));
    const w = await (await this.dir.getFileHandle(fn, { create: true })).createWritable();
    await w.write(bytes);
    await w.close();
    this.chunks.push({
      chunkIndex: this.chunkIndex,
      fileName: fn,
      rowStart: this.totalRows,
      rowEnd: this.totalRows + rows.length - 1,
      rowCount: rows.length,
      cumulativeRowCount: this.totalRows + rows.length,
      byteSize: bytes.byteLength,
      createdAt: this.createdAt,
    });
    this.totalBytes += bytes.byteLength;
    this.totalRows += rows.length;
    this.chunkIndex++;
  }
}
