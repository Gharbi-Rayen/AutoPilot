/**
 * OPFS Dataset Manager
 *
 * Stores large CSV/dataset chunks in the Origin Private File System (OPFS).
 * Layout: autopilot/executions/<executionId>/<datasetId>/chunk-<n>.json
 *
 * DatasetRef objects are stored as manifests in IndexedDB (via db.ts).
 * The actual row data lives here, chunked for memory efficiency.
 */

import { createId } from "@paralleldrive/cuid2";
import type {
  DatasetManifest,
  DatasetChunkMetadata,
  DatasetRow,
} from "@/types/dataset";
import { DATASET_MANIFEST_VERSION } from "@/types/dataset";

const ROOT_DIR = "autopilot";
const CHUNK_SIZE_ROWS = 10_000;

async function getRoot(): Promise<FileSystemDirectoryHandle> {
  const opfsRoot = await navigator.storage.getDirectory();
  return opfsRoot.getDirectoryHandle(ROOT_DIR, { create: true });
}

async function getExecutionDir(
  executionId: string,
): Promise<FileSystemDirectoryHandle> {
  const root = await getRoot();
  const execs = await root.getDirectoryHandle("executions", { create: true });
  return execs.getDirectoryHandle(executionId, { create: true });
}

async function getDatasetDir(
  executionId: string,
  datasetId: string,
): Promise<FileSystemDirectoryHandle> {
  const execDir = await getExecutionDir(executionId);
  return execDir.getDirectoryHandle(datasetId, { create: true });
}

/** Write all rows as chunked JSON files. Returns the manifest. */
export async function writeDataset(opts: {
  executionId: string;
  variableName: string;
  rows: DatasetRow[];
  schema?: DatasetManifest["schema"];
  datasetId?: string;
}): Promise<DatasetManifest> {
  const { executionId, variableName, rows, schema } = opts;
  const datasetId = opts.datasetId ?? createId();
  const dir = await getDatasetDir(executionId, datasetId);
  const now = new Date().toISOString();

  const chunks: DatasetChunkMetadata[] = [];
  let cumulativeRows = 0;
  let totalBytes = 0;

  for (let i = 0; i * CHUNK_SIZE_ROWS < rows.length || i === 0; i++) {
    const start = i * CHUNK_SIZE_ROWS;
    const chunkRows = rows.slice(start, start + CHUNK_SIZE_ROWS);
    if (chunkRows.length === 0) break;

    const fileName = `chunk-${String(i).padStart(6, "0")}.json`;
    const text = JSON.stringify(chunkRows);
    const bytes = new TextEncoder().encode(text);

    const fileHandle = await dir.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(bytes);
    await writable.close();

    cumulativeRows += chunkRows.length;
    totalBytes += bytes.byteLength;

    chunks.push({
      chunkIndex: i,
      fileName,
      rowStart: start,
      rowEnd: start + chunkRows.length - 1,
      rowCount: chunkRows.length,
      cumulativeRowCount: cumulativeRows,
      byteSize: bytes.byteLength,
      createdAt: now,
    });
  }

  return {
    version: DATASET_MANIFEST_VERSION,
    datasetId,
    executionId,
    variableName,
    createdAt: now,
    updatedAt: now,
    rowCount: rows.length,
    chunkCount: chunks.length,
    byteSize: totalBytes,
    schema,
    chunks,
  };
}

/** Read all rows from a dataset stored in OPFS. */
export async function readDataset(
  executionId: string,
  datasetId: string,
  manifest: DatasetManifest,
): Promise<DatasetRow[]> {
  const dir = await getDatasetDir(executionId, datasetId);
  const allRows: DatasetRow[] = [];

  for (const chunk of manifest.chunks) {
    const fileHandle = await dir.getFileHandle(chunk.fileName);
    const file = await fileHandle.getFile();
    const text = await file.text();
    const rows = JSON.parse(text) as DatasetRow[];
    allRows.push(...rows);
  }

  return allRows;
}

/** Read a page of rows from a dataset. */
export async function readDatasetPage(
  executionId: string,
  datasetId: string,
  manifest: DatasetManifest,
  page: number,
  pageSize: number,
): Promise<{ rows: DatasetRow[]; totalRows: number; totalPages: number }> {
  const totalRows = manifest.rowCount;
  const totalPages = Math.ceil(totalRows / pageSize);
  const offset = (page - 1) * pageSize;

  // Identify which chunks contain our page window
  const dir = await getDatasetDir(executionId, datasetId);
  const rows: DatasetRow[] = [];
  let collected = 0;
  let skipped = 0;

  for (const chunk of manifest.chunks) {
    if (rows.length >= pageSize) break;
    if (skipped + chunk.rowCount <= offset) {
      skipped += chunk.rowCount;
      continue;
    }

    const fileHandle = await dir.getFileHandle(chunk.fileName);
    const file = await fileHandle.getFile();
    const text = await file.text();
    const chunkRows = JSON.parse(text) as DatasetRow[];

    const chunkOffset = offset - skipped;
    const take = chunkOffset > 0 ? chunkRows.slice(chunkOffset) : chunkRows;
    const needed = pageSize - collected;
    rows.push(...take.slice(0, needed));
    collected += Math.min(take.length, needed);
    skipped += chunk.rowCount;
  }

  return { rows, totalRows, totalPages };
}

/** Delete all files for a dataset. */
export async function deleteDataset(
  executionId: string,
  datasetId: string,
): Promise<void> {
  try {
    const execDir = await getExecutionDir(executionId);
    await execDir.removeEntry(datasetId, { recursive: true });
  } catch {
    // ignore — may already be gone
  }
}

/** Delete all datasets for an execution. */
export async function deleteExecutionDatasets(
  executionId: string,
): Promise<void> {
  try {
    const root = await getRoot();
    const execs = await root.getDirectoryHandle("executions", { create: false });
    await execs.removeEntry(executionId, { recursive: true });
  } catch {
    // ignore
  }
}
