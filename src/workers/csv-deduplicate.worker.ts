/**
 * CSV Deduplicate — Browser Web Worker
 *
 * Two-pass algorithm:
 *   Pass 1: stream all chunks → build counts: Map<key, number>
 *   Pass 2: stream again → emit first occurrence to unique output;
 *           emit duplicate rows with {count} when count ≥ 2
 *
 * Memory: O(distinct keys) for both the counts map and the seen set.
 * Output: duplicate dataset (primary) + unique dataset (secondary).
 */

import { createId } from "@paralleldrive/cuid2";
import type { WorkerJobMessage, WorkerOutboundMessage } from "@/lib/worker-manager";
import { DATASET_MANIFEST_VERSION, type DatasetRef, type DatasetRow } from "@/types/dataset";
import { ChunkedOPFSWriter, readChunkFromOPFS } from "./_opfs-helpers";

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
