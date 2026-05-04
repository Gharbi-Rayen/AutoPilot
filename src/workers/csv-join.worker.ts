/**
 * FILE: src/workers/csv-join.worker.ts
 *
 * PURPOSE:
 *   Joins two datasets on a key column, supporting inner, left, right, full, and cross joins.
 *   Adaptively chooses between two algorithms based on the right dataset's size:
 *     - Small right side (≤ PARTITION_THRESHOLD rows): hash join (in-memory Map)
 *     - Large right side (> PARTITION_THRESHOLD rows): grace hash join (OPFS partitioning)
 *   Cross join always loads the right side fully (by necessity — output is left × right rows).
 *
 * WHAT IS A JOIN?
 *   A join combines rows from two datasets (LEFT and RIGHT) based on matching key values.
 *   Example: LEFT = customer records (ID, Name), RIGHT = orders (CustomerID, Amount).
 *   Inner join on ID = CustomerID → output rows where a customer has matching orders.
 *
 * JOIN TYPES:
 *   inner — only rows where the key exists in BOTH datasets.
 *   left  — all LEFT rows; unmatched LEFT rows included with NULL RIGHT columns.
 *   right — all RIGHT rows; unmatched RIGHT rows included with NULL LEFT columns.
 *   full  — all rows from both sides; unmatched rows from either side included.
 *   cross — every LEFT row paired with every RIGHT row (no key matching).
 *           Output size = LEFT.rowCount × RIGHT.rowCount.
 *
 * WHAT IS A HASH JOIN?
 *   1. Load the right dataset into a Map: key → [matching rows].
 *   2. Stream the left dataset chunk by chunk.
 *   3. For each left row, look up its key in the Map (O(1)) and emit joined rows.
 *   Peak RAM: the entire right dataset (one Map entry per right row).
 *
 * WHAT IS A GRACE HASH JOIN?
 *   Solves the problem when the right dataset is too large for a single in-memory Map.
 *   1. Partition BOTH datasets into K buckets using a hash function.
 *      Rows with the same key always land in the same bucket.
 *   2. Join each bucket pair (right bucket i + left bucket i) with a small in-memory hash join.
 *      Peak RAM per bucket = right / K rows.
 *   This reduces memory from O(right total) to O(right / K) per join operation.
 *
 * WHAT IS djb2?
 *   djb2 is a fast, simple non-cryptographic hash function for strings.
 *   Starting from seed 5381, for each character: h = h * 33 + charCode.
 *   Using `| 0` forces the result to a 32-bit integer (prevents floating-point overflow).
 *   The result is used to assign rows to partitions: Math.abs(djb2(key)) % K.
 *
 * WHAT IS `<< 5`?
 *   `h << 5` is a left bitwise shift — equivalent to h × 32.
 *   `((h << 5) + h)` = h × 33.  Bitwise shifts are faster than multiplication.
 *   `| 0` forces the result to a 32-bit signed integer (prevents JavaScript's
 *   floating-point arithmetic from accumulating precision errors).
 *
 * MEMORY MODEL:
 *   Hash join (K=1):  O(rightRef.rowCount) — entire right in one Map.
 *   Grace hash join:  O(rightRef.rowCount / K) per partition — one right partition at a time.
 *   Cross join:       O(rightRef.rowCount) — entire right loaded (unavoidable).
 *
 * PARTITION_THRESHOLD:
 *   If rightRef.rowCount > 500 000, K = ceil(rowCount / 500 000) partitions are used.
 *   Each right partition has approximately 500 000 rows → ~100 MB per partition in RAM.
 *   Can be overridden by the user's performance settings (maxUnionRows).
 *
 * INPUT (from WorkerJobMessage.input):
 *   leftRef     — DatasetRef for the LEFT dataset
 *   rightRef    — DatasetRef for the RIGHT dataset
 *   joinType    — "inner" | "left" | "right" | "full" | "cross"
 *   leftKey     — column name in LEFT to join on (empty = full-row equality)
 *   rightKey    — column name in RIGHT to join on (empty = full-row equality)
 *   executionId — current execution's ID
 *   variableName — context key for the output dataset
 *   chunkSize   — rows per output chunk
 *
 * OUTPUT:
 *   manifest   — DatasetManifest for the joined output
 *   datasetRef — DatasetRef for the joined output
 *
 * USED IN:
 *   src/features/executions/components/csv-join/executor.ts
 */

import { createId } from "@paralleldrive/cuid2";
import type { WorkerJobMessage, WorkerOutboundMessage } from "@/lib/worker-manager";
import { DATASET_MANIFEST_VERSION, type DatasetRef, type DatasetRow } from "@/types/dataset";
import { ChunkedOPFSWriter, deleteDatasetFromOPFS, readChunkFromOPFS, readFromOPFS } from "./_opfs-helpers";

/**
 * JoinType
 *
 * WHY THIS EXISTS:
 *   Union type of all valid join types, preventing invalid values from being passed.
 *
 * USED IN:
 *   input destructuring — joinType is cast to JoinType
 *   Conditional logic in the join loops — determines which unmatched rows to include
 */
type JoinType = "inner" | "left" | "right" | "full" | "cross";

/**
 * PARTITION_THRESHOLD
 *
 * WHY THIS EXISTS:
 *   Determines when to switch from simple in-memory hash join (K=1) to grace hash join (K>1).
 *   K = ceil(rightRef.rowCount / PARTITION_THRESHOLD).
 *   If right has 1 000 000 rows: K = 2 partitions → each ~500 000 rows in RAM.
 *   If right has 500 000 rows: K = 1 → simple hash join.
 *
 * USED IN:
 *   K calculation: `const K = Math.max(1, Math.ceil(rightRef.rowCount / PARTITION_THRESHOLD))`
 */
const PARTITION_THRESHOLD = 500_000;

/**
 * djb2()
 *
 * WHY THIS EXISTS:
 *   Hash function for partitioning — assigns rows to buckets deterministically.
 *   Rows with the same key always produce the same hash → same bucket.
 *   This ensures that in Phase 3 (partition join), left bucket i and right bucket i
 *   contain all rows that could possibly match each other.
 *
 * CALLED FROM:
 *   partIdx() — which is called when assigning rows to partitions
 */
function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h;
}

/**
 * partIdx()
 *
 * WHY THIS EXISTS:
 *   Maps a row key to a partition index (0 to K-1).
 *   Math.abs() ensures the index is non-negative (djb2 can return negative values
 *   due to the `| 0` int32 truncation).
 *
 * CALLED FROM:
 *   Grace hash join Phase 1 and Phase 2 — to route rows to partition writers
 */
function partIdx(key: string, K: number): number {
  return Math.abs(djb2(key)) % K;
}

/**
 * self.onmessage — worker entry point
 *
 * TOP-LEVEL BRANCHING:
 *   1. If joinType === "cross" → cross join path (always loads right fully)
 *   2. Else:
 *      a. Compute K = ceil(rightRef.rowCount / PARTITION_THRESHOLD)
 *      b. If K === 1 → small-right hash join path
 *      c. If K > 1  → grace hash join path
 *
 * SMALL-RIGHT HASH JOIN:
 *   1. readFromOPFS(right) — loads all right rows into `right[]`
 *   2. Build rightMap: Map<key, DatasetRow[]>
 *      (multiple right rows can have the same key — one-to-many joins)
 *   3. For each left chunk:
 *      a. For each left row, get matches from rightMap.
 *      b. For inner: emit only if matches exist.
 *      c. For left/full: emit left row with empty right if no matches.
 *   4. For right/full: emit unmatched right rows at the end.
 *
 * GRACE HASH JOIN (3 phases):
 *   Phase 1: Partition RIGHT into K OPFS temp datasets (rightPartIds[]).
 *   Phase 2: Partition LEFT into K OPFS temp datasets (leftPartIds[]).
 *   Phase 3: For each partition i:
 *     a. Load rightPartIds[i] into a rightMap (small enough to fit in RAM).
 *     b. Stream leftPartIds[i], look up each row in rightMap.
 *     c. Handle unmatched rows for right/full joins.
 *   Cleanup: delete all K×2 partition temp datasets from OPFS.
 *
 * WHY matchedRightKeys Set?
 *   For right and full joins, we need to emit right rows that had NO matching left row.
 *   As we process left rows, we track which right keys were matched.
 *   After the left pass, any right key not in matchedRightKeys is "unmatched" → emit it.
 */
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
