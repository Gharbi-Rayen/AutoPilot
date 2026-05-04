/**
 * FILE: src/types/dataset.ts
 *
 * PURPOSE:
 *   This file defines every TypeScript type (shape description) that describes
 *   data as it flows through the AutoPilot system.  It is the "common language"
 *   that every part of the codebase — the UI, the execution engine, the workers,
 *   and the OPFS layer — all agree on.
 *
 *   WHAT IS A TypeScript TYPE / INTERFACE?
 *   ----------------------------------------
 *   TypeScript is JavaScript with a type system added on top.  A "type" or
 *   "interface" is a compile-time description of the shape of an object.
 *   It has ZERO runtime cost — it is erased when the code is compiled to JS.
 *   It only exists to help developers catch mistakes early.
 *
 *   Example:
 *     interface Car { make: string; speed: number; }
 *     const c: Car = { make: "Toyota", speed: 120 };
 *     c.color = "red";  // ← TypeScript ERROR: 'color' does not exist on type 'Car'
 *
 * USED IN:
 *   - src/lib/opfs.ts          (reads/writes DatasetManifest, DatasetRow)
 *   - src/lib/db.ts            (stores DatasetManifest inside DatasetRecord)
 *   - src/lib/worker-manager.ts (receives DatasetRef from workers)
 *   - src/lib/execution-engine.ts (threads DatasetRef through ExecutionContext)
 *   - src/workers/*.worker.ts  (every worker uses DatasetRow, DatasetRef, DatasetManifest)
 *   - src/features/executions/ (UI reads DatasetRef to display viewer)
 *
 * CLIENT-SAFE NOTE:
 *   This file has NO imports from Node.js.  It only uses browser-safe types.
 *   This is important because workers run in the browser, not in Node.js.
 */

// ─── Field-level types ────────────────────────────────────────────────────────

/**
 * DatasetFieldType
 *
 * WHY THIS EXISTS:
 *   When a CSV is parsed, all values arrive as raw strings (e.g. "30", "true",
 *   "2024-01-15").  The CSV parse worker inspects the first 1 000 rows and
 *   guesses the "real" type of each column.  This enum-like union stores that
 *   guess so that the UI can show the right filter operators (e.g. "greater
 *   than" only makes sense for numbers, not strings).
 *
 * USED IN:
 *   DatasetFieldSchema.type — attached to every column description.
 *   src/workers/csv-parse.worker.ts — inferFieldType() returns one of these.
 *   src/features/executions/components/csv-filter/dialog.tsx — operator lists.
 *
 * WHAT EACH VALUE MEANS:
 *   "string"  — regular text (names, addresses, codes …)
 *   "number"  — numeric value that can be parsed with Number()
 *   "boolean" — only "true" or "false" values in the column
 *   "date"    — value that can be parsed by Date.parse()
 *   "null"    — every value in the sample is empty / missing
 *   "unknown" — fallback when the worker cannot determine the type
 */
export type DatasetFieldType =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "null"
  | "unknown";

// ─── Schema types ─────────────────────────────────────────────────────────────

/**
 * DatasetFieldSchema
 *
 * WHY THIS EXISTS:
 *   For each column in a CSV, the parse worker stores:
 *     1.  The inferred type (DatasetFieldType above).
 *     2.  Whether the column can be empty ("nullable").
 *     3.  A few example values so the UI can show a hint like
 *         "e.g. Paris, Berlin, Tokyo".
 *
 * USED IN:
 *   DatasetSchema — a record where every key is a column name.
 *   src/workers/csv-parse.worker.ts — inferSchema() produces these.
 *   src/features/executions/components/csv-shared/field-suggestion-input.tsx
 *     — the autocomplete input reads schemas to suggest column names.
 *
 * FIELD MEANINGS:
 *   type         — what kind of data is in this column (see DatasetFieldType).
 *   nullable     — true if ANY row in the 1 000-row sample had an empty cell.
 *   sampleValues — up to 5 real values from the data, shown as UI hints.
 *                  The ? means this field is optional (may not be present).
 */
export interface DatasetFieldSchema {
  type: DatasetFieldType;
  nullable: boolean;
  sampleValues?: string[]; // optional (the ? means: may or may not be present)
}

/**
 * DatasetSchema
 *
 * WHY THIS EXISTS:
 *   A DatasetSchema is simply a dictionary (object) that maps each column name
 *   to its DatasetFieldSchema.  Storing it once in the manifest means every
 *   downstream node can know "what columns does this dataset have, and what
 *   type are they?" without reading any actual row data.
 *
 * USED IN:
 *   DatasetManifest.schema  — persisted with the manifest in IndexedDB.
 *   DatasetRef.schema       — carried with the lightweight reference.
 *   src/features/executions/components/csv-shared/use-upstream-variable-metadata.ts
 *     — hook that reads schemas to power the field-suggestion-input.
 *
 * WHAT Record<K, V> MEANS IN TYPESCRIPT:
 *   Record<string, DatasetFieldSchema> = an object where every key is a string
 *   (the column name) and every value is a DatasetFieldSchema.
 *   Equivalent to writing: { [columnName: string]: DatasetFieldSchema }
 */
export type DatasetSchema = Record<string, DatasetFieldSchema>;

// ─── Row type ─────────────────────────────────────────────────────────────────

/**
 * DatasetRow
 *
 * WHY THIS EXISTS:
 *   A single row of CSV data is just an object where every key is a column
 *   name and every value is whatever was in that cell.  We use `unknown` (not
 *   `string`) because even though CSV is text, values might have been coerced
 *   to numbers or booleans during processing.
 *
 * USED IN:
 *   Every worker — reads and writes arrays of DatasetRow.
 *   src/lib/opfs.ts — writeDataset() / readDataset() work with DatasetRow[].
 *   src/features/executions/components/execution-dataset-viewer.tsx — displays rows.
 *
 * EXAMPLE:
 *   { name: "Alice", age: "30", city: "Paris", active: "true" }
 *
 * WHY unknown INSTEAD OF string?
 *   After an aggregate or restructure worker runs, a cell value might actually
 *   be a number (e.g. the sum of a column) or null.  Using `unknown` is safer
 *   than `string` because TypeScript will force us to check the type before
 *   treating it as a string.
 */
export type DatasetRow = Record<string, unknown>;

// ─── Manifest version ─────────────────────────────────────────────────────────

/**
 * DATASET_MANIFEST_VERSION
 *
 * WHY THIS EXISTS:
 *   This constant is embedded in every DatasetManifest we write to IndexedDB.
 *   If we ever change the shape of DatasetManifest in a future version of
 *   AutoPilot, we can read this version number and migrate old data gracefully
 *   instead of crashing.
 *
 * USED IN:
 *   Every worker — written into the manifest they create.
 *   DatasetManifest.version — the field it populates.
 *
 * WHAT "as const" MEANS IN TYPESCRIPT:
 *   Without `as const`, TypeScript would infer the type as `number`.
 *   With `as const`, the type is narrowed to the literal `1`.
 *   This lets DatasetManifest.version be typed as `1` (not just `number`),
 *   which provides an extra layer of type safety.
 */
export const DATASET_MANIFEST_VERSION = 1 as const;

// ─── Chunk metadata ───────────────────────────────────────────────────────────

/**
 * DatasetChunkMetadata
 *
 * WHY THIS EXISTS:
 *   Large datasets are split into multiple files ("chunks") in OPFS.
 *   Each chunk is a JSON file containing up to chunkSize rows (default 10 000).
 *   DatasetChunkMetadata describes ONE of those files: its name, where it sits
 *   in the overall row sequence, and how large it is.
 *
 *   This metadata is stored in an array inside DatasetManifest.  When we need
 *   to read page 500 of a 10 M row dataset, we look at this array to find
 *   which chunk(s) contain rows 49 900–50 000 WITHOUT reading all other chunks.
 *
 * USED IN:
 *   DatasetManifest.chunks  — the manifest stores an array of these.
 *   src/lib/opfs.ts — readDatasetPage() uses this to skip irrelevant chunks.
 *   src/workers/_opfs-helpers.ts — ChunkedOPFSWriter produces these.
 *
 * FIELD MEANINGS:
 *   chunkIndex        — 0-based index of this chunk (0 = first file).
 *   fileName          — e.g. "chunk-000000.json", "chunk-000001.json" …
 *   rowStart          — the absolute index of the first row in this chunk.
 *                       e.g. chunk 3 with 10 000 rows/chunk → rowStart = 30 000
 *   rowEnd            — the absolute index of the last row.  rowEnd = rowStart + rowCount - 1
 *   rowCount          — how many rows are in this specific chunk.
 *   cumulativeRowCount— total rows written up to AND INCLUDING this chunk.
 *                       e.g. after chunks 0, 1, 2 with 10K each → cumulative = 30 000
 *   byteSize          — how many bytes this JSON file takes on disk.
 *   createdAt         — ISO 8601 timestamp when this chunk was written.
 */
export interface DatasetChunkMetadata {
  chunkIndex: number;
  fileName: string;
  rowStart: number;
  rowEnd: number;
  rowCount: number;
  cumulativeRowCount: number;
  byteSize: number;
  createdAt: string;
}

// ─── Manifest ─────────────────────────────────────────────────────────────────

/**
 * DatasetManifest
 *
 * WHY THIS EXISTS:
 *   When a worker finishes processing a dataset (e.g. sorting 10 million rows),
 *   it cannot return all 10 million rows to the main thread — that would use
 *   gigabytes of RAM and freeze the browser.
 *
 *   Instead, the worker writes rows to OPFS files and returns a "manifest" —
 *   a compact summary document that describes the dataset:
 *     • How many rows?
 *     • How many chunks (files)?
 *     • What are the columns and their types?
 *     • Where is each chunk stored?
 *
 *   This manifest is persisted to IndexedDB (the datasets table in db.ts).
 *   The actual row data stays in OPFS.
 *
 * ANALOGY:
 *   The manifest is like the table of contents in a book.  The book (row data)
 *   lives in OPFS.  The table of contents (manifest) lives in IndexedDB.
 *   To find chapter 5, you read the table of contents first, then jump straight
 *   to the right page — you don't read from chapter 1.
 *
 * USED IN:
 *   src/lib/opfs.ts — writeDataset() returns one; readDataset() uses one.
 *   src/lib/db.ts   — stored inside DatasetRecord.manifest.
 *   src/lib/execution-engine.ts — persisted after every successful node.
 *   Every worker — produced and returned as the worker's output.
 *
 * FIELD MEANINGS:
 *   version      — always 1 for now; used for future migration (see DATASET_MANIFEST_VERSION).
 *   datasetId    — unique ID for this dataset (cuid2 string, e.g. "clh3x2k…").
 *   executionId  — which execution run produced this dataset.
 *   variableName — the name used to reference this dataset in the execution context.
 *                  e.g. "parsedData", "filteredData", "sortedData".
 *   createdAt    — ISO timestamp when the dataset was created.
 *   updatedAt    — ISO timestamp of the last modification (usually same as createdAt).
 *   rowCount     — total number of rows across all chunks.
 *   chunkCount   — number of chunk files in OPFS.
 *   byteSize     — total bytes across all chunk files.
 *   schema       — column descriptions (optional — not all operations re-infer the schema).
 *   chunks       — array of per-chunk metadata (see DatasetChunkMetadata above).
 */
export interface DatasetManifest {
  version: typeof DATASET_MANIFEST_VERSION;
  datasetId: string;
  executionId: string;
  variableName: string;
  createdAt: string;
  updatedAt: string;
  rowCount: number;
  chunkCount: number;
  byteSize: number;
  schema?: DatasetSchema;
  chunks: DatasetChunkMetadata[];
}

// ─── Dataset reference (the lightweight pointer) ─────────────────────────────

/**
 * DatasetRef
 *
 * WHY THIS EXISTS:
 *   Nodes in a workflow pass their output to the next node via the
 *   "execution context" (a plain JS object).  If a node produced 10 million
 *   rows, we cannot put all those rows in the context — that would use gigabytes
 *   of RAM and crash the browser.
 *
 *   Instead, the node puts a DatasetRef into the context.  A DatasetRef is a
 *   tiny (~100 byte) object that says "the data is stored in OPFS at this
 *   location."  The next node reads the ref, goes to OPFS, and reads whatever
 *   chunks it actually needs.
 *
 * ANALOGY:
 *   Imagine leaving a sticky note that says "the report is in the filing cabinet,
 *   drawer 3, folder B" instead of carrying around all 500 pages of the report.
 *   The sticky note IS the DatasetRef.  The filing cabinet IS OPFS.
 *
 * DIFFERENCE FROM DatasetManifest:
 *   DatasetManifest = the full table of contents (every chunk detail, schema).
 *   DatasetRef      = the quick summary (just enough to find and describe it).
 *   The ref is a strict subset of the manifest's information.
 *
 * USED IN:
 *   src/lib/execution-engine.ts — context values are DatasetRef.
 *   Every worker input/output — workers receive and return DatasetRef.
 *   src/features/executions/components/ — the UI reads DatasetRef to show viewer.
 *
 * FIELD MEANINGS:
 *   kind         — always "dataset"; used as a type discriminator so code can
 *                  check `if (value.kind === "dataset")` to know it's a ref.
 *   datasetId    — matches the OPFS directory name and the IndexedDB record id.
 *   executionId  — tells OPFS which execution directory to look in.
 *   variableName — the name this dataset is known by in the execution context.
 *   rowCount     — total rows (so the UI can show "1 500 000 rows" without reading data).
 *   chunkCount   — total chunks (so workers know how many OPFS files to read).
 *   byteSize     — total bytes (for storage quota display in the UI).
 *   schema       — column types, carried along so downstream nodes know the shape.
 */
export interface DatasetRef {
  kind: "dataset";
  datasetId: string;
  executionId: string;
  variableName: string;
  rowCount: number;
  chunkCount: number;
  byteSize: number;
  schema?: DatasetSchema;
}

// ─── Type guard ───────────────────────────────────────────────────────────────

/**
 * isDatasetRef
 *
 * WHY THIS EXISTS:
 *   The execution context (ExecutionContext in execution-engine.ts) is typed as
 *   `Record<string, unknown>` — it can hold ANYTHING.  To safely check whether
 *   a context value is a DatasetRef, we need a "type guard" function.
 *
 * WHAT IS A TYPE GUARD?
 *   A type guard is a function that returns `boolean` but with a special return
 *   type annotation: `value is DatasetRef`.  When you call it inside an `if`
 *   block, TypeScript automatically narrows the type:
 *
 *     const val: unknown = context["parsedData"];
 *     if (isDatasetRef(val)) {
 *       val.rowCount; // ← TypeScript knows `val` is DatasetRef here
 *     }
 *
 * HOW IT WORKS:
 *   It checks three things at runtime:
 *   1. The value is an object (not null, not a primitive).
 *   2. The value is not null (typeof null === "object" in JS, so we check explicitly).
 *   3. The value has `kind === "dataset"` (our discriminator field).
 *
 * USED IN:
 *   src/lib/execution-engine.ts — filters DatasetRefs from newVars to persist manifests.
 */
export const isDatasetRef = (value: unknown): value is DatasetRef =>
  typeof value === "object" &&
  value !== null &&
  (value as DatasetRef).kind === "dataset";

// ─── Pagination result ────────────────────────────────────────────────────────

/**
 * DatasetPageRowsResult
 *
 * WHY THIS EXISTS:
 *   The dataset viewer in the UI shows rows 100 at a time (paginated).
 *   When the user navigates to page 5, we call readDatasetPage() in opfs.ts.
 *   That function returns a DatasetPageRowsResult — the current page of rows
 *   PLUS enough information for the UI to render "Page 5 of 150" and navigation
 *   buttons.
 *
 * USED IN:
 *   src/lib/opfs.ts — readDatasetPage() returns this.
 *   src/features/executions/components/execution-dataset-viewer.tsx — displays it.
 *   src/features/executions/hooks/use-executions.ts — the query function returns this.
 *
 * FIELD MEANINGS:
 *   page       — the page number that was requested (1-based, first page = 1).
 *   pageSize   — how many rows per page (default 100 per DATASET_PAGE_SIZE constant).
 *   totalRows  — total rows in the entire dataset (from the manifest).
 *   totalPages — ceil(totalRows / pageSize).
 *   rows       — the actual rows for this page (array of DatasetRow objects).
 */
export interface DatasetPageRowsResult {
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
  rows: DatasetRow[];
}

// ─── Schema helpers ───────────────────────────────────────────────────────────

/**
 * getFieldSchema
 *
 * WHY THIS EXISTS:
 *   A simple helper to safely look up one column's schema inside a DatasetSchema.
 *   Using optional chaining (`?.`) makes it safe even if schema is undefined.
 *
 * WHAT IT DOES:
 *   Returns the DatasetFieldSchema for a given column name, or undefined if
 *   the schema is not available or the column doesn't exist in it.
 *
 * USED IN:
 *   resolveComparableFieldType() below.
 *   src/features/executions/components/csv-shared/ — to read column types for UI hints.
 *
 * @param schema    — the full dataset schema (may be undefined).
 * @param fieldName — the column name to look up.
 */
export const getFieldSchema = (
  schema: DatasetSchema | undefined,
  fieldName: string,
): DatasetFieldSchema | undefined => schema?.[fieldName];

/**
 * resolveComparableFieldType
 *
 * WHY THIS EXISTS:
 *   When a user picks a sort column, we need to know whether to compare values
 *   as strings, numbers, or dates.  This function looks up the column type in
 *   the schema and returns a safe type that can be used as a comparator key.
 *
 * HOW IT WORKS:
 *   1. Calls getFieldSchema() to find the column's DatasetFieldSchema.
 *   2. If the type is "number", "boolean", or "date", returns that type.
 *   3. Otherwise (string, null, unknown) defaults to "string" — the safest
 *      comparison (every value can be compared as a string).
 *
 * USED IN:
 *   src/features/executions/components/csv-sort/dialog.tsx — fills the
 *   "compare as" dropdown with the inferred type.
 *
 * @param schema    — the full dataset schema (may be undefined).
 * @param fieldName — the column to resolve.
 */
export const resolveComparableFieldType = (
  schema: DatasetSchema | undefined,
  fieldName: string,
): Extract<DatasetFieldType, "string" | "number" | "boolean" | "date"> => {
  const t = getFieldSchema(schema, fieldName)?.type;
  if (t === "number" || t === "boolean" || t === "date") return t;
  return "string";
};
