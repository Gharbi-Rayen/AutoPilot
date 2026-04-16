/**
 * CSV Join — Browser Web Worker
 * Supports inner, left, right, full (union) and cross joins.
 */

import { createId } from "@paralleldrive/cuid2";
import type { WorkerJobMessage, WorkerOutboundMessage } from "@/lib/worker-manager";
import type { DatasetRow, DatasetRef } from "@/types/dataset";
import { DATASET_MANIFEST_VERSION } from "@/types/dataset";
import { readFromOPFS, writeToOPFS } from "./_opfs-helpers";

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
    post({ kind: "progress", jobId, progress: 10, message: "Reading left..." });
    const left = await readFromOPFS(leftRef.executionId, leftRef.datasetId, leftRef.chunkCount);
    post({ kind: "progress", jobId, progress: 30, message: "Reading right..." });
    const right = await readFromOPFS(rightRef.executionId, rightRef.datasetId, rightRef.chunkCount);
    post({ kind: "progress", jobId, progress: 50, message: "Joining..." });

    let result: DatasetRow[] = [];

    if (joinType === "cross") {
      for (const l of left) for (const r of right) result.push({ ...l, ...r });
    } else {
      const rightMap = new Map<string, DatasetRow[]>();
      for (const r of right) {
        const key = rightKey ? String(r[rightKey] ?? "") : JSON.stringify(r);
        if (!rightMap.has(key)) rightMap.set(key, []);
        rightMap.get(key)!.push(r);
      }
      const matchedRightKeys = new Set<string>();

      for (const l of left) {
        const key = leftKey ? String(l[leftKey] ?? "") : JSON.stringify(l);
        const matches = rightMap.get(key) ?? [];
        if (matches.length > 0) {
          for (const r of matches) { result.push({ ...l, ...r }); matchedRightKeys.add(key); }
        } else if (joinType === "left" || joinType === "full") {
          result.push({ ...l });
        }
      }

      if (joinType === "right" || joinType === "full") {
        for (const r of right) {
          const key = rightKey ? String(r[rightKey] ?? "") : JSON.stringify(r);
          if (!matchedRightKeys.has(key)) result.push({ ...r });
        }
      }
    }

    post({ kind: "progress", jobId, progress: 75, message: "Writing..." });
    const datasetId = createId();
    const { chunks, totalBytes } = await writeToOPFS(executionId, datasetId, result, chunkSize);
    const now = new Date().toISOString();
    const manifest = { version: DATASET_MANIFEST_VERSION, datasetId, executionId, variableName, createdAt: now, updatedAt: now, rowCount: result.length, chunkCount: chunks.length, byteSize: totalBytes, chunks };
    const datasetRef: DatasetRef = { kind: "dataset", datasetId, executionId, variableName, rowCount: result.length, chunkCount: chunks.length, byteSize: totalBytes };
    post({ kind: "result", jobId, output: { manifest, datasetRef } });
  } catch (err) { post({ kind: "error", jobId, error: String(err) }); }
};
export {};
