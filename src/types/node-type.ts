/**
 * FILE: src/types/node-type.ts
 *
 * PURPOSE:
 *   Defines the complete catalogue of all node types that can exist in a workflow.
 *   Every node — whether it parses a CSV, sorts rows, or merges PDFs — has a
 *   unique identifier stored in this enum.
 *
 * WHAT IS AN ENUM?
 *   An enum (short for "enumeration") is a TypeScript construct that gives
 *   human-readable names to a fixed set of constant values.
 *
 *   Without an enum you might use plain strings everywhere:
 *     node.type = "CSV_PARSE"   // risky — typo "CSV_PARSE" vs "csv_parse" won't be caught
 *
 *   With an enum:
 *     node.type = NodeType.CSV_PARSE   // ← TypeScript checks this at compile time
 *
 *   The enum values are strings (e.g. NodeType.CSV_PARSE === "CSV_PARSE"), which
 *   means they serialise cleanly to JSON and can be stored in IndexedDB.
 *
 * WHY ONE ENUM FOR EVERYTHING?
 *   The execution engine, worker manager, ReactFlow node components, and the
 *   configuration form registry all need to reference the same set of valid
 *   node types.  Keeping them in a single file means there is ONE source of truth.
 *   Adding a new node type = adding one line here + implementing its executor.
 *
 * USED IN:
 *   src/config/node-components.ts    — maps NodeType → React component.
 *   src/lib/execution-engine.ts      — executorRegistry keys.
 *   src/lib/db.ts                    — WorkflowNodeRecord.type, ExecutionNodeOutputRecord.nodeType.
 *   src/workers/*                    — each worker's job type string mirrors these names.
 *   src/features/executions/components/<node-type>/ — every executor folder is named after these.
 *
 * NODE CATEGORIES:
 *   Control flow   — INITIAL, MANUAL_TRIGGER (no data processing; mark workflow start)
 *   File I/O       — UPLOAD_FILE, FILE_EXPORT
 *   CSV operations — 12 processing nodes (parse, filter, sort, join, aggregate, …)
 *   PDF operations — 7 document nodes (extract text/tables, split, merge, fill, generate, sign)
 */

/**
 * NodeType enum
 *
 * WHY THIS EXISTS:
 *   Every node placed on the workflow canvas has a `type` field equal to one of
 *   these values.  The type tells the system:
 *     1. Which React component to render for this node on the canvas.
 *     2. Which executor function to call when the workflow runs.
 *     3. Which Web Worker job to dispatch.
 *     4. Which configuration dialog to open when the user clicks "Configure".
 *
 * CALLED IN:
 *   Everywhere a node type needs to be checked, registered, or dispatched.
 *   Search the codebase for "NodeType." to see all usage sites.
 */
export enum NodeType {
  // ── Control flow ────────────────────────────────────────────────────────────
  /**
   * INITIAL
   * The green "Start" node automatically placed at the beginning of every workflow.
   * It has no configuration and no executor — the execution engine skips it.
   * It serves as the visual entry point and the topological sort root.
   */
  INITIAL = "INITIAL",

  /**
   * MANUAL_TRIGGER
   * A trigger node that the user can name and configure with input variables.
   * Like INITIAL, it is skipped by the executor but marked "success" in the UI
   * so users can see it in the progress panel.
   */
  MANUAL_TRIGGER = "MANUAL_TRIGGER",

  // ── File I/O ────────────────────────────────────────────────────────────────
  /**
   * UPLOAD_FILE
   * Opens the browser's file picker (File System Access API) so the user can
   * select a local file.  The file is read into an ArrayBuffer and stored in OPFS.
   * The ArrayBuffer is also placed in the execution context so the next node
   * (e.g. CSV_PARSE) can use it.
   */
  UPLOAD_FILE = "UPLOAD_FILE",

  // ── CSV operations ──────────────────────────────────────────────────────────
  /**
   * CSV_PARSE
   * Parses a raw CSV file (ArrayBuffer) into a structured dataset stored in OPFS.
   * Uses PapaParse with streaming (step callback) so even multi-GB files are
   * parsed without loading everything into RAM at once.
   * Produces: DatasetRef + DatasetManifest with inferred schema.
   */
  CSV_PARSE = "CSV_PARSE",

  /**
   * CSV_FILTER
   * Removes rows that do not match one or more conditions.
   * Conditions can be combined with AND or OR logic.
   * Supports 12 operators: equals, contains, greater_than, is_empty, etc.
   * Produces: filtered DatasetRef.
   */
  CSV_FILTER = "CSV_FILTER",

  /**
   * CSV_SORT
   * Sorts rows by one or more columns.
   * Uses an external merge sort (two-phase: sorted runs + k-way heap merge)
   * so datasets larger than available RAM can be sorted.
   * Produces: sorted DatasetRef.
   */
  CSV_SORT = "CSV_SORT",

  /**
   * CSV_JOIN
   * Joins two datasets on a key column.
   * Supports inner, left, right, full, and cross joins.
   * Uses an adaptive algorithm: hash join for small right sides,
   * grace hash join (OPFS partitioning) for large right sides.
   * Produces: joined DatasetRef.
   */
  CSV_JOIN = "CSV_JOIN",

  /**
   * CSV_AGGREGATE
   * Groups rows by one or more columns and computes aggregation functions.
   * Functions: sum, avg, min, max, count, count_distinct, first, last.
   * Uses a streaming accumulator pattern — never loads all rows into memory.
   * Produces: aggregated DatasetRef (one row per group).
   */
  CSV_AGGREGATE = "CSV_AGGREGATE",

  /**
   * CSV_DEDUPLICATE
   * Removes duplicate rows (by a key column or by full-row equality).
   * Two-pass algorithm: first counts occurrences, then emits first occurrences.
   * Produces: TWO datasets — unique rows and duplicate rows (with a count column).
   */
  CSV_DEDUPLICATE = "CSV_DEDUPLICATE",

  /**
   * CSV_COMPARE
   * Compares two datasets and produces a diff — similar to git diff but for rows.
   * Produces FIVE datasets: added, removed, changed, common, schema_diff.
   * Uses adaptive algorithm: hash map for small base, grace hash for large base.
   */
  CSV_COMPARE = "CSV_COMPARE",

  /**
   * CSV_CONSECUTIVE_SEQUENCE_ANALYZER
   * Scans a numeric or date column and identifies consecutive sequences
   * (e.g. rows where a "day" column increments by exactly 1).
   * Useful for detecting gaps in time series or ID sequences.
   * Produces: summary DatasetRef (one row per detected sequence).
   */
  CSV_CONSECUTIVE_SEQUENCE_ANALYZER = "CSV_CONSECUTIVE_SEQUENCE_ANALYZER",

  /**
   * CSV_TRANSFORM
   * Applies conditional find-and-replace rules to rows.
   * If a row's cell matches a condition, a specified action is applied:
   * replace value, clear cell, delete row, or set a value.
   * Produces: transformed DatasetRef.
   */
  CSV_TRANSFORM = "CSV_TRANSFORM",

  /**
   * CSV_COLUMN_TRANSFORM
   * Applies a stack of operations to specific columns: prepend, append,
   * regex replace, trim, change case, math formula, or set to a fixed value.
   * Unlike CSV_TRANSFORM (which works row-level with conditions),
   * CSV_COLUMN_TRANSFORM applies unconditional operations to every value in a column.
   * Produces: transformed DatasetRef.
   */
  CSV_COLUMN_TRANSFORM = "CSV_COLUMN_TRANSFORM",

  /**
   * CSV_RESTRUCTURE
   * Rebuilds the output column layout.  Columns can be:
   *   passthrough — kept as-is (possibly reordered)
   *   computed    — a new column derived from other columns via a {{colName}} expression.
   * Columns not listed in the output are dropped.
   * Produces: restructured DatasetRef with a new schema.
   */
  CSV_RESTRUCTURE = "CSV_RESTRUCTURE",

  /**
   * CSV_GENERATE
   * Generates a synthetic CSV dataset (fake data).
   * Useful for testing workflows without needing real data.
   * Produces: generated DatasetRef.
   */
  CSV_GENERATE = "CSV_GENERATE",

  // ── PDF operations ──────────────────────────────────────────────────────────
  /**
   * PDF_EXTRACT_TEXT
   * Uses pdfjs-dist (Mozilla's PDF.js) to extract all text content from a PDF.
   * Returns text per page plus full concatenated text.
   * The output is NOT a CSV dataset — it is an array of { pageNumber, text } objects
   * stored as an inline output in IndexedDB (not in OPFS).
   */
  PDF_EXTRACT_TEXT = "PDF_EXTRACT_TEXT",

  /**
   * PDF_EXTRACT_TABLES
   * Uses heuristic analysis of PDF text positions to detect and extract tables.
   * Returns table data as structured objects.
   */
  PDF_EXTRACT_TABLES = "PDF_EXTRACT_TABLES",

  /**
   * PDF_SPLIT
   * Splits a multi-page PDF into individual page PDFs.
   * Uses pdf-lib to create one PDF per page.
   */
  PDF_SPLIT = "PDF_SPLIT",

  /**
   * PDF_MERGE
   * Merges multiple PDF files into a single PDF.
   * Uses pdf-lib to concatenate pages.
   */
  PDF_MERGE = "PDF_MERGE",

  /**
   * PDF_FILL_FORM
   * Fills the form fields in a PDF (AcroForm).
   * Accepts a mapping of field name → value.
   * Uses pdf-lib to write values into the form.
   */
  PDF_FILL_FORM = "PDF_FILL_FORM",

  /**
   * PDF_GENERATE
   * Creates a new PDF document from scratch.
   * Supports adding text, shapes, and images.
   * Uses pdf-lib.
   */
  PDF_GENERATE = "PDF_GENERATE",

  /**
   * PDF_SIGN
   * Applies a digital signature to a PDF.
   * Uses pdf-lib's signing utilities.
   */
  PDF_SIGN = "PDF_SIGN",

  // ── File export ─────────────────────────────────────────────────────────────
  /**
   * FILE_EXPORT
   * Reads a dataset from OPFS, converts it back to CSV (or another format),
   * and triggers a browser file download so the user can save the result.
   * This is the final node in most CSV workflows.
   */
  FILE_EXPORT = "FILE_EXPORT",
}
