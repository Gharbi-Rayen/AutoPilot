/**
 * CSV Aggregate — Browser Web Worker
 * Groups rows by key fields and computes aggregations.
 */

import { createId } from "@paralleldrive/cuid2";
import type { WorkerJobMessage, WorkerOutboundMessage } from "@/lib/worker-manager";
import type { DatasetRow, DatasetRef } from "@/types/dataset";
import { DATASET_MANIFEST_VERSION } from "@/types/dataset";
import { readFromOPFS, writeToOPFS } from "./_opfs-helpers";

type AggFunc = "sum" | "avg" | "min" | "max" | "count" | "count_distinct" | "first" | "last";

interface Aggregation {
  field: string;
  func: AggFunc;
  alias?: string;
}

self.onmessage = async (event: MessageEvent<WorkerJobMessage>) => {
  const { jobId, input } = event.data;
  const { inputRef, groupByFields, aggregations, executionId, variableName, chunkSize = 10_000 } = input as {
    inputRef: DatasetRef;
    groupByFields: string[];
    aggregations: Aggregation[];
    executionId: string;
    variableName: string;
    chunkSize?: number;
  };
  const post = (msg: WorkerOutboundMessage) => self.postMessage(msg);
  try {
    post({ kind: "progress", jobId, progress: 10, message: "Reading..." });
    const rows = await readFromOPFS(inputRef.executionId, inputRef.datasetId, inputRef.chunkCount);
    post({ kind: "progress", jobId, progress: 50, message: "Aggregating..." });

    const groups = new Map<string, DatasetRow[]>();
    for (const row of rows) {
      const key = groupByFields.map((f) => String(row[f] ?? "")).join("|");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }

    const result: DatasetRow[] = [];
    for (const [, groupRows] of groups) {
      const out: DatasetRow = {};
      for (const f of groupByFields) out[f] = groupRows[0][f];
      for (const agg of aggregations) {
        const alias = agg.alias ?? `${agg.func}_${agg.field}`;
        const vals = groupRows.map((r) => r[agg.field]);
        const nums = vals.map(Number).filter((n) => !Number.isNaN(n));
        switch (agg.func) {
          case "sum": out[alias] = nums.reduce((a, b) => a + b, 0); break;
          case "avg": out[alias] = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null; break;
          case "min": out[alias] = nums.length ? Math.min(...nums) : null; break;
          case "max": out[alias] = nums.length ? Math.max(...nums) : null; break;
          case "count": out[alias] = groupRows.length; break;
          case "count_distinct": out[alias] = new Set(vals.map(String)).size; break;
          case "first": out[alias] = vals[0] ?? null; break;
          case "last": out[alias] = vals[vals.length - 1] ?? null; break;
        }
      }
      result.push(out);
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
