/**
 * FILE: src/workers/csv-parse.worker.ts
 *
 * PURPOSE:
 *   Parses a raw CSV file (provided as an ArrayBuffer) into a structured dataset
 *   stored in OPFS.  Uses PapaParse with a streaming "step" callback so even
 *   multi-gigabyte files are handled without loading all rows into memory at once.
 *
 * WHAT IS PapaParse?
 *   PapaParse is a JavaScript library for parsing CSV files.  It supports:
 *     - Streaming: process one row at a time via the `step` callback instead of
 *       waiting for the entire file to be parsed.
 *     - Header detection: map column headers to object keys automatically.
 *     - Dynamic typing: attempt to convert numbers/booleans (disabled here for safety).
 *     - Delimiter auto-detection: can infer comma, tab, pipe, etc.
 *
 * WHAT IS AN ArrayBuffer?
 *   An ArrayBuffer is a raw binary blob — a fixed block of bytes in memory.
 *   When a user picks a file with the File System Access API, the file's raw bytes
 *   are read into an ArrayBuffer.  The parse worker receives this ArrayBuffer
 *   (transferred, not copied) and converts it into a Blob/File for PapaParse.
 *
 * WHAT IS STREAMING PARSING?
 *   Instead of: "parse the entire 500 MB file into memory, then give me all rows"
 *   Streaming does: "call this callback for each row as it is parsed"
 *   The `step` callback is called once per row.  Rows are accumulated in a buffer.
 *   When the buffer reaches chunkSize rows, they are flushed to OPFS and the buffer
 *   is cleared — keeping RAM usage constant regardless of file size.
 *
 * WHAT IS THE PAUSE/RESUME PATTERN?
 *   OPFS writes are asynchronous (they return Promises).
 *   PapaParse's `step` callback is synchronous (it cannot be async).
 *   When it is time to flush a chunk, we:
 *     1. Call parser.pause() — stops PapaParse from calling `step` again.
 *     2. Await the async flush to OPFS.
 *     3. Call parser.resume() — PapaParse continues parsing.
 *   Without pause/resume, PapaParse would keep pushing rows into `step` while
 *   the async flush is in progress, causing rowBuffer to grow unboundedly.
 *
 * WHAT IS SCHEMA INFERENCE?
 *   After parsing, we analyze a sample of up to 1000 rows to guess each column's
 *   data type (string, number, date, boolean, or null).  This inferred schema is
 *   stored in the DatasetManifest and displayed in the UI as column type badges.
 *
 * INPUT (from WorkerJobMessage.input):
 *   fileBuffer   — the CSV file as an ArrayBuffer (transferred from main thread)
 *   fileName     — the original filename (e.g. "data.csv")
 *   mimeType     — MIME type (default "text/csv")
 *   executionId  — the current execution's ID
 *   variableName — the context key to store the output under
 *   hasHeader    — whether the first row is a header row (default true)
 *   delimiter    — column delimiter: "auto", ",", "\t", "|", etc.
 *   chunkSize    — rows per OPFS chunk (from performance settings)
 *
 * OUTPUT (WorkerResultMessage.output):
 *   manifest   — the DatasetManifest describing what was written to OPFS
 *   datasetRef — a lightweight pointer to the dataset (for the ExecutionContext)
 *   warnings   — any PapaParse parse warnings (e.g. mismatched column count)
 *   fileName   — the original filename (passed through for display)
 *
 * USED IN:
 *   src/features/executions/components/csv-parse/executor.ts
 *     — dispatches this worker via dispatchWorkerJob("csv-parse", ...)
 */

import Papa from "papaparse";
import { createId } from "@paralleldrive/cuid2";
import type { WorkerJobMessage, WorkerOutboundMessage } from "@/lib/worker-manager";
import type { DatasetRow, DatasetSchema, DatasetFieldType } from "@/types/dataset";
import { DATASET_MANIFEST_VERSION } from "@/types/dataset";

// ─── Schema inference ─────────────────────────────────────────────────────────

/**
 * inferFieldType()
 *
 * WHY THIS EXISTS:
 *   Determines the most appropriate DatasetFieldType for a column based on its values.
 *   This allows the UI to show "number" or "date" badges on columns, and downstream
 *   nodes (like CSV_SORT) to choose the right comparison algorithm.
 *
 * HOW IT WORKS:
 *   1. Filter out null/undefined/"" (empty values) — don't let empties skew the guess.
 *   2. If all non-empty values are "true" or "false" → "boolean".
 *   3. If all non-empty values convert to a valid number → "number".
 *   4. If all non-empty values parse as a valid date → "date".
 *   5. Otherwise → "string".
 *
 * WHAT IS Number.isNaN(Number(v))?
 *   Number(v) converts v to a number.  If conversion fails, it returns NaN.
 *   Number.isNaN(NaN) is true; Number.isNaN(42) is false.
 *   So `!Number.isNaN(Number(v))` means "v can be converted to a valid number".
 *
 * WHAT IS Date.parse()?
 *   Date.parse(string) tries to parse a date string and returns a Unix timestamp
 *   (milliseconds since 1970-01-01).  Returns NaN if the string is not a valid date.
 *
 * PARAMETERS:
 *   values — all values in a column (across sampled rows)
 *
 * RETURNS:
 *   DatasetFieldType — "boolean" | "number" | "date" | "string" | "null"
 *
 * CALLED FROM:
 *   inferSchema() — called once per column
 */
function inferFieldType(values: unknown[]): DatasetFieldType {
  const sample = values.filter((v) => v !== null && v !== undefined && v !== "");
  if (sample.length === 0) return "null";
  if (sample.every((v) => v === "true" || v === "false")) return "boolean";
  if (sample.every((v) => !Number.isNaN(Number(v)))) return "number";
  if (sample.every((v) => !Number.isNaN(Date.parse(String(v))))) return "date";
  return "string";
}

/**
 * inferSchema()
 *
 * WHY THIS EXISTS:
 *   Builds a DatasetSchema (a map of column name → field descriptor) from sample rows.
 *   The schema is stored in the DatasetManifest in IndexedDB and used by:
 *     - The UI column type badges
 *     - CSV_SORT to choose numeric vs string comparison
 *     - CSV_COMPARE to detect schema differences between two datasets
 *
 * HOW IT WORKS:
 *   1. Takes the column names from the first row.
 *   2. For each column, extracts all values across sample rows.
 *   3. Calls inferFieldType() on those values.
 *   4. Checks if any value is empty (nullable = true).
 *   5. Takes the first 5 non-empty values as sampleValues (for display in UI).
 *
 * PARAMETERS:
 *   rows — a sample of up to 1000 parsed rows
 *
 * RETURNS:
 *   DatasetSchema — map of field name → { type, nullable, sampleValues }
 *
 * CALLED FROM:
 *   The message handler — called after all rows have been parsed, before sending the result
 */
function inferSchema(rows: DatasetRow[]): DatasetSchema {
  if (rows.length === 0) return {};
  const fields = Object.keys(rows[0]);
  const schema: DatasetSchema = {};
  for (const field of fields) {
    const values = rows.map((r) => r[field]);
    const type = inferFieldType(values);
    const nullable = values.some((v) => v === null || v === undefined || v === "");
    const sampleValues = values
      .filter((v) => v !== null && v !== undefined && v !== "")
      .slice(0, 5)
      .map(String);
    schema[field] = { type, nullable, sampleValues };
  }
  return schema;
}

// ─── Message handler ──────────────────────────────────────────────────────────

/**
 * self.onmessage
 *
 * WHY THIS EXISTS:
 *   This is the worker's entry point.  In a Web Worker, `self` refers to the worker's
 *   own global scope (DedicatedWorkerGlobalScope) — equivalent to `window` in the
 *   main thread but without DOM access.
 *   `self.onmessage` is the handler that fires every time the main thread calls
 *   worker.postMessage(...).  The event.data contains a WorkerJobMessage.
 *
 * WHAT IS `export {}`?
 *   At the bottom of the file.  When TypeScript compiles a file as an ES module
 *   (due to { type: "module" } on the Worker constructor), it requires at least
 *   one import or export statement.  `export {}` is a no-op export that satisfies
 *   this requirement without actually exporting anything.
 *
 * KEY VARIABLES:
 *   post()       — shorthand for self.postMessage; sends progress/result/error messages
 *   rowBuffer    — accumulates rows between chunk flushes; limited to chunkSize rows
 *   schemaSample — up to 1000 rows used for schema inference
 *   flushChunk() — inner async function that writes rowBuffer to an OPFS file
 *   chunks[]     — collects OPFSChunkMeta for every file written (for the manifest)
 *
 * PARSER PAUSE/RESUME FLOW:
 *   PapaParse calls step() synchronously for each row.
 *   When rowBuffer reaches chunkSize:
 *     1. parser.pause() — PapaParse stops calling step()
 *     2. flushChunk(toFlush).then(() => parser.resume())
 *        — async flush completes, then PapaParse resumes
 *   This ensures only one chunk is being written at a time.
 *
 * NO-HEADER MODE:
 *   When hasHeader is false, the CSV has no column names in row 1.
 *   We generate synthetic column names: col_0, col_1, col_2, …
 *   PapaParse parses each row as a string array (not an object).
 *   We convert each array to an object using the generated col_N names.
 */
self.onmessage = async (event: MessageEvent<WorkerJobMessage>) => {
  const { jobId, input } = event.data;
  const {
    fileBuffer,
    fileName,
    mimeType = "text/csv",
    executionId,
    variableName,
    hasHeader = true,
    delimiter = "auto",
    chunkSize = 10_000,
  } = input as {
    fileBuffer: ArrayBuffer;
    fileName: string;
    mimeType?: string;
    executionId: string;
    variableName: string;
    hasHeader?: boolean;
    delimiter?: string;
    chunkSize?: number;
  };

  const post = (msg: WorkerOutboundMessage) => self.postMessage(msg);

  try {
    post({ kind: "progress", jobId, progress: 5, message: "Preparing parser..." });

    const datasetId = createId();

    // Pre-create OPFS directory tree before parsing begins
    const opfsRoot = await navigator.storage.getDirectory();
    const datasetDir = await opfsRoot
      .getDirectoryHandle("autopilot", { create: true })
      .then((a) => a.getDirectoryHandle("executions", { create: true }))
      .then((e) => e.getDirectoryHandle(executionId, { create: true }))
      .then((ex) => ex.getDirectoryHandle(datasetId, { create: true }));

    /**
     * new File([fileBuffer], fileName, { type: mimeType })
     *
     * WHY:
     *   PapaParse accepts a File/Blob as input for browser streaming parsing.
     *   ArrayBuffer is the raw bytes we received; wrapping it in a File gives
     *   PapaParse the interface it needs.
     *   `blobSize` is used to calculate the progress percentage by comparing
     *   result.meta.cursor (bytes parsed so far) to the total file size.
     */
    const blob = new File([fileBuffer], fileName, { type: mimeType });
    const blobSize = blob.size;

    let rowBuffer: DatasetRow[] = [];
    let chunkIndex = 0;
    let totalRows = 0;
    let totalBytes = 0;
    const chunks: {
      chunkIndex: number;
      fileName: string;
      rowStart: number;
      rowEnd: number;
      rowCount: number;
      cumulativeRowCount: number;
      byteSize: number;
      createdAt: string;
    }[] = [];
    const schemaSample: DatasetRow[] = [];
    const parseWarnings: string[] = [];
    const createdAt = new Date().toISOString();

    const explicitDelimiter = delimiter !== "auto" ? delimiter : "";

    /**
     * flushChunk()
     *
     * WHY THIS EXISTS:
     *   Writes a batch of rows to a chunk file in OPFS and records the chunk metadata.
     *   This is an inner function (closure) so it has access to chunkIndex, totalRows,
     *   totalBytes, and chunks without needing them passed as parameters.
     *
     * WHAT IS A CLOSURE?
     *   A closure is a function that "closes over" variables from its outer scope.
     *   flushChunk can access `chunkIndex`, `datasetDir`, `chunks`, etc. directly
     *   because they are defined in the same outer function (onmessage handler).
     *   These are not copies — they are references to the same variables.
     */
    async function flushChunk(rows: DatasetRow[]) {
      const fn = `chunk-${String(chunkIndex).padStart(6, "0")}.json`;
      const bytes = new TextEncoder().encode(JSON.stringify(rows));
      const fh = await datasetDir.getFileHandle(fn, { create: true });
      const w = await fh.createWritable();
      await w.write(bytes);
      await w.close();
      chunks.push({
        chunkIndex,
        fileName: fn,
        rowStart: totalRows,
        rowEnd: totalRows + rows.length - 1,
        rowCount: rows.length,
        cumulativeRowCount: totalRows + rows.length,
        byteSize: bytes.byteLength,
        createdAt,
      });
      totalBytes += bytes.byteLength;
      totalRows += rows.length;
      chunkIndex++;
    }

    /**
     * new Promise<void>((resolve, reject) => { Papa.parse(...) })
     *
     * WHY WRAP IN A PROMISE?
     *   PapaParse uses a callback-based API (complete, error).
     *   We need to await it (wait for it to finish before moving on).
     *   The standard way to convert callbacks to await-able code is to wrap
     *   in a Promise: call resolve() in `complete`, reject() in `error`.
     */
    await new Promise<void>((resolve, reject) => {
      if (hasHeader) {
        Papa.parse<DatasetRow>(blob, {
          header: true,
          skipEmptyLines: true,
          dynamicTyping: false,
          delimiter: explicitDelimiter,
          step: (result, parser) => {
            if (result.errors.length) {
              parseWarnings.push(...result.errors.map((e) => e.message));
            }
            const row = result.data as DatasetRow;
            rowBuffer.push(row);
            if (schemaSample.length < 1000) schemaSample.push(row);

            if (rowBuffer.length >= chunkSize) {
              parser.pause();
              const toFlush = rowBuffer;
              rowBuffer = [];
              const progress = Math.min(85, 10 + Math.round(((result.meta as { cursor?: number }).cursor ?? 0) / blobSize * 75));
              post({ kind: "progress", jobId, progress, message: `Parsed ${(totalRows + toFlush.length).toLocaleString()} rows...` });
              flushChunk(toFlush).then(() => parser.resume()).catch(reject);
            }
          },
          complete: async () => {
            try {
              if (rowBuffer.length > 0) await flushChunk(rowBuffer);
              rowBuffer = [];
              resolve();
            } catch (e) {
              reject(e);
            }
          },
          error: reject,
        });
      } else {
        // No header: parse as arrays, generate col_0, col_1, … column names from first row
        let colNames: string[] | null = null;
        Papa.parse<string[]>(blob, {
          header: false,
          skipEmptyLines: true,
          dynamicTyping: false,
          delimiter: explicitDelimiter,
          step: (result, parser) => {
            if (result.errors.length) {
              parseWarnings.push(...result.errors.map((e) => e.message));
            }
            const arr = result.data as string[];
            if (!colNames) {
              colNames = Array.from({ length: arr.length }, (_, i) => `col_${i}`);
            }
            const row: DatasetRow = {};
            for (let i = 0; i < colNames.length; i++) row[colNames[i]] = arr[i] ?? null;
            rowBuffer.push(row);
            if (schemaSample.length < 1000) schemaSample.push(row);

            if (rowBuffer.length >= chunkSize) {
              parser.pause();
              const toFlush = rowBuffer;
              rowBuffer = [];
              const progress = Math.min(85, 10 + Math.round(((result.meta as { cursor?: number }).cursor ?? 0) / blobSize * 75));
              post({ kind: "progress", jobId, progress, message: `Parsed ${(totalRows + toFlush.length).toLocaleString()} rows...` });
              flushChunk(toFlush).then(() => parser.resume()).catch(reject);
            }
          },
          complete: async () => {
            try {
              if (rowBuffer.length > 0) await flushChunk(rowBuffer);
              rowBuffer = [];
              resolve();
            } catch (e) {
              reject(e);
            }
          },
          error: reject,
        });
      }
    });

    post({ kind: "progress", jobId, progress: 90, message: "Finalizing..." });

    const schema = inferSchema(schemaSample);
    const manifest = {
      version: DATASET_MANIFEST_VERSION,
      datasetId,
      executionId,
      variableName,
      createdAt,
      updatedAt: createdAt,
      rowCount: totalRows,
      chunkCount: chunks.length,
      byteSize: totalBytes,
      schema,
      chunks,
    };

    post({
      kind: "result",
      jobId,
      output: {
        manifest,
        datasetRef: {
          kind: "dataset",
          datasetId,
          executionId,
          variableName,
          rowCount: totalRows,
          chunkCount: chunks.length,
          byteSize: totalBytes,
          schema,
        },
        warnings: parseWarnings,
        fileName,
      },
    });
  } catch (err) {
    post({ kind: "error", jobId, error: String(err) });
  }
};

export {};
