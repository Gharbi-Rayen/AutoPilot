/**
 * FILE: src/workers/csv-aggregate.worker.ts
 *
 * PURPOSE:
 *   Groups rows by one or more key columns and computes aggregation functions
 *   (sum, avg, min, max, count, count_distinct, first, last) per group.
 *   Streams OPFS chunks into running per-group accumulators — never holds all
 *   rows in memory at once.  Only the accumulator Map (one entry per unique group)
 *   grows with data; the actual row data is processed and discarded chunk by chunk.
 *
 * WHAT IS AGGREGATION?
 *   Aggregation collapses many rows into fewer summary rows.
 *   Example: a sales table with 1 million rows, one per transaction,
 *   aggregated by "Region" → one output row per region showing total sales.
 *   This is equivalent to SQL's GROUP BY with aggregate functions:
 *     SELECT Region, SUM(Sales), COUNT(*) FROM table GROUP BY Region
 *
 * WHAT IS A STREAMING ACCUMULATOR?
 *   Instead of loading all rows and then grouping, we process one chunk at a time.
 *   For each row, we find or create an accumulator for its group key, then update
 *   the running statistics (sum, count, etc.) in that accumulator.
 *   When all chunks are processed, each accumulator holds the final aggregated values.
 *
 * WHAT IS A MAP?
 *   A JavaScript Map stores key-value pairs.  Here:
 *     Key: the group key string (e.g. "North|Electronics")
 *     Value: an Accumulator object holding running stats for that group
 *   Map.get(key) is O(1) — fast lookups even with millions of distinct groups.
 *   Note: if there are too many distinct groups, the Map itself can use significant RAM.
 *
 * AGGREGATION FUNCTIONS:
 *   sum            — total of all numeric values (non-numbers treated as 0)
 *   avg            — sum / count of numeric values
 *   min / max      — smallest/largest numeric value seen
 *   count          — total row count in the group
 *   count_distinct — number of unique values (capped at COUNT_DISTINCT_CAP to prevent OOM)
 *   first          — value from the first row in the group
 *   last           — value from the most recent row in the group
 *
 * INPUT (from WorkerJobMessage.input):
 *   inputRef       — DatasetRef of the dataset to aggregate
 *   groupByFields  — column names to group by (e.g. ["Region", "Category"])
 *   aggregations   — array of { field, func, alias? }
 *   executionId    — current execution's ID
 *   variableName   — context key for the output dataset
 *   chunkSize      — rows per output chunk (from performance settings)
 *
 * OUTPUT:
 *   manifest   — DatasetManifest for the aggregated output (one row per group)
 *   datasetRef — DatasetRef for the aggregated output
 *
 * USED IN:
 *   src/features/executions/components/csv-aggregate/executor.ts
 */

import { createId } from "@paralleldrive/cuid2";
import type { WorkerJobMessage, WorkerOutboundMessage } from "@/lib/worker-manager";
import { DATASET_MANIFEST_VERSION, type DatasetRef, type DatasetRow } from "@/types/dataset";
import { readChunkFromOPFS, writeToOPFS } from "./_opfs-helpers";

/**
 * AggFunc
 *
 * WHY THIS EXISTS:
 *   A union type of all supported aggregation function names.
 *   Used as the type for Aggregation.func to prevent invalid function names.
 *
 * USED IN:
 *   Aggregation.func — the function to apply to the field
 *   Accumulator      — separate storage per function type (sums, counts, etc.)
 *   The switch statement in the message handler
 */
type AggFunc = "sum" | "avg" | "min" | "max" | "count" | "count_distinct" | "first" | "last";

/**
 * Aggregation
 *
 * WHY THIS EXISTS:
 *   Describes one aggregation to compute: which field, which function, optional alias.
 *   The worker receives an array of these from the main thread (from the node's config).
 *
 * FIELD MEANINGS:
 *   field — the column to aggregate (e.g. "Sales")
 *   func  — which aggregation to apply (e.g. "sum")
 *   alias — the output column name (default: "<func>_<field>", e.g. "sum_Sales")
 *
 * USED IN:
 *   The accumulator update loop and result-building loop
 */
interface Aggregation {
  field: string;
  func: AggFunc;
  alias?: string;
}

/**
 * COUNT_DISTINCT_CAP
 *
 * WHY THIS EXISTS:
 *   count_distinct uses a Set to count unique values.  If a column has 10 million
 *   distinct values, the Set would hold 10 million strings — potentially 500 MB+ of RAM.
 *   This cap limits the Set to 100 000 entries.  When the cap is reached, the output
 *   shows "≥100000" instead of an exact count.
 *
 * USED IN:
 *   The count_distinct case in the accumulator update and result-building loops
 */
const COUNT_DISTINCT_CAP = 100_000;

/**
 * Accumulator
 *
 * WHY THIS EXISTS:
 *   Holds all running statistics for one group during the streaming pass.
 *   One Accumulator exists per unique group key in the accumulators Map.
 *   After processing all chunks, each Accumulator is converted to one output row.
 *
 * FIELD MEANINGS:
 *   groupValues — the group-by column values (included in the output row as-is)
 *   sums        — running sum per aggregation alias (for sum, avg)
 *   counts      — per-aggregation row count (used only for "count" func)
 *   numCounts   — count of numeric rows per alias (for avg denominator)
 *   mins/maxs   — running min/max per alias (for min/max func)
 *   firsts      — value of the first row seen per alias (for first func)
 *   lasts       — value of the most recent row per alias (for last func)
 *   distincts   — Set of unique values per alias (for count_distinct)
 *   rowCount    — total rows in this group (used for "count" func)
 *
 * USED IN:
 *   accumulators Map — values are Accumulator instances
 *   The per-row update switch statement
 *   The result-building loop after all chunks are processed
 */
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

/**
 * self.onmessage — worker entry point
 *
 * ALGORITHM (two logical phases, one pass through the data):
 *
 * PHASE 1 — Streaming accumulation:
 *   For each chunk in the input dataset:
 *     For each row in the chunk:
 *       1. Build the group key: join groupByFields values with "|" separator.
 *          Example: { Region: "North", Category: "Electronics" } → "North|Electronics"
 *       2. If no Accumulator exists for this key, create one.
 *       3. Update the Accumulator for each requested aggregation.
 *
 * PHASE 2 — Result building:
 *   For each Accumulator in the Map:
 *     Build one output row:
 *       - Include group-by column values
 *       - Compute final values: avg = sum/numCount, count_distinct = Set.size (or "≥cap"), etc.
 *
 * PHASE 3 — Write:
 *   Use writeToOPFS() to write all result rows to OPFS at once.
 *   (Result set is small — one row per group — so all-at-once is safe.)
 *
 * WHAT IS `acc.sums[alias] = (acc.sums[alias] ?? 0) + (isNum ? num : 0)`?
 *   `?? 0` — if sums[alias] is undefined (first row for this group), use 0 as the base.
 *   `isNum ? num : 0` — if the value is not a number (NaN), add 0 (don't corrupt the sum).
 */
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
