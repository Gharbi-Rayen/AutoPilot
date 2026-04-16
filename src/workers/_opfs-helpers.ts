/**
 * Shared OPFS helpers for browser workers.
 * Kept minimal — no imports from @/ aliases (workers load standalone).
 */

import type { DatasetRow } from "@/types/dataset";


export async function readFromOPFS(
  executionId: string,
  datasetId: string,
  chunkCount: number,
): Promise<DatasetRow[]> {
  const opfsRoot = await navigator.storage.getDirectory();
  const dir = await opfsRoot
    .getDirectoryHandle("autopilot", { create: false })
    .then((a) => a.getDirectoryHandle("executions", { create: false }))
    .then((e) => e.getDirectoryHandle(executionId, { create: false }))
    .then((ex) => ex.getDirectoryHandle(datasetId, { create: false }));

  const rows: DatasetRow[] = [];
  for (let i = 0; i < chunkCount; i++) {
    const fh = await dir.getFileHandle(
      `chunk-${String(i).padStart(6, "0")}.json`,
    );
    rows.push(...(JSON.parse(await (await fh.getFile()).text()) as DatasetRow[]));
  }
  return rows;
}

export async function writeToOPFS(
  executionId: string,
  datasetId: string,
  rows: DatasetRow[],
  chunkSize = 10_000,
) {
  const opfsRoot = await navigator.storage.getDirectory();
  const dir = await opfsRoot
    .getDirectoryHandle("autopilot", { create: true })
    .then((a) => a.getDirectoryHandle("executions", { create: true }))
    .then((e) => e.getDirectoryHandle(executionId, { create: true }))
    .then((ex) => ex.getDirectoryHandle(datasetId, { create: true }));

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
