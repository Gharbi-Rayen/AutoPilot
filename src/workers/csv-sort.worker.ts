/**
 * CSV Sort — External merge sort for arbitrarily large datasets.
 *
 * Phase 1 (Sorted runs):
 *   Read MERGE_FACTOR input chunks at a time, sort in memory, write as a
 *   sorted run to a temp OPFS dataset.
 *   Memory peak: O(MERGE_FACTOR × chunkSize) rows = ~640 K rows at once.
 *
 * Phase 2 (K-way merge):
 *   Min-heap merge over all sorted runs. Each run's current chunk is kept
 *   in memory; exhausted chunks are freed. All OPFS reads are sequential —
 *   each input chunk is read exactly twice (once per phase).
 *
 * Why the previous approach was broken for large files:
 *   - Allocated 4 × Int32Array(rowCount) = 640 MB for 40 M rows → OOM.
 *   - Int32Array.sort(fn) with JS callback: ~1 B invocations for 40 M rows.
 *   - Pass 2 read chunks in random order → up to 40 M async OPFS reads.
 */

import { createId } from "@paralleldrive/cuid2";
import type { WorkerJobMessage, WorkerOutboundMessage } from "@/lib/worker-manager";
import { DATASET_MANIFEST_VERSION, type DatasetRef, type DatasetRow } from "@/types/dataset";
import { ChunkedOPFSWriter, deleteDatasetFromOPFS, readChunkFromOPFS } from "./_opfs-helpers";

const MERGE_FACTOR = 64; // input chunks merged per sorted run in Phase 1
const MAX_ROWS_PER_SORT_RUN = 640_000; // keep Phase 1 memory roughly stable across chunk sizes

// ── Comparator ────────────────────────────────────────────────────────────────

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

interface HeapEntry { row: DatasetRow; runIdx: number }

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
