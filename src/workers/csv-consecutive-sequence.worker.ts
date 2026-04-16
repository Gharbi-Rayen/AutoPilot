/**
 * CSV Consecutive Sequence Analyzer — Browser Web Worker
 * Detects gaps and consecutive runs in a numeric/date field.
 */

import { createId } from "@paralleldrive/cuid2";
import type { WorkerJobMessage, WorkerOutboundMessage } from "@/lib/worker-manager";
import type { DatasetRow, DatasetRef } from "@/types/dataset";
import { DATASET_MANIFEST_VERSION } from "@/types/dataset";
import { readFromOPFS, writeToOPFS } from "./_opfs-helpers";

self.onmessage = async (event: MessageEvent<WorkerJobMessage>) => {
  const { jobId, input } = event.data;
  const { inputRef, sequenceField, groupByField, executionId, variableName, chunkSize = 10_000 } = input as {
    inputRef: DatasetRef;
    sequenceField: string;
    groupByField?: string;
    executionId: string;
    variableName: string;
    chunkSize?: number;
  };
  const post = (msg: WorkerOutboundMessage) => self.postMessage(msg);
  try {
    post({ kind: "progress", jobId, progress: 10, message: "Reading..." });
    const rows = await readFromOPFS(inputRef.executionId, inputRef.datasetId, inputRef.chunkCount);
    post({ kind: "progress", jobId, progress: 50, message: "Analyzing sequences..." });

    const groups = new Map<string, DatasetRow[]>();
    for (const row of rows) {
      const key = groupByField ? String(row[groupByField] ?? "") : "__all__";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }

    const result: DatasetRow[] = [];
    for (const [groupKey, groupRows] of groups) {
      const nums = groupRows
        .map((r) => ({ row: r, val: Number(r[sequenceField]) }))
        .filter((x) => !Number.isNaN(x.val))
        .sort((a, b) => a.val - b.val);

      for (let i = 0; i < nums.length; i++) {
        const prev = i > 0 ? nums[i - 1].val : null;
        const curr = nums[i].val;
        const gap = prev !== null ? curr - prev - 1 : 0;
        result.push({
          ...nums[i].row,
          _sequence_value: curr,
          _previous_value: prev,
          _gap_size: gap,
          _has_gap: gap > 0,
          _group: groupKey === "__all__" ? undefined : groupKey,
        });
      }
    }

    post({ kind: "progress", jobId, progress: 75, message: "Writing..." });
    const datasetId = createId();
    const { chunks, totalBytes } = await writeToOPFS(executionId, datasetId, result, chunkSize);
    const gapCount = result.filter((r) => r._has_gap).length;
    const now = new Date().toISOString();
    const manifest = { version: DATASET_MANIFEST_VERSION, datasetId, executionId, variableName, createdAt: now, updatedAt: now, rowCount: result.length, chunkCount: chunks.length, byteSize: totalBytes, chunks };
    const datasetRef: DatasetRef = { kind: "dataset", datasetId, executionId, variableName, rowCount: result.length, chunkCount: chunks.length, byteSize: totalBytes };
    post({ kind: "result", jobId, output: { manifest, datasetRef, gapCount, totalRows: result.length } });
  } catch (err) { post({ kind: "error", jobId, error: String(err) }); }
};
export {};
