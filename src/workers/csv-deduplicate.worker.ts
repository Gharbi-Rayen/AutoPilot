/**
 * CSV Deduplicate — Browser Web Worker
 *
 * Two-pass algorithm:
 *   Pass 1: stream all chunks → build counts: Map<key, number>
 *   Pass 2: stream again → emit first occurrence to dedup output;
 *           emit {value, count} to report output when count ≥ 2
 *
 * Memory: O(distinct keys) for both the counts map and the seen set.
 * Output: deduplicated dataset + always a _report dataset (value | count).
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

    // ── Pass 2: emit first occurrence + build report ─────────────────────────
    post({ kind: "progress", jobId, progress: 47, message: "Writing deduplicated rows..." });

    const dedupId = createId();
    const reportId = createId();
    const dedupWriter = new ChunkedOPFSWriter(executionId, dedupId, chunkSize);
    const reportWriter = new ChunkedOPFSWriter(executionId, reportId, chunkSize);
    await Promise.all([dedupWriter.init(), reportWriter.init()]);

    const seen = new Set<string>();

    for (let c = 0; c < inputRef.chunkCount; c++) {
      const chunk = await readChunkFromOPFS(inputRef.executionId, inputRef.datasetId, c);
      for (const row of chunk) {
        const key = computeKey(row);
        if (seen.has(key)) continue;
        seen.add(key);

        await dedupWriter.write([row]);

        const count = counts.get(key) ?? 1;
        if (count >= 2) {
          const reportRow: DatasetRow = column
            ? { [column]: key, count }
            : { ...row, count };
          await reportWriter.write([reportRow]);
        }
      }
      const pct = Math.round(47 + ((c + 1) / inputRef.chunkCount) * 43);
      post({ kind: "progress", jobId, progress: pct, message: `Processed ${((c + 1) * chunkSize).toLocaleString()} rows...` });
    }

    post({ kind: "progress", jobId, progress: 93, message: "Writing..." });
    const [dedupResult, reportResult] = await Promise.all([dedupWriter.finish(), reportWriter.finish()]);

    const now = new Date().toISOString();
    const reportVarName = `${variableName}_report`;

    const dedupManifest = {
      version: DATASET_MANIFEST_VERSION, datasetId: dedupId, executionId, variableName,
      createdAt: now, updatedAt: now, rowCount: dedupResult.totalRows, chunkCount: dedupResult.chunks.length,
      byteSize: dedupResult.totalBytes, schema: inputRef.schema, chunks: dedupResult.chunks,
    };
    const dedupRef: DatasetRef = {
      kind: "dataset", datasetId: dedupId, executionId, variableName,
      rowCount: dedupResult.totalRows, chunkCount: dedupResult.chunks.length,
      byteSize: dedupResult.totalBytes, schema: inputRef.schema,
    };

    const reportManifest = {
      version: DATASET_MANIFEST_VERSION, datasetId: reportId, executionId, variableName: reportVarName,
      createdAt: now, updatedAt: now, rowCount: reportResult.totalRows, chunkCount: reportResult.chunks.length,
      byteSize: reportResult.totalBytes, chunks: reportResult.chunks,
    };
    const reportRef: DatasetRef = {
      kind: "dataset", datasetId: reportId, executionId, variableName: reportVarName,
      rowCount: reportResult.totalRows, chunkCount: reportResult.chunks.length,
      byteSize: reportResult.totalBytes,
    };

    post({
      kind: "result", jobId,
      output: {
        datasetRef: dedupRef,
        manifest: dedupManifest,
        reportRef,
        reportManifest,
        duplicateCount: reportResult.totalRows,
        removedCount: totalRows - dedupResult.totalRows,
      },
    });
  } catch (err) {
    post({ kind: "error", jobId, error: String(err) });
  }
};
