/**
 * FILE: src/workers/csv-sort.worker.ts
 *
 * PURPOSE:
 *   Sorts a dataset that may be arbitrarily large — larger than available RAM —
 *   using an external merge sort algorithm.  The algorithm works in two phases,
 *   neither of which ever holds the full dataset in memory at once.
 *
 * WHAT IS AN EXTERNAL MERGE SORT?
 *   An "external" sort is one designed for data that doesn't fit in memory.
 *   Instead of sorting all rows at once, it:
 *     Phase 1 — Creates "sorted runs": reads chunks in groups, sorts them
 *               in memory, and writes each sorted group to a temp OPFS dataset.
 *     Phase 2 — Merges sorted runs: uses a min-heap to merge all sorted runs
 *               simultaneously, emitting the globally smallest row at each step.
 *   This is the classic algorithm databases and Unix `sort` use for large data.
 *
 * WHAT IS A SORTED RUN?
 *   A contiguous block of rows that are sorted among themselves.
 *   After Phase 1, the temp dataset contains many sorted runs back-to-back.
 *   Each run spans several chunk files.
 *
 * WHAT IS A K-WAY MERGE?
 *   "K-way" means merging K sorted sequences simultaneously.
 *   A naive approach: compare the head of each run pairwise → O(K) per output row.
 *   A min-heap approach: maintain a heap of (current row, run index) pairs.
 *     - Pop the minimum row (globally smallest across all runs).
 *     - Advance that run's cursor and push the next row from that run into the heap.
 *     - Repeat until the heap is empty.
 *   This is O(log K) per output row — much faster for many runs.
 *
 * WHAT IS A MIN-HEAP?
 *   A min-heap is a data structure where the smallest element is always at the top.
 *   It is a binary tree stored as an array.  Parent at index i, children at 2i+1 and 2i+2.
 *   Push (insert): place at end, then "bubble up" while smaller than parent.
 *   Pop (extract min): swap root with last, remove last, then "bubble down".
 *   Both operations are O(log n) where n is the heap size.
 *
 * MEMORY MODEL:
 *   Phase 1 peak: MERGE_FACTOR (64) × chunkSize rows in memory at once.
 *   With default chunkSize=10_000: 64 × 10_000 = 640_000 rows × ~200 bytes = ~128 MB.
 *   MAX_ROWS_PER_SORT_RUN (640_000) caps this regardless of chunkSize.
 *
 *   Phase 2 peak: K chunks (one per sorted run) × chunkSize rows in memory at once.
 *   K = numRuns.  Each run keeps its current chunk loaded; exhausted chunks are freed.
 *   Typical peak: 5-10 MB when chunkSize=10_000 and numRuns<=64.
 *
 * WHY THE PREVIOUS APPROACH WAS BROKEN:
 *   The original implementation allocated 4 × Int32Array(rowCount) to sort by index.
 *   For 40 million rows: 4 × 40M × 4 bytes = 640 MB — OOM on most browsers.
 *   Also used a JS comparator function with Int32Array.sort(), generating ~1B callbacks.
 *   Also read chunks in random (post-sort index) order: up to 40M async OPFS reads.
 *
 * INPUT (from WorkerJobMessage.input):
 *   inputRef    — DatasetRef pointing to the dataset to sort
 *   sortColumns — array of { field, direction: "asc"|"desc" }
 *   compareAs   — "string" | "number" | "date" (default "string")
 *   nulls       — "first" | "last" (where null/empty values appear, default "last")
 *   executionId — current execution's ID (for writing temp and output datasets)
 *   variableName — context key for the output
 *   chunkSize   — rows per chunk (from performance settings)
 *
 * OUTPUT:
 *   manifest   — DatasetManifest for the sorted output dataset
 *   datasetRef — DatasetRef for the sorted output dataset
 *
 * USED IN:
 *   src/features/executions/components/csv-sort/executor.ts
 */

import { createId } from "@paralleldrive/cuid2";
import type { WorkerJobMessage, WorkerOutboundMessage } from "@/lib/worker-manager";
import { DATASET_MANIFEST_VERSION, type DatasetRef, type DatasetRow } from "@/types/dataset";
import { ChunkedOPFSWriter, deleteDatasetFromOPFS, readChunkFromOPFS } from "./_opfs-helpers";

/**
 * MERGE_FACTOR
 *
 * WHY THIS EXISTS:
 *   Controls how many input chunks are loaded and sorted in memory at a time during Phase 1.
 *   Higher = larger sorted runs (fewer runs to merge in Phase 2) but more RAM per run.
 *   64 is a balance: enough to reduce Phase 2 overhead without causing OOM.
 */
const MERGE_FACTOR = 64; // input chunks merged per sorted run in Phase 1

/**
 * MAX_ROWS_PER_SORT_RUN
 *
 * WHY THIS EXISTS:
 *   Caps the number of rows sorted in memory per run, independent of chunkSize.
 *   When the user increases chunkSize (e.g. to 50 000), without this cap Phase 1
 *   would load 64 × 50 000 = 3 200 000 rows — potentially causing OOM.
 *   With the cap: mergeFactor = min(64, floor(640_000 / 50_000)) = min(64, 12) = 12.
 *   This ensures Phase 1 memory stays roughly within 640 000 rows × ~200 bytes = ~128 MB.
 */
const MAX_ROWS_PER_SORT_RUN = 640_000; // keep Phase 1 memory roughly stable across chunk sizes

// ── Comparator ────────────────────────────────────────────────────────────────

/**
 * makeComparator()
 *
 * WHY THIS EXISTS:
 *   JavaScript's Array.sort() requires a comparator function: (a, b) => number.
 *   A comparator returns:
 *     negative → a should come before b
 *     positive → b should come before a
 *     zero     → equal (order doesn't matter)
 *   This factory creates a comparator that handles multi-column sorting, type-aware
 *   comparison (string, number, date), null placement (first or last), and ascending
 *   or descending direction per column.
 *
 * HOW MULTI-COLUMN SORTING WORKS:
 *   For each sort column in order, compare the values.
 *   If they are equal (cmp === 0), move to the next column.
 *   The first column that differs determines the order.
 *   If all columns are equal, return 0 (rows are considered equal).
 *
 * WHAT IS THE `>>` OPERATOR?
 *   `>>` is a bitwise right-shift.  `(i - 1) >> 1` is equivalent to `Math.floor((i-1)/2)`.
 *   It is used in the MinHeap to compute the parent index of a node at index i.
 *   Bitwise operations are faster than Math.floor() and are idiomatic in heap code.
 *
 * PARAMETERS:
 *   sortColumns — the sort specification (which fields, which direction)
 *   compareAs   — data type for comparison ("string" | "number" | "date")
 *   nullsPos    — where null/empty values should appear ("first" | "last")
 *
 * RETURNS:
 *   A comparator function (DatasetRow, DatasetRow) => number
 *
 * CALLED FROM:
 *   The message handler — creates `cmp` once, then passes it to MinHeap and Array.sort()
 */
function makeComparator(
  sortColumns: { field: string; direction: "asc" | "desc" }[],
  compareAs: string,
  nullsPos: "first" | "last",
) {
  return (a: DatasetRow, b: DatasetRow): number => {
    for (const col of sortColumns) {
      const ra = a[col.field];
      const rb = b[col.field];
      const aNull = ra === null || ra === undefined || ra === "";
      const bNull = rb === null || rb === undefined || rb === "";

      if (aNull && bNull) continue;
      if (aNull) return nullsPos === "first" ? -1 : 1;
      if (bNull) return nullsPos === "first" ? 1 : -1;

      let cmp: number;
      if (compareAs === "number") {
        cmp = Number(ra) - Number(rb);
        if (Number.isNaN(cmp)) cmp = String(ra) < String(rb) ? -1 : 1;
      } else if (compareAs === "date") {
        cmp = Date.parse(String(ra)) - Date.parse(String(rb));
        if (Number.isNaN(cmp)) cmp = String(ra) < String(rb) ? -1 : 1;
      } else {
        const sa = String(ra);
        const sb = String(rb);
        cmp = sa < sb ? -1 : sa > sb ? 1 : 0;
      }

      if (cmp !== 0) return col.direction === "asc" ? cmp : -cmp;
    }
    return 0;
  };
}

// ── Min-heap for k-way merge ──────────────────────────────────────────────────

/**
 * HeapEntry
 *
 * WHY THIS EXISTS:
 *   The min-heap contains one entry per sorted run (when that run still has rows).
 *   Each entry tracks:
 *     row    — the current "head" row of this run (the smallest unmerged row)
 *     runIdx — which sorted run this row came from (so we know which cursor to advance)
 *
 * USED IN:
 *   MinHeap.push() — wraps a row with its run index before inserting
 *   MinHeap.pop()  — returns the HeapEntry so the merge loop knows which run to advance
 */
interface HeapEntry { row: DatasetRow; runIdx: number }

/**
 * MinHeap
 *
 * WHY THIS EXISTS:
 *   Implements the min-heap data structure used in Phase 2 (k-way merge).
 *   The heap always has the globally smallest row at the top (index 0).
 *   Popping the minimum row is O(log K) where K is the number of active runs.
 *
 * WHAT IS THE HEAP ARRAY `h`?
 *   The heap is stored as a flat array.  For node at index i:
 *     Parent:       Math.floor((i-1)/2)  (or (i-1) >> 1)
 *     Left child:   2*i + 1
 *     Right child:  2*i + 2
 *   The "heap property": every parent's row is <= its children's rows (by the comparator).
 *
 * push() METHOD:
 *   1. Append the new entry to the end of the array.
 *   2. "Bubble up": while the new entry is smaller than its parent, swap them.
 *   3. Stop when the entry is >= its parent, or when it reaches the root (index 0).
 *
 * pop() METHOD:
 *   1. Save the root (smallest element).
 *   2. Move the last element to the root position.
 *   3. Remove the last element (it's now at root).
 *   4. "Bubble down": compare root with its children; swap with the smaller child.
 *   5. Repeat until the element is <= both children, or reaches a leaf.
 *   6. Return the saved root.
 *
 * USED IN:
 *   The message handler's Phase 2 loop
 */
class MinHeap {
  private h: HeapEntry[] = [];
  constructor(private cmp: (a: DatasetRow, b: DatasetRow) => number) {}

  push(e: HeapEntry): void {
    this.h.push(e);
    let i = this.h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.cmp(this.h[i].row, this.h[p].row) >= 0) break;
      [this.h[i], this.h[p]] = [this.h[p], this.h[i]];
      i = p;
    }
  }

  pop(): HeapEntry | undefined {
    if (!this.h.length) return undefined;
    const top = this.h[0];
    const last = this.h.pop() as HeapEntry;
    if (this.h.length) {
      this.h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = 2 * i + 2;
        let min = i;
        if (l < this.h.length && this.cmp(this.h[l].row, this.h[min].row) < 0) min = l;
        if (r < this.h.length && this.cmp(this.h[r].row, this.h[min].row) < 0) min = r;
        if (min === i) break;
        [this.h[i], this.h[min]] = [this.h[min], this.h[i]];
        i = min;
      }
    }
    return top;
  }

  get size(): number { return this.h.length; }
}

// ── Worker ────────────────────────────────────────────────────────────────────

/**
 * self.onmessage — worker entry point
 *
 * PHASE 1 WALKTHROUGH:
 *   numRuns = ceil(N / mergeFactor)  — how many sorted runs we'll create
 *   For each run (group of mergeFactor input chunks):
 *     1. Read mergeFactor chunks from the INPUT dataset into a buf[] array.
 *     2. Sort buf[] in memory using Array.sort(cmp).
 *     3. Write buf[] to the RUNS dataset (a temp OPFS dataset) using ChunkedOPFSWriter.
 *     4. Call forceFlush() to ensure the last partial chunk of this run is written
 *        and a clean chunk boundary exists before the next run starts.
 *   Track runChunkStart[r] and runChunkCount[r] so Phase 2 can find each run's chunks.
 *
 * PHASE 2 WALKTHROUGH:
 *   1. Load the first chunk of EACH run.
 *   2. Push the first row of each run's chunk into the MinHeap.
 *   3. While the heap is not empty:
 *      a. Pop the minimum row from the heap.
 *      b. Add it to outBatch[].
 *      c. Advance that run's cursor:
 *         - If more rows remain in the current chunk: push next row into heap.
 *         - If the chunk is exhausted: load the next chunk of this run.
 *         - If no more chunks in this run: the run is done; it drops out of the heap.
 *      d. When outBatch reaches chunkSize, flush it to the output dataset.
 *   4. After the heap is empty, flush any remaining outBatch rows.
 *   5. Delete the temp runs dataset (it's no longer needed).
 *   6. Send the result manifest back to the main thread.
 *
 * RunCursor TYPE (local):
 *   Tracks the current position within one sorted run:
 *     run        — which run index this is
 *     chunkInRun — which chunk within this run is currently loaded
 *     data       — the currently loaded chunk's rows
 *     pos        — current position within data[]
 */
self.onmessage = async (event: MessageEvent<WorkerJobMessage>) => {
  const { jobId, input } = event.data;
  const {
    inputRef,
    sortColumns,
    compareAs = "string",
    nulls = "last",
    executionId,
    variableName,
    chunkSize = 10_000,
  } = input as {
    inputRef: DatasetRef;
    sortColumns: { field: string; direction: "asc" | "desc" }[];
    compareAs?: string;
    nulls?: "first" | "last";
    executionId: string;
    variableName: string;
    chunkSize?: number;
  };

  const post = (msg: WorkerOutboundMessage) => self.postMessage(msg);
  const cmp = makeComparator(sortColumns, compareAs, nulls);
  const N = inputRef.chunkCount;
  const estimatedInputChunkRows = Math.max(1, Math.ceil(inputRef.rowCount / Math.max(1, N)));
  const mergeFactor = Math.max(
    1,
    Math.min(MERGE_FACTOR, Math.floor(MAX_ROWS_PER_SORT_RUN / estimatedInputChunkRows)),
  );

  try {
    if (N === 0) {
      // Empty dataset — write empty output
      const datasetId = createId();
      const writer = new ChunkedOPFSWriter(executionId, datasetId, chunkSize);
      await writer.init();
      const { chunks } = await writer.finish();
      const now = new Date().toISOString();
      post({
        kind: "result", jobId, output: {
          manifest: { version: DATASET_MANIFEST_VERSION, datasetId, executionId, variableName, createdAt: now, updatedAt: now, rowCount: 0, chunkCount: 0, byteSize: 0, schema: inputRef.schema, chunks },
          datasetRef: { kind: "dataset", datasetId, executionId, variableName, rowCount: 0, chunkCount: 0, byteSize: 0, schema: inputRef.schema },
        },
      });
      return;
    }

    // ── Phase 1: sorted runs ─────────────────────────────────────────────────
    post({
      kind: "progress",
      jobId,
      progress: 5,
      message: `Sorting data... (inputChunkRows~${estimatedInputChunkRows.toLocaleString()}, outputChunkSize=${chunkSize.toLocaleString()}, mergeFactor=${mergeFactor})`,
    });

    const numRuns = Math.ceil(N / mergeFactor);
    const runDatasetId = createId();
    const runWriter = new ChunkedOPFSWriter(executionId, runDatasetId, chunkSize);
    await runWriter.init();

    // Track chunk boundaries in the runs dataset for each run
    const runChunkStart: number[] = new Array(numRuns);
    const runChunkCount: number[] = new Array(numRuns);
    let totalRunChunks = 0;
    let totalRunRows = 0;

    for (let run = 0; run < numRuns; run++) {
      const srcFrom = run * mergeFactor;
      const srcTo = Math.min(srcFrom + mergeFactor, N);

      // Load this group of input chunks into memory
      const buf: DatasetRow[] = [];
      for (let c = srcFrom; c < srcTo; c++) {
        const chunk = await readChunkFromOPFS(inputRef.executionId, inputRef.datasetId, c);
        for (const row of chunk) buf.push(row);
        const pct = Math.round(5 + ((c + 1) / N) * 45);
        post({ kind: "progress", jobId, progress: pct, message: `Sorting... ${(c + 1).toLocaleString()} / ${N.toLocaleString()} chunks` });
      }

      // Sort in memory
      buf.sort(cmp);

      // Write sorted run to temp OPFS dataset
      runChunkStart[run] = totalRunChunks;
      const runChunks = Math.ceil(buf.length / chunkSize) || 1;
      runChunkCount[run] = runChunks;
      totalRunChunks += runChunks;
      totalRunRows += buf.length;

      await runWriter.write(buf);
      await runWriter.forceFlush(); // ensure clean chunk boundary before the next run
    }

    await runWriter.finish();

    // ── Phase 2: k-way merge ─────────────────────────────────────────────────
    post({ kind: "progress", jobId, progress: 52, message: `Merging ${numRuns} sorted run${numRuns > 1 ? "s" : ""}...` });

    // Load first chunk of each run; initialize the heap
    type RunCursor = { run: number; chunkInRun: number; data: DatasetRow[]; pos: number };
    const cursorMap = new Map<number, RunCursor>();
    const heap = new MinHeap(cmp);

    for (let r = 0; r < numRuns; r++) {
      if (runChunkCount[r] === 0) continue;
      const data = await readChunkFromOPFS(executionId, runDatasetId, runChunkStart[r]);
      if (!data.length) continue;
      const cur: RunCursor = { run: r, chunkInRun: 0, data, pos: 0 };
      cursorMap.set(r, cur);
      heap.push({ row: data[0], runIdx: r });
    }

    const datasetId = createId();
    const writer = new ChunkedOPFSWriter(executionId, datasetId, chunkSize);
    await writer.init();

    const outBatch: DatasetRow[] = [];
    let written = 0;

    while (heap.size > 0) {
      const entry = heap.pop();
      if (!entry) break;
      const { row, runIdx } = entry;
      outBatch.push(row);

      // Advance this run's cursor
      const cur = cursorMap.get(runIdx);
      if (!cur) continue;
      cur.pos++;

      if (cur.pos < cur.data.length) {
        heap.push({ row: cur.data[cur.pos], runIdx });
      } else {
        // Current chunk of this run is exhausted — load next chunk if any
        cur.chunkInRun++;
        if (cur.chunkInRun < runChunkCount[cur.run]) {
          cur.data = await readChunkFromOPFS(executionId, runDatasetId, runChunkStart[cur.run] + cur.chunkInRun);
          cur.pos = 0;
          if (cur.data.length) heap.push({ row: cur.data[0], runIdx });
        }
        // else: run exhausted, drops out of merge
      }

      if (outBatch.length >= chunkSize) {
        await writer.write(outBatch.splice(0));
        written += chunkSize;
        const pct = Math.round(52 + (written / totalRunRows) * 40);
        post({
          kind: "progress", jobId,
          progress: Math.min(pct, 92),
          message: `Merging... ${written.toLocaleString()} / ${totalRunRows.toLocaleString()} rows`,
        });
      }
    }

    if (outBatch.length) await writer.write(outBatch);

    const { chunks, totalBytes, totalRows } = await writer.finish();

    await deleteDatasetFromOPFS(executionId, runDatasetId);

    const now = new Date().toISOString();
    const manifest = {
      version: DATASET_MANIFEST_VERSION, datasetId, executionId, variableName,
      createdAt: now, updatedAt: now, rowCount: totalRows, chunkCount: chunks.length,
      byteSize: totalBytes, schema: inputRef.schema, chunks,
    };
    const datasetRef: DatasetRef = {
      kind: "dataset", datasetId, executionId, variableName,
      rowCount: totalRows, chunkCount: chunks.length, byteSize: totalBytes, schema: inputRef.schema,
    };

    post({ kind: "result", jobId, output: { manifest, datasetRef } });
  } catch (err) {
    post({ kind: "error", jobId, error: String(err) });
  }
};
