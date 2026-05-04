/**
 * FILE: src/workers/_opfs-helpers.ts
 *
 * PURPOSE:
 *   Provides shared OPFS read/write utilities for use inside Web Workers.
 *   Workers cannot import from the main application's OPFS module (src/lib/opfs.ts)
 *   because that file uses path aliases (@/) which are resolved by the Next.js
 *   bundler — but workers are bundled separately by esbuild and those aliases
 *   may not resolve the same way.  This file is a self-contained copy of the
 *   essential OPFS helpers, written to work standalone inside workers.
 *
 * WHAT IS A "STANDALONE" WORKER FILE?
 *   Each worker is compiled by esbuild into a single .js file with all its
 *   dependencies bundled in.  The worker cannot assume React, Next.js routing,
 *   or any other framework infrastructure is available — it runs in its own
 *   DedicatedWorkerGlobalScope with no access to the main thread's modules.
 *
 * WHY DUPLICATE LOGIC INSTEAD OF SHARING?
 *   Sharing code between the main bundle and worker bundles requires careful
 *   esbuild configuration.  For simplicity and reliability, these small helpers
 *   are duplicated here rather than shared via an npm package or complex bundler setup.
 *   The total duplication is small (~150 lines) compared to the complexity it avoids.
 *
 * KEY CONCEPTS:
 *   - getDatasetDir() navigates the OPFS directory tree to a dataset folder.
 *   - readChunkFromOPFS() reads one chunk file by index.
 *   - readFromOPFS() reads ALL chunks and concatenates rows.
 *   - writeToOPFS() writes a full rows array as chunks (one shot).
 *   - ChunkedOPFSWriter is a class for streaming writes — rows can be pushed
 *     incrementally without holding all of them in memory at once.
 *   - deleteDatasetFromOPFS() removes a dataset folder.
 *
 * USED IN:
 *   src/workers/csv-sort.worker.ts         — reads sorted runs, writes merged output
 *   src/workers/csv-filter.worker.ts       — reads input, writes filtered output
 *   src/workers/csv-join.worker.ts         — reads both sides, writes joined output
 *   src/workers/csv-aggregate.worker.ts    — reads input, writes aggregated output
 *   src/workers/csv-deduplicate.worker.ts  — reads input, writes two outputs
 *   src/workers/csv-compare.worker.ts      — reads two inputs, writes five outputs
 *   src/workers/csv-transform.worker.ts    — reads input, writes transformed output
 *   src/workers/csv-column-transform.worker.ts — same
 *   src/workers/csv-restructure.worker.ts  — same
 *   src/workers/csv-consecutive-sequence.worker.ts — same
 */

import type { DatasetRow } from "@/types/dataset";

/**
 * getDatasetDir() (private helper)
 *
 * WHY THIS EXISTS:
 *   Workers need to navigate to the same OPFS directory structure as the main thread:
 *     autopilot/executions/<executionId>/<datasetId>/
 *   This function encapsulates that 4-level navigation.
 *
 * WHAT IS Promise chaining (.then())?
 *   Instead of using await on each step, this function chains .then() calls.
 *   Each .then() receives the result of the previous step and returns a new Promise.
 *   The final Promise resolves to the innermost directory handle.
 *   This is equivalent to writing:
 *     const root = await navigator.storage.getDirectory();
 *     const autopilot = await root.getDirectoryHandle("autopilot", { create });
 *     const executions = await autopilot.getDirectoryHandle("executions", { create });
 *     ...
 *   Promise chaining is more compact but functionally identical.
 *
 * PARAMETERS:
 *   executionId — the execution's unique ID
 *   datasetId   — the dataset's unique ID
 *   create      — if true, missing directories are created; if false, throw if missing
 *
 * CALLED FROM:
 *   readChunkFromOPFS() — with create=false (dataset must already exist)
 *   writeToOPFS()       — with create=true (create if not exists)
 *   ChunkedOPFSWriter.init() — with create=true
 */
async function getDatasetDir(
  executionId: string,
  datasetId: string,
  create = false,
): Promise<FileSystemDirectoryHandle> {
  const opfsRoot = await navigator.storage.getDirectory();
  return opfsRoot
    .getDirectoryHandle("autopilot", { create })
    .then((a) => a.getDirectoryHandle("executions", { create }))
    .then((e) => e.getDirectoryHandle(executionId, { create }))
    .then((ex) => ex.getDirectoryHandle(datasetId, { create }));
}

/**
 * readChunkFromOPFS()
 *
 * WHY THIS EXISTS:
 *   Reads a single chunk file from OPFS by its index.
 *   Workers that process data chunk by chunk (instead of loading everything at once)
 *   use this to read one chunk at a time — keeping memory usage bounded.
 *
 * HOW CHUNK FILE NAMES WORK:
 *   Files are named chunk-000000.json, chunk-000001.json, chunk-000002.json, …
 *   The index is zero-padded to 6 digits with padStart(6, "0").
 *   Zero-padding ensures alphabetical file listing matches numerical order.
 *
 * WHAT IS padStart(6, "0")?
 *   String method that pads the string from the left to reach a given length.
 *   String(3).padStart(6, "0") → "000003"
 *   Without padding: "3" vs "10" sorts as "10" < "3" (alphabetically) — wrong.
 *   With padding: "000003" < "000010" — correct.
 *
 * PARAMETERS:
 *   executionId — execution the dataset belongs to
 *   datasetId   — dataset to read from
 *   chunkIndex  — 0-based index of the chunk file to read
 *
 * RETURNS:
 *   DatasetRow[] — the rows in that single chunk
 *
 * CALLED FROM:
 *   readFromOPFS() — called in a loop for each chunk index
 *   src/workers/csv-sort.worker.ts — reads individual sorted-run chunks during merge
 */
export async function readChunkFromOPFS(
  executionId: string,
  datasetId: string,
  chunkIndex: number,
): Promise<DatasetRow[]> {
  const dir = await getDatasetDir(executionId, datasetId, false);
  const fileName = `chunk-${String(chunkIndex).padStart(6, "0")}.json`;
  const fh = await dir.getFileHandle(fileName);
  return JSON.parse(await (await fh.getFile()).text()) as DatasetRow[];
}

/**
 * readFromOPFS()
 *
 * WHY THIS EXISTS:
 *   Reads ALL rows of a dataset into a single flat array by iterating all chunk files.
 *   Used when a worker needs the complete dataset in memory (e.g. for building a hash map).
 *   For datasets larger than ~200 000 rows, this can exhaust RAM — workers that handle
 *   large datasets stream chunk by chunk instead using readChunkFromOPFS().
 *
 * HOW IT WORKS:
 *   Iterates chunk indices 0 to chunkCount-1.
 *   For each index, calls readChunkFromOPFS() and pushes the rows into `rows`.
 *   Using a for loop with individual pushes (not spread) avoids call-stack overflow
 *   when chunks have tens of thousands of rows.
 *
 * PARAMETERS:
 *   executionId — execution the dataset belongs to
 *   datasetId   — dataset to read
 *   chunkCount  — total number of chunk files (from the DatasetManifest)
 *
 * RETURNS:
 *   DatasetRow[] — all rows concatenated in order
 *
 * CALLED FROM:
 *   src/workers/csv-join.worker.ts    — reads the "right side" for hash join
 *   src/workers/csv-compare.worker.ts — reads the base dataset for hash compare
 *   src/workers/csv-aggregate.worker.ts — reads all rows for aggregation
 */
export async function readFromOPFS(
  executionId: string,
  datasetId: string,
  chunkCount: number,
): Promise<DatasetRow[]> {
  const rows: DatasetRow[] = [];
  for (let i = 0; i < chunkCount; i++) {
    const chunk = await readChunkFromOPFS(executionId, datasetId, i);
    for (const row of chunk) rows.push(row);
  }
  return rows;
}

/**
 * writeToOPFS()
 *
 * WHY THIS EXISTS:
 *   Writes an entire rows array to OPFS as chunk files in a single call.
 *   Used by workers that have computed their full output before writing
 *   (e.g. sort phase 1 writes a sorted run all at once).
 *
 * HOW THE EMPTY-DATASET EDGE CASE IS HANDLED:
 *   The loop condition `i * chunkSize < rows.length || (i === 0 && rows.length === 0)`
 *   ensures at least one iteration even when rows is empty.
 *   Inside, `if (!c.length) break` exits immediately if the slice was empty.
 *   This produces zero chunk files for an empty dataset (no chunk-000000.json created).
 *
 * PARAMETERS:
 *   executionId — execution the dataset belongs to
 *   datasetId   — new dataset ID for the output
 *   rows        — all rows to write
 *   chunkSize   — rows per chunk file (default 10 000; overridden by performance settings)
 *
 * RETURNS:
 *   { chunks: OPFSChunkMeta[], totalBytes: number }
 *   chunks     — metadata for each chunk written (used to build a DatasetManifest)
 *   totalBytes — total bytes written across all chunk files
 *
 * CALLED FROM:
 *   src/workers/csv-sort.worker.ts — writes each sorted run (Phase 1)
 *   src/workers/csv-filter.worker.ts — writes filtered output
 */
export async function writeToOPFS(
  executionId: string,
  datasetId: string,
  rows: DatasetRow[],
  chunkSize = 10_000,
) {
  const dir = await getDatasetDir(executionId, datasetId, true);

  const chunks = [];
  let cum = 0;
  let totalBytes = 0;
  const now = new Date().toISOString();

  for (
    let i = 0;
    i * chunkSize < rows.length || (i === 0 && rows.length === 0);
    i++
  ) {
    const c = rows.slice(i * chunkSize, (i + 1) * chunkSize);
    if (!c.length) break;
    const fn = `chunk-${String(i).padStart(6, "0")}.json`;
    const bytes = new TextEncoder().encode(JSON.stringify(c));
    const w = await (await dir.getFileHandle(fn, { create: true })).createWritable();
    await w.write(bytes);
    await w.close();
    cum += c.length;
    totalBytes += bytes.byteLength;
    chunks.push({
      chunkIndex: i,
      fileName: fn,
      rowStart: i * chunkSize,
      rowEnd: i * chunkSize + c.length - 1,
      rowCount: c.length,
      cumulativeRowCount: cum,
      byteSize: bytes.byteLength,
      createdAt: now,
    });
  }
  return { chunks, totalBytes };
}

/**
 * OPFSChunkMeta
 *
 * WHY THIS EXISTS:
 *   Describes one chunk file within a dataset.  This is the same shape as
 *   DatasetChunkMetadata in src/types/dataset.ts, but defined here independently
 *   so this file has no external dependencies beyond @/types/dataset.
 *   Workers that compute output use this type to accumulate chunk metadata,
 *   then assemble it into a full DatasetManifest to send back to the main thread.
 *
 * FIELD MEANINGS:
 *   chunkIndex       — 0-based index of this chunk in the dataset
 *   fileName         — the file name (e.g. "chunk-000003.json")
 *   rowStart         — global row index of the first row in this chunk
 *   rowEnd           — global row index of the last row in this chunk
 *   rowCount         — number of rows in this chunk
 *   cumulativeRowCount — total rows from chunk 0 through this chunk (inclusive)
 *   byteSize         — size of the chunk file in bytes
 *   createdAt        — ISO 8601 timestamp when this chunk was written
 *
 * USED IN:
 *   writeToOPFS()      — pushed into the chunks array
 *   ChunkedOPFSWriter  — accumulated in this.chunks
 *   All workers        — return OPFSChunkMeta[] as part of the manifest
 */
export type OPFSChunkMeta = {
  chunkIndex: number;
  fileName: string;
  rowStart: number;
  rowEnd: number;
  rowCount: number;
  cumulativeRowCount: number;
  byteSize: number;
  createdAt: string;
};

/**
 * deleteDatasetFromOPFS()
 *
 * WHY THIS EXISTS:
 *   Workers sometimes create temporary datasets during computation (e.g. the sort
 *   worker creates "sorted run" datasets in Phase 1 that are only needed until
 *   Phase 2 merge is complete).  After the final output is written, these temps
 *   are deleted to free disk space.  This function handles that deletion from
 *   within the worker thread.
 *
 * WHY THE try/catch?
 *   If the dataset folder is already gone (e.g. concurrent deletion or a crash
 *   left OPFS in an inconsistent state), the error is silently ignored.
 *   "Already deleted" is the desired outcome — not a failure.
 *
 * PARAMETERS:
 *   executionId — execution the temporary dataset belongs to
 *   datasetId   — the temporary dataset to delete
 *
 * CALLED FROM:
 *   src/workers/csv-sort.worker.ts — deletes sorted-run datasets after merge
 *   src/workers/csv-join.worker.ts — deletes partition datasets after join
 */
export async function deleteDatasetFromOPFS(
  executionId: string,
  datasetId: string,
): Promise<void> {
  try {
    const opfsRoot = await navigator.storage.getDirectory();
    const execDir = await opfsRoot
      .getDirectoryHandle("autopilot", { create: false })
      .then((a) => a.getDirectoryHandle("executions", { create: false }))
      .then((e) => e.getDirectoryHandle(executionId, { create: false }));
    await execDir.removeEntry(datasetId, { recursive: true });
  } catch {
    // already gone or never existed — ignore
  }
}

/**
 * ChunkedOPFSWriter
 *
 * WHY THIS EXISTS:
 *   Some workers produce output rows incrementally — they compute and emit rows one
 *   batch at a time rather than computing all rows first and writing at the end.
 *   Writing incrementally allows memory to stay bounded: only one batch of rows
 *   is in memory at once, not the full output.
 *
 *   ChunkedOPFSWriter is a "streaming writer" that accepts row batches via write()
 *   and flushes a chunk file to OPFS every time the internal buffer reaches chunkSize.
 *   At the end, finish() flushes any remaining rows and returns the chunk metadata.
 *
 * WHAT IS A CLASS?
 *   A class is a blueprint for creating objects.  It bundles related data (fields)
 *   and behavior (methods) together.
 *   `new ChunkedOPFSWriter(...)` creates an INSTANCE of the class with its own
 *   private buffer, chunkIndex counter, etc.  Each instance is independent.
 *
 * HOW TO USE THIS CLASS:
 *   1.  Create: const writer = new ChunkedOPFSWriter(executionId, datasetId, chunkSize)
 *   2.  Init:   await writer.init()    ← opens/creates the OPFS directory
 *   3.  Write:  await writer.write(rows)  ← repeat for each batch of rows
 *   4.  Finish: const { chunks, totalBytes, totalRows } = await writer.finish()
 *
 * PRIVATE FIELDS:
 *   dir         — the FileSystemDirectoryHandle for the dataset folder
 *   buffer      — accumulates rows until chunkSize is reached
 *   chunkIndex  — tracks which chunk number to name the next file
 *   totalRows   — total rows written so far (used to compute rowStart/rowEnd)
 *   totalBytes  — total bytes written so far
 *   chunks      — metadata for each flushed chunk
 *   createdAt   — ISO timestamp set once when the writer is constructed
 *
 * WHY `private readonly`?
 *   `private` — the field cannot be accessed outside the class.
 *   `readonly` — the field cannot be reassigned after the constructor sets it.
 *   Together: the executionId, datasetId, and chunkSize cannot be changed accidentally.
 *
 * WHY `!` ON dir?
 *   `private dir!: FileSystemDirectoryHandle` — the `!` is a "definite assignment
 *   assertion".  It tells TypeScript: "trust me, this will be assigned before use,
 *   even though you can't see it in the constructor."  The assignment happens in init().
 *   Without `!`, TypeScript would complain that dir might be undefined.
 *
 * USED IN:
 *   src/workers/csv-parse.worker.ts  — streams parsed rows out as they come in
 *   src/workers/csv-sort.worker.ts   — streams merged output during Phase 2
 *   src/workers/csv-filter.worker.ts — streams filtered rows
 *   src/workers/csv-join.worker.ts   — streams joined rows
 *   (and all other workers that produce output incrementally)
 */
/**
 * Streaming OPFS writer — accepts rows incrementally and flushes to OPFS in
 * chunkSize batches.  Call `finish()` to flush the final partial batch and
 * get the manifest chunks + byte totals.
 *
 * Usage:
 *   const writer = new ChunkedOPFSWriter(executionId, datasetId, chunkSize);
 *   await writer.init();
 *   for (const rows of ...) await writer.write(rows);
 *   const { chunks, totalBytes, totalRows } = await writer.finish();
 */
export class ChunkedOPFSWriter {
  private dir!: FileSystemDirectoryHandle;
  private buffer: DatasetRow[] = [];
  private chunkIndex = 0;
  private totalRows = 0;
  private totalBytes = 0;
  private readonly chunks: OPFSChunkMeta[] = [];
  private readonly createdAt = new Date().toISOString();

  /**
   * constructor()
   *
   * WHY THIS EXISTS:
   *   Stores the configuration values needed for all subsequent operations.
   *   Does NOT open OPFS yet — that happens in init() — because the constructor
   *   cannot be async.  init() must be called before write() or finish().
   *
   * PARAMETERS:
   *   executionId — execution the dataset belongs to
   *   datasetId   — ID for the new dataset being written
   *   chunkSize   — rows per chunk (default 10 000; usually overridden by performance settings)
   */
  constructor(
    private readonly executionId: string,
    private readonly datasetId: string,
    private readonly chunkSize = 10_000,
  ) {}

  /**
   * init()
   *
   * WHY THIS EXISTS:
   *   Opens (or creates) the OPFS directory for this dataset.
   *   Must be called before write() or finish() — this is where `this.dir` is assigned.
   *   Separated from the constructor because async constructors are not possible in JS.
   *
   * CALLED FROM:
   *   Every worker that uses ChunkedOPFSWriter — always called immediately after new.
   */
  async init(): Promise<void> {
    this.dir = await getDatasetDir(this.executionId, this.datasetId, true);
  }

  /**
   * write()
   *
   * WHY THIS EXISTS:
   *   Accepts a batch of rows and appends them to the internal buffer.
   *   When the buffer reaches chunkSize, it flushes one chunk to OPFS and clears
   *   the flushed rows from the buffer.  The buffer may hold up to 2×chunkSize-1
   *   rows at peak (one chunk worth about to flush + one incoming batch).
   *
   * WHY FOR...OF INSTEAD OF push(...rows)?
   *   `this.buffer.push(...rows)` uses the spread operator, which passes all rows
   *   as individual arguments to push().  JavaScript engines have a limit on the
   *   number of function arguments (~65 536 in V8).  With large batches, this can
   *   throw "Maximum call stack size exceeded".  Iterating with for...of avoids this.
   *
   * CALLED FROM:
   *   Workers in their per-chunk or per-row output loops.
   */
  async write(rows: DatasetRow[]): Promise<void> {
    // Avoid large spread calls; they can overflow the JS call stack on big datasets.
    for (const row of rows) this.buffer.push(row);
    while (this.buffer.length >= this.chunkSize) {
      await this._flush(this.buffer.splice(0, this.chunkSize));
    }
  }

  /**
   * forceFlush()
   *
   * WHY THIS EXISTS:
   *   In some workers, after a phase completes, any remaining buffered rows need to
   *   be written even if the buffer hasn't reached chunkSize yet.
   *   forceFlush() writes whatever is in the buffer immediately.
   *   finish() also does this automatically, but some workers call forceFlush()
   *   mid-stream to release memory before starting the next phase.
   *
   * CALLED FROM:
   *   src/workers/csv-sort.worker.ts — flushes each sorted run before starting the next
   */
  async forceFlush(): Promise<void> {
    if (this.buffer.length > 0) await this._flush(this.buffer.splice(0));
  }

  /**
   * finish()
   *
   * WHY THIS EXISTS:
   *   Signals that all rows have been written.
   *   Flushes any remaining rows in the buffer (the final partial chunk).
   *   Returns the complete chunk metadata and totals needed to build a DatasetManifest.
   *
   * RETURNS:
   *   chunks     — array of OPFSChunkMeta, one entry per chunk file written
   *   totalBytes — total bytes across all chunk files
   *   totalRows  — total rows written
   *
   * CALLED FROM:
   *   Workers — called once after all write() calls complete, to get the manifest data.
   */
  async finish(): Promise<{ chunks: OPFSChunkMeta[]; totalBytes: number; totalRows: number }> {
    if (this.buffer.length > 0) await this._flush(this.buffer);
    this.buffer = [];
    return { chunks: this.chunks, totalBytes: this.totalBytes, totalRows: this.totalRows };
  }

  /**
   * _flush() (private)
   *
   * WHY THIS EXISTS:
   *   The internal implementation of writing one chunk to OPFS.
   *   Serializes the rows to JSON, encodes to bytes, writes the file, and records metadata.
   *
   * WHY THE UNDERSCORE PREFIX?
   *   By convention, _ prefix signals "this is an internal method, do not call directly".
   *   TypeScript's `private` keyword enforces this — `_flush` cannot be called outside
   *   the class — but the underscore is an additional visual cue for readers.
   *
   * PARAMETERS:
   *   rows — the exact rows to write in this chunk (already sized to chunkSize or less)
   *
   * SIDE EFFECTS:
   *   Writes a file to OPFS.
   *   Pushes a new OPFSChunkMeta entry to this.chunks.
   *   Increments this.totalBytes, this.totalRows, this.chunkIndex.
   */
  private async _flush(rows: DatasetRow[]): Promise<void> {
    const fn = `chunk-${String(this.chunkIndex).padStart(6, "0")}.json`;
    const bytes = new TextEncoder().encode(JSON.stringify(rows));
    const w = await (await this.dir.getFileHandle(fn, { create: true })).createWritable();
    await w.write(bytes);
    await w.close();
    this.chunks.push({
      chunkIndex: this.chunkIndex,
      fileName: fn,
      rowStart: this.totalRows,
      rowEnd: this.totalRows + rows.length - 1,
      rowCount: rows.length,
      cumulativeRowCount: this.totalRows + rows.length,
      byteSize: bytes.byteLength,
      createdAt: this.createdAt,
    });
    this.totalBytes += bytes.byteLength;
    this.totalRows += rows.length;
    this.chunkIndex++;
  }
}
