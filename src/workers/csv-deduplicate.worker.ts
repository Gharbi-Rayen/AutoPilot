/**
 * FILE: src/workers/csv-deduplicate.worker.ts
 *
 * PURPOSE:
 *   Removes duplicate rows from a dataset.  Duplicates are identified either
 *   by the value in a single specified column, or by the entire row's contents.
 *   Produces TWO output datasets: one containing unique rows, one containing
 *   the duplicate rows (with a "count" column showing how many times each appeared).
 *
 * WHAT IS DEDUPLICATION?
 *   Deduplication means removing rows that appear more than once.
 *   Example: a contacts list where "Alice" appears 3 times → keep one Alice, discard two.
 *   The "unique" output contains one occurrence of each row (first occurrence).
 *   The "duplicates" output contains rows that appeared more than once, with a count.
 *
 * TWO-PASS ALGORITHM:
 *   Pass 1 — Build counts:
 *     Stream all chunks, compute a key for each row (column value or full row JSON),
 *     and count how many times each key appears.  Stores only key → count pairs in RAM.
 *
 *   Pass 2 — Emit unique and duplicate rows:
 *     Stream all chunks again.  For each row, if its key has not been seen before:
 *       - Add to unique output.
 *       - If the count >= 2, also add to duplicates output (with the count field).
 *
 * WHY TWO PASSES?
 *   To know which rows are "duplicate" (count >= 2), we need to see ALL rows first.
 *   We can't emit a row as "duplicate" during Pass 1 because we don't know the final count yet.
 *   The two-pass approach streams the data twice — each pass uses O(1) RAM per row.
 *
 * MEMORY MODEL:
 *   counts Map: O(distinct keys) entries.
 *   seen Set:   O(distinct keys) entries.
 *   Both hold only key strings, not the rows themselves.
 *   If there are 1 million distinct rows, this is ~1 million strings × ~50 bytes = ~50 MB.
 *
 * WHAT IS A SET?
 *   A Set is a collection of unique values.  Checking if a key has been seen before:
 *     seen.has(key) → true or false (O(1) lookup)
 *     seen.add(key) → adds the key (O(1))
 *   Unlike an array (which would need O(n) linear search), Set lookups are O(1).
 *
 * INPUT (from WorkerJobMessage.input):
 *   inputRef    — DatasetRef of the dataset to deduplicate
 *   column      — column name to use as the dedup key (empty = full-row equality)
 *   executionId — current execution's ID
 *   variableName — context key for the PRIMARY output (duplicates dataset)
 *   chunkSize   — rows per output chunk
 *
 * OUTPUT:
 *   duplicatesRef     — DatasetRef for the duplicate rows dataset (primary output)
 *   duplicatesManifest — manifest for duplicates
 *   uniqueRef         — DatasetRef for the unique rows dataset (secondary output)
 *   uniqueManifest    — manifest for unique rows
 *   duplicateCount    — number of rows in the duplicates output
 *   removedCount      — number of rows removed (totalRows - uniqueCount)
 *
 * USED IN:
 *   src/features/executions/components/csv-deduplicate/executor.ts
 */

import { createId } from "@paralleldrive/cuid2";
import type { WorkerJobMessage, WorkerOutboundMessage } from "@/lib/worker-manager";
import { DATASET_MANIFEST_VERSION, type DatasetRef, type DatasetRow } from "@/types/dataset";
import { ChunkedOPFSWriter, readChunkFromOPFS } from "./_opfs-helpers";

/**
 * self.onmessage — worker entry point
 *
 * KEY VARIABLES:
 *   computeKey(row) — returns the dedup key string for a row.
 *                     If `column` is set: String(row[column]).
 *                     If not set: JSON.stringify(row) — full-row equality.
 *
 *   counts Map — key → number of times this key appears in the full dataset.
 *                Built in Pass 1.
 *
 *   seen Set   — keys that have already been emitted to the unique output.
 *                Used in Pass 2 to emit only the FIRST occurrence.
 *
 *   uniqueWriter / duplicatesWriter — two ChunkedOPFSWriters running in parallel,
 *                one for unique rows and one for duplicate rows.
 *
 * WHY `Promise.all([uniqueWriter.init(), duplicatesWriter.init()])`?
 *   Both init() calls open an OPFS directory — they are independent and can run
 *   concurrently.  Promise.all() starts both Promises at the same time and waits
 *   until BOTH are done.  This is faster than awaiting them sequentially.
 *
 * DUPLICATE ROW FORMAT:
 *   If deduplicating by column: { [column]: value, count: N }
 *   If deduplicating by full row: { ...row, count: N }
 *   The "count" field shows how many times that row appeared in the input.
 */
self.onmessage = async (event: MessageEvent<WorkerJobMessage>) => {
  const { jobId, input } = event.data;
  const {
    inputRef,
    column = "",        // single column name; empty = full-row key
    executionId,
    variableName,
    chunkSize = 10_000,
  } = input as {
    inputRef: DatasetRef;
    column?: string;
    executionId: string;
    variableName: string;
    chunkSize?: number;
  };

  const post = (msg: WorkerOutboundMessage) => self.postMessage(msg);

  const computeKey = (row: DatasetRow): string =>
    column ? String(row[column] ?? "") : JSON.stringify(row);

  try {
    // ── Pass 1: count occurrences per key ────────────────────────────────────
    post({ kind: "progress", jobId, progress: 5, message: "Scanning for duplicates..." });

    const counts = new Map<string, number>();
    let totalRows = 0;

    for (let c = 0; c < inputRef.chunkCount; c++) {
      const chunk = await readChunkFromOPFS(inputRef.executionId, inputRef.datasetId, c);
      totalRows += chunk.length;
      for (const row of chunk) {
        const key = computeKey(row);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const pct = Math.round(5 + ((c + 1) / inputRef.chunkCount) * 40);
      post({ kind: "progress", jobId, progress: pct, message: `Scanned ${totalRows.toLocaleString()} rows...` });
    }

    // ── Pass 2: emit first occurrence + build duplicate output ────────────────
    post({ kind: "progress", jobId, progress: 47, message: "Writing duplicate rows..." });

    const uniqueId = createId();
    const duplicatesId = createId();
    const uniqueWriter = new ChunkedOPFSWriter(executionId, uniqueId, chunkSize);
    const duplicatesWriter = new ChunkedOPFSWriter(executionId, duplicatesId, chunkSize);
    await Promise.all([uniqueWriter.init(), duplicatesWriter.init()]);

    const seen = new Set<string>();

    for (let c = 0; c < inputRef.chunkCount; c++) {
      const chunk = await readChunkFromOPFS(inputRef.executionId, inputRef.datasetId, c);
      for (const row of chunk) {
        const key = computeKey(row);
        if (seen.has(key)) continue;
        seen.add(key);

        await uniqueWriter.write([row]);

        const count = counts.get(key) ?? 1;
        if (count >= 2) {
          const duplicateRow: DatasetRow = column
            ? { [column]: row[column] ?? "", count }
            : { ...row, count };
          await duplicatesWriter.write([duplicateRow]);
        }
      }
      const pct = Math.round(47 + ((c + 1) / inputRef.chunkCount) * 43);
      post({ kind: "progress", jobId, progress: pct, message: `Processed ${((c + 1) * chunkSize).toLocaleString()} rows...` });
    }

    post({ kind: "progress", jobId, progress: 93, message: "Writing..." });
    const [uniqueResult, duplicatesResult] = await Promise.all([
      uniqueWriter.finish(),
      duplicatesWriter.finish(),
    ]);

    const now = new Date().toISOString();
    const uniqueVarName = `${variableName}_unique`;
    const duplicateSchema = column
      ? {
          [column]: inputRef.schema?.[column] ?? {
            type: "string" as const,
            nullable: true,
          },
          count: { type: "number" as const, nullable: false },
        }
      : {
          ...(inputRef.schema ?? {}),
          count: { type: "number" as const, nullable: false },
        };

    const uniqueManifest = {
      version: DATASET_MANIFEST_VERSION, datasetId: uniqueId, executionId, variableName: uniqueVarName,
      createdAt: now, updatedAt: now, rowCount: uniqueResult.totalRows, chunkCount: uniqueResult.chunks.length,
      byteSize: uniqueResult.totalBytes, schema: inputRef.schema, chunks: uniqueResult.chunks,
    };
    const uniqueRef: DatasetRef = {
      kind: "dataset", datasetId: uniqueId, executionId, variableName: uniqueVarName,
      rowCount: uniqueResult.totalRows, chunkCount: uniqueResult.chunks.length,
      byteSize: uniqueResult.totalBytes, schema: inputRef.schema,
    };

    const duplicatesManifest = {
      version: DATASET_MANIFEST_VERSION, datasetId: duplicatesId, executionId, variableName,
      createdAt: now, updatedAt: now, rowCount: duplicatesResult.totalRows, chunkCount: duplicatesResult.chunks.length,
      byteSize: duplicatesResult.totalBytes, schema: duplicateSchema, chunks: duplicatesResult.chunks,
    };
    const duplicatesRef: DatasetRef = {
      kind: "dataset", datasetId: duplicatesId, executionId, variableName,
      rowCount: duplicatesResult.totalRows, chunkCount: duplicatesResult.chunks.length,
      byteSize: duplicatesResult.totalBytes, schema: duplicateSchema,
    };

    post({
      kind: "result", jobId,
      output: {
        duplicatesRef,
        duplicatesManifest,
        uniqueRef,
        uniqueManifest,
        duplicateCount: duplicatesResult.totalRows,
        removedCount: totalRows - uniqueResult.totalRows,
      },
    });
  } catch (err) {
    post({ kind: "error", jobId, error: String(err) });
  }
};
