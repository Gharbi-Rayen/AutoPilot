/**
 * CSV Aggregate — Browser Web Worker (streaming)
 * Groups rows by key fields and computes aggregations.
 * Streams OPFS chunks into running per-group accumulators — never loads all
 * rows into memory simultaneously.
 */

import { createId } from "@paralleldrive/cuid2";
import type { WorkerJobMessage, WorkerOutboundMessage } from "@/lib/worker-manager";
import { DATASET_MANIFEST_VERSION, type DatasetRef, type DatasetRow } from "@/types/dataset";
import { readChunkFromOPFS, writeToOPFS } from "./_opfs-helpers";

type AggFunc = "sum" | "avg" | "min" | "max" | "count" | "count_distinct" | "first" | "last";

interface Aggregation {
  field: string;
  func: AggFunc;
  alias?: string;
}

const COUNT_DISTINCT_CAP = 100_000;

type Accumulator = {
  groupValues: Record<string, unknown>;
  sums: Record<string, number>;
  counts: Record<string, number>;
  numCounts: Record<string, number>;
  mins: Record<string, number>;
  maxs: Record<string, number>;
  firsts: Record<string, unknown>;
  lasts: Record<string, unknown>;
  distincts: Record<string, Set<string>>;
  rowCount: number;
};

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
    post({ kind: "progress", jobId, progress: 5, message: "Aggregating..." });

    const accumulators = new Map<string, Accumulator>();

    for (let c = 0; c < inputRef.chunkCount; c++) {
      const chunk = await readChunkFromOPFS(inputRef.executionId, inputRef.datasetId, c);

      for (const row of chunk) {
        const key = groupByFields.map((f) => String(row[f] ?? "")).join("|");

        if (!accumulators.has(key)) {
          const groupValues: Record<string, unknown> = {};
          for (const f of groupByFields) groupValues[f] = row[f];
          accumulators.set(key, {
            groupValues,
            sums: {}, counts: {}, numCounts: {},
            mins: {}, maxs: {}, firsts: {}, lasts: {}, distincts: {},
            rowCount: 0,
          });
        }

        const acc = accumulators.get(key);
        if (!acc) continue;
        acc.rowCount++;

        for (const agg of aggregations) {
          const alias = agg.alias ?? `${agg.func}_${agg.field}`;
          const raw = row[agg.field];
          const num = Number(raw);
          const isNum = !Number.isNaN(num);

          switch (agg.func) {
            case "sum":
              acc.sums[alias] = (acc.sums[alias] ?? 0) + (isNum ? num : 0);
              break;
            case "avg":
              acc.sums[alias] = (acc.sums[alias] ?? 0) + (isNum ? num : 0);
              acc.numCounts[alias] = (acc.numCounts[alias] ?? 0) + (isNum ? 1 : 0);
              break;
            case "count":
              acc.counts[alias] = (acc.counts[alias] ?? 0) + 1;
              break;
            case "count_distinct":
              if (!acc.distincts[alias]) acc.distincts[alias] = new Set<string>();
              if (acc.distincts[alias].size < COUNT_DISTINCT_CAP) acc.distincts[alias].add(String(raw ?? ""));
              break;
            case "min":
              if (isNum) acc.mins[alias] = acc.mins[alias] === undefined ? num : Math.min(acc.mins[alias], num);
              break;
            case "max":
              if (isNum) acc.maxs[alias] = acc.maxs[alias] === undefined ? num : Math.max(acc.maxs[alias], num);
              break;
            case "first":
              if (acc.firsts[alias] === undefined) acc.firsts[alias] = raw;
              break;
            case "last":
              acc.lasts[alias] = raw;
              break;
          }
        }
      }

      const pct = Math.round(5 + ((c + 1) / inputRef.chunkCount) * 65);
      post({ kind: "progress", jobId, progress: pct, message: `Processed ${(c + 1) * chunkSize} rows...` });
    }

    post({ kind: "progress", jobId, progress: 72, message: "Building result..." });

    const result: DatasetRow[] = [];
    for (const acc of accumulators.values()) {
      const out: DatasetRow = { ...acc.groupValues };
      for (const agg of aggregations) {
        const alias = agg.alias ?? `${agg.func}_${agg.field}`;
        switch (agg.func) {
          case "sum": out[alias] = acc.sums[alias] ?? 0; break;
          case "avg": out[alias] = acc.numCounts[alias] ? acc.sums[alias] / acc.numCounts[alias] : null; break;
          case "count": out[alias] = acc.rowCount; break;
          case "count_distinct": {
            const s = acc.distincts[alias];
            out[alias] = s ? (s.size >= COUNT_DISTINCT_CAP ? `≥${COUNT_DISTINCT_CAP}` : s.size) : 0;
            break;
          }
          case "min": out[alias] = acc.mins[alias] ?? null; break;
          case "max": out[alias] = acc.maxs[alias] ?? null; break;
          case "first": out[alias] = acc.firsts[alias] ?? null; break;
          case "last": out[alias] = acc.lasts[alias] ?? null; break;
        }
      }
      result.push(out);
    }

    post({ kind: "progress", jobId, progress: 82, message: "Writing..." });
    const datasetId = createId();
    const { chunks, totalBytes } = await writeToOPFS(executionId, datasetId, result, chunkSize);

    const now = new Date().toISOString();
    const manifest = {
      version: DATASET_MANIFEST_VERSION, datasetId, executionId, variableName,
      createdAt: now, updatedAt: now, rowCount: result.length, chunkCount: chunks.length,
      byteSize: totalBytes, chunks,
    };
    const datasetRef: DatasetRef = {
      kind: "dataset", datasetId, executionId, variableName,
      rowCount: result.length, chunkCount: chunks.length, byteSize: totalBytes,
    };

    post({ kind: "result", jobId, output: { manifest, datasetRef } });
  } catch (err) {
    post({ kind: "error", jobId, error: String(err) });
  }
};
