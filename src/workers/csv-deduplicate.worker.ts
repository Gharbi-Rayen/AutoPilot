/**
 * CSV Deduplicate — Browser Web Worker
 */

import { createId } from "@paralleldrive/cuid2";
import type { WorkerJobMessage, WorkerOutboundMessage } from "@/lib/worker-manager";
import type { DatasetRow, DatasetRef } from "@/types/dataset";
import { DATASET_MANIFEST_VERSION } from "@/types/dataset";
import { readFromOPFS, writeToOPFS } from "./_opfs-helpers";

self.onmessage = async (event: MessageEvent<WorkerJobMessage>) => {
  const { jobId, input } = event.data;
  const { inputRef, keyFields, executionId, variableName, chunkSize = 10_000 } = input as {
    inputRef: DatasetRef;
    keyFields: string[];
    executionId: string;
    variableName: string;
    chunkSize?: number;
  };
  const post = (msg: WorkerOutboundMessage) => self.postMessage(msg);
  try {
    post({ kind: "progress", jobId, progress: 10, message: "Reading..." });
    const rows = await readFromOPFS(inputRef.executionId, inputRef.datasetId, inputRef.chunkCount);
    post({ kind: "progress", jobId, progress: 50, message: "Deduplicating..." });

    const seen = new Set<string>();
    const deduped: DatasetRow[] = [];
    for (const row of rows) {
      const key = keyFields.length > 0
        ? keyFields.map((f) => String(row[f] ?? "")).join("|")
        : JSON.stringify(row);
      if (!seen.has(key)) { seen.add(key); deduped.push(row); }
    }

    post({ kind: "progress", jobId, progress: 75, message: "Writing..." });
    const datasetId = createId();
    const { chunks, totalBytes } = await writeToOPFS(executionId, datasetId, deduped, chunkSize);
    const now = new Date().toISOString();
    const manifest = { version: DATASET_MANIFEST_VERSION, datasetId, executionId, variableName, createdAt: now, updatedAt: now, rowCount: deduped.length, chunkCount: chunks.length, byteSize: totalBytes, schema: inputRef.schema, chunks };
    const datasetRef: DatasetRef = { kind: "dataset", datasetId, executionId, variableName, rowCount: deduped.length, chunkCount: chunks.length, byteSize: totalBytes, schema: inputRef.schema };
    post({ kind: "result", jobId, output: { manifest, datasetRef, removedCount: rows.length - deduped.length } });
  } catch (err) { post({ kind: "error", jobId, error: String(err) }); }
};
export {};
