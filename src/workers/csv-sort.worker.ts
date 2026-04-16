/**
 * CSV Sort — Browser Web Worker
 */

import { createId } from "@paralleldrive/cuid2";
import type { WorkerJobMessage, WorkerOutboundMessage } from "@/lib/worker-manager";
import type { DatasetRow, DatasetRef } from "@/types/dataset";
import { DATASET_MANIFEST_VERSION } from "@/types/dataset";

async function readFromOPFS(executionId: string, datasetId: string, chunkCount: number): Promise<DatasetRow[]> {
  const opfsRoot = await navigator.storage.getDirectory();
  const dir = await opfsRoot
    .getDirectoryHandle("autopilot", { create: false })
    .then(a => a.getDirectoryHandle("executions", { create: false }))
    .then(e => e.getDirectoryHandle(executionId, { create: false }))
    .then(ex => ex.getDirectoryHandle(datasetId, { create: false }));
  const rows: DatasetRow[] = [];
  for (let i = 0; i < chunkCount; i++) {
    const fh = await dir.getFileHandle(`chunk-${String(i).padStart(6, "0")}.json`);
    rows.push(...(JSON.parse(await (await fh.getFile()).text()) as DatasetRow[]));
  }
  return rows;
}

async function writeToOPFS(executionId: string, datasetId: string, rows: DatasetRow[], chunkSize = 10_000) {
  const opfsRoot = await navigator.storage.getDirectory();
  const dir = await opfsRoot
    .getDirectoryHandle("autopilot", { create: true })
    .then(a => a.getDirectoryHandle("executions", { create: true }))
    .then(e => e.getDirectoryHandle(executionId, { create: true }))
    .then(ex => ex.getDirectoryHandle(datasetId, { create: true }));
  const chunks = []; let cum = 0; let totalBytes = 0; const now = new Date().toISOString();
  for (let i = 0; i * chunkSize < rows.length || (i === 0 && !rows.length); i++) {
    const c = rows.slice(i * chunkSize, (i + 1) * chunkSize); if (!c.length) break;
    const fn = `chunk-${String(i).padStart(6, "0")}.json`;
    const bytes = new TextEncoder().encode(JSON.stringify(c));
    const w = await (await dir.getFileHandle(fn, { create: true })).createWritable();
    await w.write(bytes); await w.close();
    cum += c.length; totalBytes += bytes.byteLength;
    chunks.push({ chunkIndex: i, fileName: fn, rowStart: i * chunkSize, rowEnd: i * chunkSize + c.length - 1, rowCount: c.length, cumulativeRowCount: cum, byteSize: bytes.byteLength, createdAt: now });
  }
  return { chunks, totalBytes };
}

self.onmessage = async (event: MessageEvent<WorkerJobMessage>) => {
  const { jobId, input } = event.data;
  const { inputRef, sortColumns, executionId, variableName, chunkSize = 10_000 } = input as {
    inputRef: DatasetRef;
    sortColumns: { field: string; direction: "asc" | "desc" }[];
    executionId: string;
    variableName: string;
    chunkSize?: number;
  };
  const post = (msg: WorkerOutboundMessage) => self.postMessage(msg);
  try {
    post({ kind: "progress", jobId, progress: 10, message: "Reading..." });
    const rows = await readFromOPFS(inputRef.executionId, inputRef.datasetId, inputRef.chunkCount);
    post({ kind: "progress", jobId, progress: 50, message: "Sorting..." });
    rows.sort((a, b) => {
      for (const { field, direction } of sortColumns) {
        const av = a[field]; const bv = b[field];
        const cmp = av === bv ? 0 : av == null ? -1 : bv == null ? 1 : String(av) < String(bv) ? -1 : 1;
        if (cmp !== 0) return direction === "asc" ? cmp : -cmp;
      }
      return 0;
    });
    post({ kind: "progress", jobId, progress: 75, message: "Writing..." });
    const datasetId = createId();
    const { chunks, totalBytes } = await writeToOPFS(executionId, datasetId, rows, chunkSize);
    const now = new Date().toISOString();
    const manifest = { version: DATASET_MANIFEST_VERSION, datasetId, executionId, variableName, createdAt: now, updatedAt: now, rowCount: rows.length, chunkCount: chunks.length, byteSize: totalBytes, schema: inputRef.schema, chunks };
    const datasetRef: DatasetRef = { kind: "dataset", datasetId, executionId, variableName, rowCount: rows.length, chunkCount: chunks.length, byteSize: totalBytes, schema: inputRef.schema };
    post({ kind: "result", jobId, output: { manifest, datasetRef } });
  } catch (err) { post({ kind: "error", jobId, error: String(err) }); }
};
export {};
