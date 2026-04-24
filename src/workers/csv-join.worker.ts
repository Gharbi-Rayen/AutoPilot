/**
 * CSV Join — Browser Web Worker (streaming left side)
 * Supports inner, left, right, full (union) and cross joins.
 *
 * Memory model:
 *   - Small right side (≤ PARTITION_THRESHOLD rows): load into hash map, stream left.
 *   - Large right side (> PARTITION_THRESHOLD rows): grace hash join — partition both
 *     datasets by hash(joinKey) % K into OPFS temp files, then join each partition
 *     pair (peak memory ≈ right / K rows per partition).
 *   - Cross join: right is always fully loaded (output is left × right anyway).
 */

import { createId } from "@paralleldrive/cuid2";
import type { WorkerJobMessage, WorkerOutboundMessage } from "@/lib/worker-manager";
import { DATASET_MANIFEST_VERSION, type DatasetRef, type DatasetRow } from "@/types/dataset";
import { ChunkedOPFSWriter, deleteDatasetFromOPFS, readChunkFromOPFS, readFromOPFS } from "./_opfs-helpers";

type JoinType = "inner" | "left" | "right" | "full" | "cross";

const PARTITION_THRESHOLD = 500_000;

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h;
}

function partIdx(key: string, K: number): number {
  return Math.abs(djb2(key)) % K;
}

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

  const rowKeyLeft  = (r: DatasetRow) => leftKey  ? String(r[leftKey]  ?? "") : JSON.stringify(r);
  const rowKeyRight = (r: DatasetRow) => rightKey ? String(r[rightKey] ?? "") : JSON.stringify(r);

  try {
    const datasetId = createId();
    const writer = new ChunkedOPFSWriter(executionId, datasetId, chunkSize);
    await writer.init();

    if (joinType === "cross") {
      // Cross join: always load right in full, stream left
      post({ kind: "progress", jobId, progress: 5, message: "Loading lookup side..." });
      const right = await readFromOPFS(rightRef.executionId, rightRef.datasetId, rightRef.chunkCount);
      for (let c = 0; c < leftRef.chunkCount; c++) {
        const leftChunk = await readChunkFromOPFS(leftRef.executionId, leftRef.datasetId, c);
        const batch: DatasetRow[] = [];
        for (const l of leftChunk) for (const r of right) batch.push({ ...l, ...r });
        await writer.write(batch);
        post({ kind: "progress", jobId, progress: Math.round(10 + ((c + 1) / leftRef.chunkCount) * 80), message: "Joining..." });
      }

    } else {
      const K = Math.max(1, Math.ceil(rightRef.rowCount / PARTITION_THRESHOLD));

      if (K === 1) {
        // ── Small right side: existing in-memory approach ──────────────────
        post({ kind: "progress", jobId, progress: 5, message: "Loading lookup side..." });
        const right = await readFromOPFS(rightRef.executionId, rightRef.datasetId, rightRef.chunkCount);

        const rightMap = new Map<string, DatasetRow[]>();
        for (const r of right) {
          const key = rowKeyRight(r);
          const bucket = rightMap.get(key);
          if (bucket) bucket.push(r);
          else rightMap.set(key, [r]);
        }

        const matchedRightKeys = new Set<string>();

        for (let c = 0; c < leftRef.chunkCount; c++) {
          const leftChunk = await readChunkFromOPFS(leftRef.executionId, leftRef.datasetId, c);
          const batch: DatasetRow[] = [];
          for (const l of leftChunk) {
            const key = rowKeyLeft(l);
            const matches = rightMap.get(key) ?? [];
            if (matches.length > 0) {
              for (const r of matches) { batch.push({ ...l, ...r }); matchedRightKeys.add(key); }
            } else if (joinType === "left" || joinType === "full") {
              batch.push({ ...l });
            }
          }
          await writer.write(batch);
          post({ kind: "progress", jobId, progress: Math.round(10 + ((c + 1) / leftRef.chunkCount) * 75), message: "Joining..." });
        }

        if (joinType === "right" || joinType === "full") {
          const unmatched: DatasetRow[] = [];
          for (const r of right) {
            if (!matchedRightKeys.has(rowKeyRight(r))) unmatched.push({ ...r });
          }
          await writer.write(unmatched);
        }

      } else {
        // ── Large right side: grace hash join ──────────────────────────────
        post({ kind: "progress", jobId, progress: 3, message: `Partitioning into ${K} buckets...` });

        // Phase 1: partition right dataset
        const rightPartIds = Array.from({ length: K }, () => createId());
        const rightPartWriters = rightPartIds.map((id) => new ChunkedOPFSWriter(executionId, id, chunkSize));
        await Promise.all(rightPartWriters.map((w) => w.init()));

        for (let c = 0; c < rightRef.chunkCount; c++) {
          const chunk = await readChunkFromOPFS(rightRef.executionId, rightRef.datasetId, c);
          const buckets: DatasetRow[][] = Array.from({ length: K }, () => []);
          for (const row of chunk) buckets[partIdx(rowKeyRight(row), K)].push(row);
          for (let i = 0; i < K; i++) {
            if (buckets[i].length) await rightPartWriters[i].write(buckets[i]);
          }
          post({ kind: "progress", jobId, progress: Math.round(3 + ((c + 1) / rightRef.chunkCount) * 12), message: `Partitioning right... ${(c + 1)} / ${rightRef.chunkCount}` });
        }
        const rightPartMeta = await Promise.all(rightPartWriters.map((w) => w.finish()));

        // Phase 2: partition left dataset
        const leftPartIds = Array.from({ length: K }, () => createId());
        const leftPartWriters = leftPartIds.map((id) => new ChunkedOPFSWriter(executionId, id, chunkSize));
        await Promise.all(leftPartWriters.map((w) => w.init()));

        for (let c = 0; c < leftRef.chunkCount; c++) {
          const chunk = await readChunkFromOPFS(leftRef.executionId, leftRef.datasetId, c);
          const buckets: DatasetRow[][] = Array.from({ length: K }, () => []);
          for (const row of chunk) buckets[partIdx(rowKeyLeft(row), K)].push(row);
          for (let i = 0; i < K; i++) {
            if (buckets[i].length) await leftPartWriters[i].write(buckets[i]);
          }
          post({ kind: "progress", jobId, progress: Math.round(15 + ((c + 1) / leftRef.chunkCount) * 15), message: `Partitioning left... ${(c + 1)} / ${leftRef.chunkCount}` });
        }
        const leftPartMeta = await Promise.all(leftPartWriters.map((w) => w.finish()));

        // Phase 3: join each partition pair
        for (let i = 0; i < K; i++) {
          // Load right partition i into a hash map
          const rightMap = new Map<string, DatasetRow[]>();
          for (let ci = 0; ci < rightPartMeta[i].chunks.length; ci++) {
            const chunk = await readChunkFromOPFS(executionId, rightPartIds[i], ci);
            for (const r of chunk) {
              const key = rowKeyRight(r);
              const bucket = rightMap.get(key);
              if (bucket) bucket.push(r);
              else rightMap.set(key, [r]);
            }
          }
          const matchedRightKeys = new Set<string>();

          // Stream left partition i
          for (let ci = 0; ci < leftPartMeta[i].chunks.length; ci++) {
            const leftChunk = await readChunkFromOPFS(executionId, leftPartIds[i], ci);
            const batch: DatasetRow[] = [];
            for (const l of leftChunk) {
              const key = rowKeyLeft(l);
              const matches = rightMap.get(key) ?? [];
              if (matches.length > 0) {
                for (const r of matches) { batch.push({ ...l, ...r }); matchedRightKeys.add(key); }
              } else if (joinType === "left" || joinType === "full") {
                batch.push({ ...l });
              }
            }
            await writer.write(batch);
          }

          if (joinType === "right" || joinType === "full") {
            for (const [key, rows] of rightMap) {
              if (!matchedRightKeys.has(key)) {
                for (const r of rows) await writer.write([{ ...r }]);
              }
            }
          }

          post({ kind: "progress", jobId, progress: Math.round(30 + ((i + 1) / K) * 60), message: `Joining partition ${i + 1} / ${K}...` });
        }

        await Promise.all([
          ...rightPartIds.map((id) => deleteDatasetFromOPFS(executionId, id)),
          ...leftPartIds.map((id) => deleteDatasetFromOPFS(executionId, id)),
        ]);
      }
    }

    post({ kind: "progress", jobId, progress: 93, message: "Finalizing..." });
    const { chunks, totalBytes, totalRows } = await writer.finish();

    const now = new Date().toISOString();
    const manifest = {
      version: DATASET_MANIFEST_VERSION, datasetId, executionId, variableName,
      createdAt: now, updatedAt: now, rowCount: totalRows, chunkCount: chunks.length,
      byteSize: totalBytes, chunks,
    };
    const datasetRef: DatasetRef = {
      kind: "dataset", datasetId, executionId, variableName,
      rowCount: totalRows, chunkCount: chunks.length, byteSize: totalBytes,
    };

    post({ kind: "result", jobId, output: { manifest, datasetRef } });
  } catch (err) {
    post({ kind: "error", jobId, error: String(err) });
  }
};
