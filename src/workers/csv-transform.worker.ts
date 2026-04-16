/**
 * CSV Transform — Browser Web Worker
 * Applies column renames, additions, deletions, and value expressions.
 */

import { createId } from "@paralleldrive/cuid2";
import type { WorkerJobMessage, WorkerOutboundMessage } from "@/lib/worker-manager";
import type { DatasetRow, DatasetRef } from "@/types/dataset";
import { DATASET_MANIFEST_VERSION } from "@/types/dataset";
import { readFromOPFS, writeToOPFS } from "./_opfs-helpers";

type TransformOp =
  | { op: "rename"; from: string; to: string }
  | { op: "add"; field: string; expression: string }
  | { op: "remove"; field: string }
  | { op: "set"; field: string; value: string };

function applyOp(row: DatasetRow, op: TransformOp): DatasetRow {
  const next = { ...row };
  switch (op.op) {
    case "rename": { const v = next[op.from]; delete next[op.from]; next[op.to] = v; break; }
    case "remove": delete next[op.field]; break;
    case "set": next[op.field] = op.value; break;
    case "add": {
      try {
        // Simple expression: allow access to row fields by name
        const fn = new Function(...Object.keys(row), `return ${op.expression}`);
        next[op.field] = fn(...Object.values(row));
      } catch { next[op.field] = null; }
      break;
    }
  }
  return next;
}

self.onmessage = async (event: MessageEvent<WorkerJobMessage>) => {
  const { jobId, input } = event.data;
  const { inputRef, operations, executionId, variableName, chunkSize = 10_000 } = input as {
    inputRef: DatasetRef;
    operations: TransformOp[];
    executionId: string;
    variableName: string;
    chunkSize?: number;
  };
  const post = (msg: WorkerOutboundMessage) => self.postMessage(msg);
  try {
    post({ kind: "progress", jobId, progress: 10, message: "Reading..." });
    const rows = await readFromOPFS(inputRef.executionId, inputRef.datasetId, inputRef.chunkCount);
    post({ kind: "progress", jobId, progress: 50, message: "Transforming..." });
    const transformed = rows.map((row) => operations.reduce(applyOp, row));
    post({ kind: "progress", jobId, progress: 75, message: "Writing..." });
    const datasetId = createId();
    const { chunks, totalBytes } = await writeToOPFS(executionId, datasetId, transformed, chunkSize);
    const now = new Date().toISOString();
    const manifest = { version: DATASET_MANIFEST_VERSION, datasetId, executionId, variableName, createdAt: now, updatedAt: now, rowCount: transformed.length, chunkCount: chunks.length, byteSize: totalBytes, chunks };
    const datasetRef: DatasetRef = { kind: "dataset", datasetId, executionId, variableName, rowCount: transformed.length, chunkCount: chunks.length, byteSize: totalBytes };
    post({ kind: "result", jobId, output: { manifest, datasetRef } });
  } catch (err) { post({ kind: "error", jobId, error: String(err) }); }
};
export {};
