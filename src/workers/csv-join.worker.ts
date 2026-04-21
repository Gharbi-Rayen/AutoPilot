/**
 * CSV Join — Browser Web Worker (streaming left side)
 * Supports inner, left, right, full (union) and cross joins.
 *
 * Memory model: the RIGHT dataset is loaded into a hash map (it should be the
 * smaller/lookup side). The LEFT dataset is streamed chunk by chunk.
 * Output is written via ChunkedOPFSWriter — never accumulates all result rows.
 */

import { createId } from "@paralleldrive/cuid2";
import type { WorkerJobMessage, WorkerOutboundMessage } from "@/lib/worker-manager";
import { DATASET_MANIFEST_VERSION, type DatasetRef, type DatasetRow } from "@/types/dataset";
import { ChunkedOPFSWriter, readChunkFromOPFS, readFromOPFS } from "./_opfs-helpers";

type JoinType = "inner" | "left" | "right" | "full" | "cross";

self.onmessage = async (event: MessageEvent<WorkerJobMessage>) => {
  const { jobId, input } = event.data;
  const { leftRef, rightRef, joinType = "inner", leftKey, rightKey, executionId, variableName, chunkSize = 10_000 } = input as {
    leftRef: DatasetRef;
    rightRef: DatasetRef;
    joinType?: JoinType;
    leftKey?: string;
    rightKey?: string;
    executionId: string;
    variableName: string;
    chunkSize?: number;
  };

  const post = (msg: WorkerOutboundMessage) => self.postMessage(msg);

  try {
    // Load the right (lookup) side into memory — it is expected to be the smaller dataset
    post({ kind: "progress", jobId, progress: 5, message: "Loading lookup side..." });
    const right = await readFromOPFS(rightRef.executionId, rightRef.datasetId, rightRef.chunkCount);

    const datasetId = createId();
    const writer = new ChunkedOPFSWriter(executionId, datasetId, chunkSize);
    await writer.init();

    if (joinType === "cross") {
      // Cross join: stream left, multiply against every right row
      for (let c = 0; c < leftRef.chunkCount; c++) {
        const leftChunk = await readChunkFromOPFS(leftRef.executionId, leftRef.datasetId, c);
        const batch: DatasetRow[] = [];
        for (const l of leftChunk) for (const r of right) batch.push({ ...l, ...r });
        await writer.write(batch);
        post({ kind: "progress", jobId, progress: Math.round(10 + ((c + 1) / leftRef.chunkCount) * 80), message: "Joining..." });
      }
    } else {
      // Build hash map from right side
      const rightMap = new Map<string, DatasetRow[]>();
      for (const r of right) {
        const key = rightKey ? String(r[rightKey] ?? "") : JSON.stringify(r);
        const bucket = rightMap.get(key);
        if (bucket) bucket.push(r);
        else rightMap.set(key, [r]);
      }

      const matchedRightKeys = new Set<string>();

      // Stream left side
      for (let c = 0; c < leftRef.chunkCount; c++) {
        const leftChunk = await readChunkFromOPFS(leftRef.executionId, leftRef.datasetId, c);
        const batch: DatasetRow[] = [];
        for (const l of leftChunk) {
          const key = leftKey ? String(l[leftKey] ?? "") : JSON.stringify(l);
          const matches = rightMap.get(key) ?? [];
          if (matches.length > 0) {
            for (const r of matches) { batch.push({ ...l, ...r }); matchedRightKeys.add(key); }
          } else if (joinType === "left" || joinType === "full") {
            batch.push({ ...l });
          }
        }
        await writer.write(batch);
        post({ kind: "progress", jobId, progress: Math.round(10 + ((c + 1) / leftRef.chunkCount) * 75), message: "Joining..." });
      }

      // For right/full join: append unmatched right rows
      if (joinType === "right" || joinType === "full") {
        const unmatched: DatasetRow[] = [];
        for (const r of right) {
          const key = rightKey ? String(r[rightKey] ?? "") : JSON.stringify(r);
          if (!matchedRightKeys.has(key)) unmatched.push({ ...r });
        }
        await writer.write(unmatched);
      }
    }

    post({ kind: "progress", jobId, progress: 93, message: "Finalizing..." });
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
