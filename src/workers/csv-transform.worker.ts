/**
 * CSV Transform — Browser Web Worker (streaming)
 * Applies column renames, additions, deletions, and value expressions.
 * Processes OPFS chunks one at a time — never loads the full dataset into memory.
 */

import { createId } from "@paralleldrive/cuid2";
import type { WorkerJobMessage, WorkerOutboundMessage } from "@/lib/worker-manager";
import { DATASET_MANIFEST_VERSION, type DatasetRef, type DatasetRow } from "@/types/dataset";
import { ChunkedOPFSWriter, readChunkFromOPFS } from "./_opfs-helpers";

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
    const datasetId = createId();
    const writer = new ChunkedOPFSWriter(executionId, datasetId, chunkSize);
    await writer.init();

    for (let c = 0; c < inputRef.chunkCount; c++) {
      const chunk = await readChunkFromOPFS(inputRef.executionId, inputRef.datasetId, c);
      await writer.write(chunk.map((row) => operations.reduce(applyOp, row)));
      const pct = Math.round(10 + ((c + 1) / inputRef.chunkCount) * 80);
      post({ kind: "progress", jobId, progress: pct, message: `Transformed ${(c + 1) * chunkSize} rows...` });
    }

    post({ kind: "progress", jobId, progress: 93, message: "Writing..." });
    const { chunks, totalBytes, totalRows } = await writer.finish();

    const now = new Date().toISOString();
    const manifest = {
      version: DATASET_MANIFEST_VERSION, datasetId, executionId, variableName,
      createdAt: now, updatedAt: now, rowCount: totalRows, chunkCount: chunks.length,
      byteSize: totalBytes, chunks,
    };
    const datasetRef: DatasetRef = {
      kind: "dataset", datasetId, executionId, variableName,
      rowCount: totalRows, chunkCount: chunks.length, byteSize: totalBytes,
    };

    post({ kind: "result", jobId, output: { manifest, datasetRef } });
  } catch (err) {
    post({ kind: "error", jobId, error: String(err) });
  }
};
