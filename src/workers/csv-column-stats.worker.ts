/**
 * CSV Column Stats — Browser Web Worker (streaming)
 * Computes per-column statistics (min, max, mean, nulls, unique count).
 * Streams OPFS chunks into running accumulators — never loads all rows.
 */

import type { WorkerJobMessage, WorkerOutboundMessage } from "@/lib/worker-manager";
import type { DatasetRef } from "@/types/dataset";
import { readChunkFromOPFS } from "./_opfs-helpers";

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
    post({ kind: "progress", jobId, progress: 5, message: "Computing stats..." });

    if (inputRef.chunkCount === 0) {
      post({ kind: "result", jobId, output: { stats: [], rowCount: 0 } });
      return;
    }

    // Read first chunk to get field names
    const firstChunk = await readChunkFromOPFS(inputRef.executionId, inputRef.datasetId, 0);
    if (firstChunk.length === 0) {
      post({ kind: "result", jobId, output: { stats: [], rowCount: 0 } });
      return;
    }

    const fields = Object.keys(firstChunk[0]);

    type FieldAcc = {
      count: number;
      nullCount: number;
      numSum: number;
      numCount: number;
      numMin: number;
      numMax: number;
      strMin: string;
      strMax: string;
      hasNums: boolean;
      hasStrs: boolean;
      uniques: Set<string>;
      samples: string[];
    };

    const accs = new Map<string, FieldAcc>();
    for (const f of fields) {
      accs.set(f, {
        count: 0, nullCount: 0, numSum: 0, numCount: 0,
        numMin: Number.POSITIVE_INFINITY, numMax: Number.NEGATIVE_INFINITY,
        strMin: "", strMax: "", hasNums: false, hasStrs: false,
        uniques: new Set<string>(), samples: [],
      });
    }

    let totalRows = 0;

    for (let c = 0; c < inputRef.chunkCount; c++) {
      const chunk = c === 0 ? firstChunk : await readChunkFromOPFS(inputRef.executionId, inputRef.datasetId, c);
      totalRows += chunk.length;

      for (const row of chunk) {
        for (const f of fields) {
          const acc = accs.get(f);
          if (!acc) continue;
          const raw = row[f];
          const isNull = raw === null || raw === undefined || raw === "";
          acc.count++;
          if (isNull) { acc.nullCount++; continue; }
          const str = String(raw);
          acc.uniques.add(str);
          if (acc.samples.length < 5 && !acc.samples.includes(str)) acc.samples.push(str);
          const num = Number(raw);
          if (!Number.isNaN(num)) {
            acc.hasNums = true;
            acc.numSum += num;
            acc.numCount++;
            if (num < acc.numMin) acc.numMin = num;
            if (num > acc.numMax) acc.numMax = num;
          } else {
            acc.hasStrs = true;
            if (!acc.strMin || str < acc.strMin) acc.strMin = str;
            if (!acc.strMax || str > acc.strMax) acc.strMax = str;
          }
        }
      }

      const pct = Math.round(5 + ((c + 1) / inputRef.chunkCount) * 85);
      post({ kind: "progress", jobId, progress: pct, message: `Processed ${totalRows.toLocaleString()} rows...` });
    }

    const stats: ColumnStat[] = fields.map((f) => {
      const acc = accs.get(f);
      if (!acc) return { field: f, type: "string", count: 0, nullCount: 0, uniqueCount: 0, sampleValues: [] };
      const schemaType = inputRef.schema?.[f]?.type ?? "string";
      const stat: ColumnStat = {
        field: f, type: schemaType,
        count: acc.count, nullCount: acc.nullCount,
        uniqueCount: acc.uniques.size, sampleValues: acc.samples,
      };
      if (acc.hasNums && acc.numCount > 0) {
        stat.min = acc.numMin;
        stat.max = acc.numMax;
        stat.mean = acc.numSum / acc.numCount;
      } else if (acc.hasStrs) {
        stat.min = acc.strMin;
        stat.max = acc.strMax;
      }
      return stat;
    });

    post({ kind: "result", jobId, output: { stats, rowCount: totalRows } });
  } catch (err) {
    post({ kind: "error", jobId, error: String(err) });
  }
};
