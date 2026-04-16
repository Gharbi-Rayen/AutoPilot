/**
 * CSV Column Stats — Browser Web Worker
 * Computes per-column statistics (min, max, mean, nulls, unique count).
 */

import type { WorkerJobMessage, WorkerOutboundMessage } from "@/lib/worker-manager";
import type { DatasetRow, DatasetRef } from "@/types/dataset";
import { readFromOPFS } from "./_opfs-helpers";

interface ColumnStat {
  field: string;
  type: string;
  count: number;
  nullCount: number;
  uniqueCount: number;
  min?: number | string;
  max?: number | string;
  mean?: number;
  sampleValues: string[];
}

self.onmessage = async (event: MessageEvent<WorkerJobMessage>) => {
  const { jobId, input } = event.data;
  const { inputRef } = input as { inputRef: DatasetRef };
  const post = (msg: WorkerOutboundMessage) => self.postMessage(msg);
  try {
    post({ kind: "progress", jobId, progress: 10, message: "Reading..." });
    const rows = await readFromOPFS(inputRef.executionId, inputRef.datasetId, inputRef.chunkCount);
    post({ kind: "progress", jobId, progress: 50, message: "Computing stats..." });

    if (rows.length === 0) { post({ kind: "result", jobId, output: { stats: [] } }); return; }

    const fields = Object.keys(rows[0]);
    const stats: ColumnStat[] = fields.map((field) => {
      const vals = rows.map((r) => r[field]);
      const nonNull = vals.filter((v) => v !== null && v !== undefined && v !== "");
      const nums = nonNull.map(Number).filter((n) => !Number.isNaN(n));
      const unique = new Set(vals.map(String));
      const schemaType = inputRef.schema?.[field]?.type ?? "string";
      const stat: ColumnStat = {
        field,
        type: schemaType,
        count: vals.length,
        nullCount: vals.length - nonNull.length,
        uniqueCount: unique.size,
        sampleValues: [...new Set(nonNull.slice(0, 5).map(String))],
      };
      if (nums.length > 0) {
        stat.min = Math.min(...nums);
        stat.max = Math.max(...nums);
        stat.mean = nums.reduce((a, b) => a + b, 0) / nums.length;
      } else if (nonNull.length > 0) {
        const sorted = nonNull.map(String).sort();
        stat.min = sorted[0];
        stat.max = sorted[sorted.length - 1];
      }
      return stat;
    });

    post({ kind: "result", jobId, output: { stats, rowCount: rows.length } });
  } catch (err) { post({ kind: "error", jobId, error: String(err) }); }
};
export {};
