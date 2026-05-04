/**
 * FILE: src/config/constants.ts
 *
 * PURPOSE:
 *   Central place for numeric constants that control the behaviour of the
 *   application's data layer.  Having all magic numbers here (rather than
 *   scattered through the codebase) means you only need to change one file
 *   to tune performance or display limits.
 *
 * USED IN:
 *   src/lib/opfs.ts            — DATASET_CHUNK_SIZE_ROWS for default chunk size.
 *   src/features/executions/   — DATASET_PAGE_SIZE for the dataset viewer.
 *   src/features/workflows/    — PAGINATION.* for the workflow list.
 *   src/hooks/use-entity-search.tsx — PAGINATION.DEFAULT_PAGE_SIZE.
 */

// ─── Pagination ───────────────────────────────────────────────────────────────

/**
 * PAGINATION
 *
 * WHY THIS EXISTS:
 *   The workflow list, execution list, and any other "list" pages need
 *   consistent defaults for how many items to show per page and what page
 *   to start on.  Centralising these prevents each page from picking its
 *   own number and creating an inconsistent UI.
 *
 * WHAT IS PAGINATION?
 *   Pagination is the practice of splitting a large list into "pages".
 *   Instead of showing all 500 workflows at once (slow, hard to read),
 *   we show 10 per page and let the user click "Next" to see more.
 *
 * USED IN:
 *   src/features/workflows/hooks/use-workflows-params.ts — default query params.
 *   src/features/executions/hooks/use-executions-params.ts — same.
 *   src/hooks/use-entity-search.tsx — initial page state.
 *
 * FIELD MEANINGS:
 *   DEFAULT_PAGE      — always start on page 1 (first page).
 *   DEFAULT_PAGE_SIZE — show 10 items per page by default.
 *   MAX_PAGE_SIZE     — no single request can ask for more than 100 items
 *                       (prevents accidental huge queries).
 *   MIN_PAGE_SIZE     — must show at least 1 item per page.
 */
export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_PAGE_SIZE: 10,
  MAX_PAGE_SIZE: 100,
  MIN_PAGE_SIZE: 1,
};

// ─── In-memory row limit ──────────────────────────────────────────────────────

/**
 * MAX_IN_MEMORY_ROWS
 *
 * WHY THIS EXISTS:
 *   Some operations are safe to do entirely in memory (holding all rows in
 *   a JavaScript array) if the dataset is small enough.  This constant defines
 *   the threshold: above 200 000 rows, operations should use OPFS streaming
 *   instead of loading everything into RAM.
 *
 * WHAT IS "IN-MEMORY"?
 *   "In-memory" means the data is held in the JavaScript heap (RAM) as a
 *   live JavaScript array or object.  This is fast to access but limited by
 *   available RAM.  A browser tab typically has 1-4 GB of usable heap.
 *   200 000 rows × ~200 bytes/row ≈ 40 MB — comfortable to hold in memory.
 *
 * USED IN:
 *   src/lib/opfs.ts and worker files that decide whether to use streaming
 *   or in-memory processing.  Note: the user-configurable chunk size from
 *   performance-settings.ts takes precedence in workers.
 */
export const MAX_IN_MEMORY_ROWS = 200_000;

// ─── OPFS chunking ────────────────────────────────────────────────────────────

/**
 * DATASET_CHUNK_SIZE_ROWS
 *
 * WHY THIS EXISTS:
 *   When writing a dataset to OPFS, rows are grouped into "chunk" files.
 *   This is the DEFAULT number of rows per chunk file.
 *
 * WHY 10 000?
 *   10 000 rows × ~200 bytes/row ≈ 2 MB per file.
 *   2 MB files read and write quickly (< 50 ms on most hardware).
 *   10 000 is large enough to amortize file-open overhead, but small enough
 *   that random-access pagination (jump to row 500 000) only reads a few files.
 *
 * NOTE:
 *   This default is overridden by the user's performance-settings selection.
 *   The user can choose 5 000–100 000 rows per chunk in the Settings page.
 *   Workers always use the `chunkSize` value injected by worker-manager.ts,
 *   not this constant directly.
 *
 * USED IN:
 *   src/lib/opfs.ts  — writeDataset() uses this as the default chunk size.
 */
export const DATASET_CHUNK_SIZE_ROWS = 10_000;

// ─── Preview rows ─────────────────────────────────────────────────────────────

/**
 * DATASET_PREVIEW_ROWS
 *
 * WHY THIS EXISTS:
 *   In some places in the UI (e.g. the node's tooltip or a small preview card),
 *   we want to show just a handful of rows as a quick preview without loading
 *   the full dataset.  This constant limits how many rows are shown inline.
 *
 * USED IN:
 *   Components that show "preview" snippets of a dataset (currently 10 rows).
 */
export const DATASET_PREVIEW_ROWS = 10;

// ─── Dataset viewer page size ─────────────────────────────────────────────────

/**
 * DATASET_PAGE_SIZE
 *
 * WHY THIS EXISTS:
 *   The full dataset viewer (shown in the execution detail page) loads and
 *   displays rows in pages of this size.  100 rows per page is enough to be
 *   informative without making the table very long and slow to render.
 *
 * USED IN:
 *   src/features/executions/components/execution-dataset-viewer.tsx
 *     — passes this as the pageSize argument to readDatasetPage().
 *   src/features/executions/hooks/use-executions.ts
 *     — used in the query key and passed to readDatasetPage().
 */
export const DATASET_PAGE_SIZE = 100;
