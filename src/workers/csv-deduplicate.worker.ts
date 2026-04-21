/**
 * CSV Deduplicate — Browser Web Worker (streaming)
 * Processes OPFS chunks one at a time, maintaining only a Set of seen keys
 * in memory rather than all rows.
 */

import { createId } from "@paralleldrive/cuid2";
import type { WorkerJobMessage, WorkerOutboundMessage } from "@/lib/worker-manager";
import { DATASET_MANIFEST_VERSION, type DatasetRef } from "@/types/dataset";
import { ChunkedOPFSWriter, readChunkFromOPFS } from "./_opfs-helpers";

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
    const datasetId = createId();
    const writer = new ChunkedOPFSWriter(executionId, datasetId, chunkSize);
    await writer.init();

    const seen = new Set<string>();
    let totalInputRows = 0;

    for (let c = 0; c < inputRef.chunkCount; c++) {
      const chunk = await readChunkFromOPFS(inputRef.executionId, inputRef.datasetId, c);
      totalInputRows += chunk.length;

      const deduped = chunk.filter((row) => {
        const key = keyFields.length > 0
          ? keyFields.map((f) => String(row[f] ?? "")).join("|")
          : JSON.stringify(row);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      await writer.write(deduped);

      const pct = Math.round(10 + ((c + 1) / inputRef.chunkCount) * 80);
      post({ kind: "progress", jobId, progress: pct, message: `Processed ${totalInputRows.toLocaleString()} rows...` });
    }

    post({ kind: "progress", jobId, progress: 93, message: "Writing..." });
    const { chunks, totalBytes, totalRows } = await writer.finish();

    const now = new Date().toISOString();
    const manifest = {
      version: DATASET_MANIFEST_VERSION, datasetId, executionId, variableName,
      createdAt: now, updatedAt: now, rowCount: totalRows, chunkCount: chunks.length,
      byteSize: totalBytes, schema: inputRef.schema, chunks,
    };
    const datasetRef: DatasetRef = {
      kind: "dataset", datasetId, executionId, variableName,
      rowCount: totalRows, chunkCount: chunks.length, byteSize: totalBytes, schema: inputRef.schema,
    };

    post({ kind: "result", jobId, output: { manifest, datasetRef, removedCount: totalInputRows - totalRows } });
  } catch (err) {
    post({ kind: "error", jobId, error: String(err) });
  }
};
