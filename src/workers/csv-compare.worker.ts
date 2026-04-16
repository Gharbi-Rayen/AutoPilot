/**
 * CSV Compare — Browser Web Worker
 * Compares two datasets by key fields and reports added/removed/changed rows.
 */

import { createId } from "@paralleldrive/cuid2";
import type { WorkerJobMessage, WorkerOutboundMessage } from "@/lib/worker-manager";
import type { DatasetRow, DatasetRef } from "@/types/dataset";
import { DATASET_MANIFEST_VERSION } from "@/types/dataset";
import { readFromOPFS, writeToOPFS } from "./_opfs-helpers";

self.onmessage = async (event: MessageEvent<WorkerJobMessage>) => {
  const { jobId, input } = event.data;
  const { baseRef, compareRef, keyFields, executionId, variableName, chunkSize = 10_000 } = input as {
    baseRef: DatasetRef;
    compareRef: DatasetRef;
    keyFields: string[];
    executionId: string;
    variableName: string;
    chunkSize?: number;
  };
  const post = (msg: WorkerOutboundMessage) => self.postMessage(msg);
  try {
    post({ kind: "progress", jobId, progress: 10, message: "Reading base..." });
    const base = await readFromOPFS(baseRef.executionId, baseRef.datasetId, baseRef.chunkCount);
    post({ kind: "progress", jobId, progress: 30, message: "Reading compare..." });
    const compare = await readFromOPFS(compareRef.executionId, compareRef.datasetId, compareRef.chunkCount);
    post({ kind: "progress", jobId, progress: 50, message: "Comparing..." });

    const rowKey = (r: DatasetRow) => keyFields.map((f) => String(r[f] ?? "")).join("|");
    const baseMap = new Map(base.map((r) => [rowKey(r), r]));
    const compareMap = new Map(compare.map((r) => [rowKey(r), r]));

    const added: DatasetRow[] = [];
    const removed: DatasetRow[] = [];
    const changed: DatasetRow[] = [];

    for (const [key, row] of compareMap) {
      if (!baseMap.has(key)) { added.push({ ...row, _diff: "added" }); }
      else if (JSON.stringify(row) !== JSON.stringify(baseMap.get(key))) { changed.push({ ...row, _diff: "changed" }); }
    }
    for (const [key, row] of baseMap) {
      if (!compareMap.has(key)) removed.push({ ...row, _diff: "removed" });
    }

    const diffRows = [...added, ...removed, ...changed];
    post({ kind: "progress", jobId, progress: 75, message: "Writing diff..." });
    const datasetId = createId();
    const { chunks, totalBytes } = await writeToOPFS(executionId, datasetId, diffRows, chunkSize);
    const now = new Date().toISOString();
    const manifest = { version: DATASET_MANIFEST_VERSION, datasetId, executionId, variableName, createdAt: now, updatedAt: now, rowCount: diffRows.length, chunkCount: chunks.length, byteSize: totalBytes, chunks };
    const datasetRef: DatasetRef = { kind: "dataset", datasetId, executionId, variableName, rowCount: diffRows.length, chunkCount: chunks.length, byteSize: totalBytes };
    post({ kind: "result", jobId, output: { manifest, datasetRef, summary: { added: added.length, removed: removed.length, changed: changed.length, unchanged: base.length - removed.length - changed.length } } });
  } catch (err) { post({ kind: "error", jobId, error: String(err) }); }
};
export {};
