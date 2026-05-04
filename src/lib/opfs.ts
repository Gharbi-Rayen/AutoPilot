/**
 * FILE: src/lib/opfs.ts
 *
 * PURPOSE:
 *   This file manages reading and writing large dataset files using the browser's
 *   Origin Private File System (OPFS) API.  It is the low-level I/O layer that
 *   all CSV workers and executors depend on for storing and retrieving row data.
 *
 * WHAT IS OPFS (Origin Private File System)?
 *   OPFS is a browser-native private file system.  Every website gets its own
 *   isolated "private folder" that no other website or application can see.
 *   You access it via:
 *     navigator.storage.getDirectory()
 *   This returns a FileSystemDirectoryHandle — think of it as a reference to
 *   a folder on disk.  From there you can create subfolders, create files,
 *   write bytes into those files, and read them back later.
 *
 *   WHY OPFS AND NOT INDEXEDDB?
 *   IndexedDB can store blobs, but it is slow for large sequential files
 *   (hundreds of MB) because the browser serialises every value through a
 *   transactional engine designed for key-value records.
 *   OPFS gives raw file read/write performance — similar to native file I/O —
 *   and is specifically designed for large private files.
 *   In benchmarks, reading a 100 MB file from OPFS is 5-10x faster than from IndexedDB.
 *
 * WHAT IS A FileSystemDirectoryHandle?
 *   A handle is a JavaScript object that points to a folder in OPFS.
 *   It is NOT the actual folder data — it is a reference, like a path.
 *   With a directory handle you can:
 *     handle.getDirectoryHandle("subfolder", { create: true }) → opens/creates subfolder
 *     handle.getFileHandle("file.json", { create: true })      → opens/creates a file
 *     handle.removeEntry("name", { recursive: true })          → deletes entry
 *
 * HOW DATA IS ORGANISED IN OPFS:
 *   autopilot/
 *     executions/
 *       <executionId>/
 *         <datasetId>/
 *           chunk-000000.json   ← rows 0-9999
 *           chunk-000001.json   ← rows 10000-19999
 *           chunk-000002.json   ← rows 20000-29999
 *           ...
 *
 *   Each chunk file is a JSON array of row objects:
 *     [ { "Name": "Alice", "Age": 30 }, { "Name": "Bob", "Age": 25 }, ... ]
 *
 * RELATIONSHIP WITH IndexedDB (db.ts):
 *   The row data lives in OPFS.
 *   The metadata (schema, row counts, chunk list) lives in IndexedDB (DatasetManifest).
 *   Think of IndexedDB as the "table of contents" and OPFS as "the actual book pages".
 *
 * USED IN:
 *   src/workers/_opfs-helpers.ts      — workers use helpers built on top of these functions
 *   src/features/executions/components/execution-dataset-viewer.tsx — paginated viewer
 *   src/features/executions/hooks/use-executions.ts — reads dataset pages for display
 *   src/features/settings/components/performance-settings.tsx — triggers cleanupOrphanedOPFSData
 *   src/features/executions/executors/* — executors call writeDataset after computing results
 */

import { createId } from "@paralleldrive/cuid2";
import type {
  DatasetManifest,
  DatasetChunkMetadata,
  DatasetRow,
} from "@/types/dataset";
import { DATASET_MANIFEST_VERSION } from "@/types/dataset";
import { db } from "@/lib/db";

/**
 * ROOT_DIR
 *
 * WHY THIS EXISTS:
 *   All AutoPilot data in OPFS is placed inside a single top-level folder
 *   called "autopilot".  This acts as a namespace — it prevents AutoPilot
 *   files from accidentally colliding with any other OPFS data in the same
 *   browser origin (if the origin ever hosts other tools).
 *
 * WHAT IS A "CONSTANT"?
 *   A constant is a variable that never changes after it is defined.
 *   In TypeScript, `const` prevents reassignment:
 *     const ROOT_DIR = "autopilot";
 *     ROOT_DIR = "other"; // ← compile error — cannot reassign a const
 */
const ROOT_DIR = "autopilot";

/**
 * CHUNK_SIZE_ROWS
 *
 * WHY THIS EXISTS:
 *   When writing a dataset, rows are split into files of this many rows each.
 *   This default (10 000) is used only in writeDataset() in this file.
 *   Workers use a separate chunkSize injected by worker-manager.ts (which reads
 *   the user's performance settings), so they never use this constant directly.
 *
 * WHY 10 000?
 *   10 000 rows × ~200 bytes/row ≈ 2 MB per file.
 *   2 MB files read and write quickly (< 50 ms on most hardware).
 *   Smaller chunks mean more files and more file-open overhead.
 *   Larger chunks mean more data loaded when you only need a few rows.
 *   10 000 is a comfortable middle ground for the non-worker path.
 */
const CHUNK_SIZE_ROWS = 10_000;

/**
 * getRoot()
 *
 * WHY THIS EXISTS:
 *   Every OPFS operation starts by getting the root directory handle.
 *   This function encapsulates that two-step process:
 *     1. navigator.storage.getDirectory() → browser's OPFS root (same as "C:\")
 *     2. getDirectoryHandle("autopilot", { create: true }) → our app's subfolder
 *
 * WHAT IS navigator.storage.getDirectory()?
 *   This is a browser API (Web Storage API) that returns a Promise resolving
 *   to a FileSystemDirectoryHandle pointing to the OPFS root for this origin.
 *   "origin" means the combination of protocol + domain + port:
 *     https://myapp.com:443  ← one origin
 *     http://localhost:3000  ← a different origin
 *   Each origin gets its own completely isolated OPFS directory.
 *
 * WHAT IS { create: true }?
 *   If the "autopilot" subdirectory does not yet exist, create it automatically.
 *   Without { create: true }, the call would throw a DOMException if the folder
 *   is missing.  A DOMException is a standard browser error object.
 *
 * WHAT IS Promise<FileSystemDirectoryHandle>?
 *   Promise<X> means: "this function is asynchronous — it doesn't finish immediately.
 *   When it does finish, it will give you a value of type X."
 *   FileSystemDirectoryHandle is the type of the folder reference.
 *
 * CALLED FROM:
 *   getExecutionDir() — to navigate down to the executions/ subfolder
 *   deleteExecutionDatasets() — to get the executions/ directory for bulk deletion
 *   cleanupOrphanedOPFSData() — to iterate all execution directories
 */
async function getRoot(): Promise<FileSystemDirectoryHandle> {
  const opfsRoot = await navigator.storage.getDirectory();
  return opfsRoot.getDirectoryHandle(ROOT_DIR, { create: true });
}

/**
 * getExecutionDir()
 *
 * WHY THIS EXISTS:
 *   Each workflow execution stores its datasets in its own subfolder:
 *     autopilot/executions/<executionId>/
 *   This function returns the directory handle for that execution's folder,
 *   creating it if it doesn't exist yet.
 *
 * PARAMETERS:
 *   executionId — the unique ID of the workflow run (a cuid2 string, e.g. "clxm7...")
 *                 This is the same ID stored in the executions IndexedDB table.
 *
 * WHY SEPARATE FOLDERS PER EXECUTION?
 *   Isolation: datasets from run #1 never mix with datasets from run #2.
 *   Easy cleanup: deleting a run means deleting one folder with removeEntry().
 *   Debugging: you can inspect OPFS contents in DevTools and see which execution
 *              each dataset belongs to.
 *
 * CALLED FROM:
 *   getDatasetDir() — needs the execution folder to drill down to the dataset folder
 *   deleteDataset() — needs the execution folder to remove a single dataset entry
 *   deleteExecutionDatasets() — deletes the entire execution folder
 */
async function getExecutionDir(
  executionId: string,
): Promise<FileSystemDirectoryHandle> {
  const root = await getRoot();
  const execs = await root.getDirectoryHandle("executions", { create: true });
  return execs.getDirectoryHandle(executionId, { create: true });
}

/**
 * getDatasetDir()
 *
 * WHY THIS EXISTS:
 *   Each dataset within an execution has its own subfolder:
 *     autopilot/executions/<executionId>/<datasetId>/
 *   Chunk files (chunk-000000.json, chunk-000001.json, …) live inside this folder.
 *   This function navigates to that folder, creating it if needed.
 *
 * PARAMETERS:
 *   executionId — which workflow run this dataset belongs to
 *   datasetId   — the unique ID of this specific dataset (a cuid2 string)
 *
 * WHY SEPARATE FOLDERS PER DATASET?
 *   One execution can produce many datasets (e.g. CSV_DEDUPLICATE produces
 *   two: unique rows and duplicate rows).  Separate folders prevent chunk
 *   filenames from colliding (both would otherwise have "chunk-000000.json").
 *
 * CALLED FROM:
 *   writeDataset() — to write chunk files into
 *   readDataset()  — to read all chunk files from
 *   readDatasetPage() — to open specific chunk files for paged reading
 */
async function getDatasetDir(
  executionId: string,
  datasetId: string,
): Promise<FileSystemDirectoryHandle> {
  const execDir = await getExecutionDir(executionId);
  return execDir.getDirectoryHandle(datasetId, { create: true });
}

/**
 * writeDataset()
 *
 * WHY THIS EXISTS:
 *   This is the primary function for persisting computed row data to OPFS.
 *   After a worker (e.g. csv-filter) finishes computing rows, the main-thread
 *   executor calls writeDataset() to save those rows as chunk files and
 *   get back a DatasetManifest describing what was written.
 *
 * WHAT DOES IT DO STEP BY STEP?
 *   1. Generate a new unique datasetId (via cuid2) if not provided.
 *   2. Open (or create) the OPFS directory for this dataset.
 *   3. Split rows into chunks of CHUNK_SIZE_ROWS (10 000 by default).
 *   4. For each chunk:
 *      a. Serialize rows to a JSON string with JSON.stringify().
 *      b. Convert that string to bytes with TextEncoder.
 *         (Files store raw bytes, not JavaScript strings.)
 *      c. Create a writable stream to the chunk file.
 *      d. Write the bytes, then close the stream.
 *      e. Record chunk metadata (rowStart, rowEnd, byteSize…).
 *   5. Build and return a DatasetManifest containing all chunk metadata.
 *
 * WHAT IS JSON.stringify()?
 *   JSON.stringify() converts a JavaScript object/array into a JSON text string.
 *   Example:  JSON.stringify([{Name:"Alice",Age:30}]) → '[{"Name":"Alice","Age":30}]'
 *   The resulting string can be stored in a file or sent over a network.
 *
 * WHAT IS TextEncoder?
 *   A TextEncoder converts a JavaScript string into a Uint8Array of raw bytes
 *   using UTF-8 encoding.  Files and network streams deal in bytes, not strings.
 *   TextEncoder bridges that gap.
 *     const bytes = new TextEncoder().encode("hello");
 *     // → Uint8Array [104, 101, 108, 108, 111]
 *
 * WHAT IS createWritable()?
 *   fileHandle.createWritable() returns a FileSystemWritableFileStream.
 *   This is a writable stream you can pipe bytes into.
 *   Always call .close() when done — otherwise the file may not be flushed to disk.
 *
 * PARAMETERS:
 *   opts.executionId   — which execution this dataset belongs to
 *   opts.variableName  — the context key this dataset is stored under (e.g. "output")
 *   opts.rows          — the full array of row objects to write
 *   opts.schema        — optional schema (column names + types)
 *   opts.datasetId     — optional; if not provided, a new cuid2 ID is generated
 *
 * RETURNS:
 *   A DatasetManifest — the metadata document describing what was written.
 *   The caller (executor) saves this manifest to IndexedDB and stores a DatasetRef
 *   in the ExecutionContext so the next node can find the data.
 *
 * CALLED FROM:
 *   src/features/executions/executors/csv-parse/executor.ts — after CSV parsing
 *   src/features/executions/executors/csv-filter/executor.ts — after filtering
 *   src/features/executions/executors/csv-sort/executor.ts   — after sorting
 *   (and all other CSV executors that produce a dataset output)
 */
/** Write all rows as chunked JSON files. Returns the manifest. */
export async function writeDataset(opts: {
  executionId: string;
  variableName: string;
  rows: DatasetRow[];
  schema?: DatasetManifest["schema"];
  datasetId?: string;
}): Promise<DatasetManifest> {
  const { executionId, variableName, rows, schema } = opts;
  const datasetId = opts.datasetId ?? createId();
  const dir = await getDatasetDir(executionId, datasetId);
  const now = new Date().toISOString();

  const chunks: DatasetChunkMetadata[] = [];
  let cumulativeRows = 0;
  let totalBytes = 0;

  for (let i = 0; i * CHUNK_SIZE_ROWS < rows.length || i === 0; i++) {
    const start = i * CHUNK_SIZE_ROWS;
    const chunkRows = rows.slice(start, start + CHUNK_SIZE_ROWS);
    if (chunkRows.length === 0) break;

    const fileName = `chunk-${String(i).padStart(6, "0")}.json`;
    const text = JSON.stringify(chunkRows);
    const bytes = new TextEncoder().encode(text);

    const fileHandle = await dir.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(bytes);
    await writable.close();

    cumulativeRows += chunkRows.length;
    totalBytes += bytes.byteLength;

    chunks.push({
      chunkIndex: i,
      fileName,
      rowStart: start,
      rowEnd: start + chunkRows.length - 1,
      rowCount: chunkRows.length,
      cumulativeRowCount: cumulativeRows,
      byteSize: bytes.byteLength,
      createdAt: now,
    });
  }

  return {
    version: DATASET_MANIFEST_VERSION,
    datasetId,
    executionId,
    variableName,
    createdAt: now,
    updatedAt: now,
    rowCount: rows.length,
    chunkCount: chunks.length,
    byteSize: totalBytes,
    schema,
    chunks,
  };
}

/**
 * readDataset()
 *
 * WHY THIS EXISTS:
 *   Reads ALL rows of a dataset into memory at once.
 *   This is only safe for small datasets (< MAX_IN_MEMORY_ROWS, ~200 000 rows).
 *   For large datasets or paginated display, use readDatasetPage() instead.
 *
 * HOW IT WORKS:
 *   1. Opens the OPFS directory for this dataset.
 *   2. Iterates over every chunk listed in the manifest (in order).
 *   3. For each chunk: opens the file, reads its text, parses JSON back to rows.
 *   4. Concatenates all chunk rows into one flat array and returns it.
 *
 * WHAT IS JSON.parse()?
 *   JSON.parse() is the reverse of JSON.stringify().
 *   It converts a JSON text string back into a JavaScript object/array.
 *   Example:  JSON.parse('[{"Name":"Alice"}]') → [{ Name: "Alice" }]
 *
 * WHAT IS file.text()?
 *   fileHandle.getFile() returns a File object (a Web API blob-like type).
 *   Calling .text() on a File returns a Promise<string> — the file's entire
 *   contents decoded as a UTF-8 string.
 *
 * PARAMETERS:
 *   executionId — the execution this dataset belongs to
 *   datasetId   — the dataset's unique ID
 *   manifest    — the DatasetManifest from IndexedDB (lists chunk files)
 *
 * RETURNS:
 *   A flat array of all DatasetRow objects in row order.
 *
 * CALLED FROM:
 *   src/features/executions/executors/* — executors that need all rows at once
 *   src/workers/_opfs-helpers.ts        — worker helpers use a similar pattern
 */
/** Read all rows from a dataset stored in OPFS. */
export async function readDataset(
  executionId: string,
  datasetId: string,
  manifest: DatasetManifest,
): Promise<DatasetRow[]> {
  const dir = await getDatasetDir(executionId, datasetId);
  const allRows: DatasetRow[] = [];

  for (const chunk of manifest.chunks) {
    const fileHandle = await dir.getFileHandle(chunk.fileName);
    const file = await fileHandle.getFile();
    const text = await file.text();
    const rows = JSON.parse(text) as DatasetRow[];
    allRows.push(...rows);
  }

  return allRows;
}

/**
 * readDatasetPage()
 *
 * WHY THIS EXISTS:
 *   The dataset viewer in the UI shows rows in pages (e.g. 100 rows per page).
 *   Loading all 10 million rows just to show page 5 would be extremely slow
 *   and wasteful.  This function reads ONLY the rows needed for the requested page.
 *
 * HOW THE CHUNK-SKIPPING ALGORITHM WORKS:
 *   The manifest's chunk list tells us:
 *     chunk-0: rows 0-9999 (10 000 rows)
 *     chunk-1: rows 10000-19999 (10 000 rows)
 *     chunk-2: rows 20000-29999 (10 000 rows)
 *     ...
 *   To read page 3 at 100 rows/page:
 *     offset = (3-1) * 100 = 200
 *     We need rows 200-299.
 *   Scanning the chunks:
 *     chunk-0: cumulative rows 0-9999 → offset 200 falls inside chunk-0
 *     → open chunk-0, skip first 200 rows, take rows 200-299.
 *     Done. chunk-1 and beyond are never opened.
 *   This makes any random page access O(1) file reads (just the chunks needed).
 *
 * PARAMETERS:
 *   executionId — which execution owns this dataset
 *   datasetId   — the dataset's unique ID
 *   manifest    — the DatasetManifest (used to find which chunks to open)
 *   page        — 1-based page number (page 1 = first page)
 *   pageSize    — how many rows per page (e.g. 100)
 *
 * RETURNS:
 *   An object with:
 *     rows       — the DatasetRow[] for this page
 *     totalRows  — total row count in the dataset (from manifest)
 *     totalPages — total number of pages at this pageSize
 *
 * CALLED FROM:
 *   src/features/executions/components/execution-dataset-viewer.tsx
 *   src/features/executions/hooks/use-executions.ts
 */
/** Read a page of rows from a dataset. */
export async function readDatasetPage(
  executionId: string,
  datasetId: string,
  manifest: DatasetManifest,
  page: number,
  pageSize: number,
): Promise<{ rows: DatasetRow[]; totalRows: number; totalPages: number }> {
  const totalRows = manifest.rowCount;
  const totalPages = Math.ceil(totalRows / pageSize);
  const offset = (page - 1) * pageSize;

  // Identify which chunks contain our page window
  const dir = await getDatasetDir(executionId, datasetId);
  const rows: DatasetRow[] = [];
  let collected = 0;
  let skipped = 0;

  for (const chunk of manifest.chunks) {
    if (rows.length >= pageSize) break;
    if (skipped + chunk.rowCount <= offset) {
      skipped += chunk.rowCount;
      continue;
    }

    const fileHandle = await dir.getFileHandle(chunk.fileName);
    const file = await fileHandle.getFile();
    const text = await file.text();
    const chunkRows = JSON.parse(text) as DatasetRow[];

    const chunkOffset = offset - skipped;
    const take = chunkOffset > 0 ? chunkRows.slice(chunkOffset) : chunkRows;
    const needed = pageSize - collected;
    rows.push(...take.slice(0, needed));
    collected += Math.min(take.length, needed);
    skipped += chunk.rowCount;
  }

  return { rows, totalRows, totalPages };
}

/**
 * deleteDataset()
 *
 * WHY THIS EXISTS:
 *   When a dataset is no longer needed (e.g. a temp dataset created by the sort
 *   worker, or a dataset from a deleted execution), this function removes its
 *   entire folder from OPFS, freeing disk space.
 *
 * HOW IT WORKS:
 *   Calls execDir.removeEntry(datasetId, { recursive: true }).
 *   The `recursive: true` option deletes the folder AND all files inside it.
 *   Without `recursive: true`, the call would fail if the folder is non-empty.
 *
 * WHY THE try/catch?
 *   The dataset folder may already be gone (e.g. the execution was deleted,
 *   and some other cleanup already removed it).  In that case, removeEntry()
 *   throws a DOMException with name "NotFoundError".  We swallow this silently
 *   because "it's already gone" is the desired end state — not an error.
 *
 * PARAMETERS:
 *   executionId — the execution the dataset belongs to
 *   datasetId   — the dataset to delete
 *
 * CALLED FROM:
 *   src/workers/csv-sort.worker.ts        — deletes temp sorted-run datasets after merge
 *   src/workers/csv-join.worker.ts        — deletes partition datasets after join
 *   src/features/executions/executors/*   — cleanup after an execution is deleted
 */
/** Delete all files for a dataset. */
export async function deleteDataset(
  executionId: string,
  datasetId: string,
): Promise<void> {
  try {
    const execDir = await getExecutionDir(executionId);
    await execDir.removeEntry(datasetId, { recursive: true });
  } catch {
    // ignore — may already be gone
  }
}

/**
 * deleteExecutionDatasets()
 *
 * WHY THIS EXISTS:
 *   When an entire execution is deleted from IndexedDB, all OPFS data for that
 *   execution should also be removed.  This function removes the entire execution
 *   folder (autopilot/executions/<executionId>/) and all datasets inside it.
 *
 * DIFFERENCE FROM deleteDataset():
 *   deleteDataset() removes ONE dataset folder.
 *   deleteExecutionDatasets() removes the entire execution folder (which may
 *   contain many dataset folders).
 *
 * WHY { create: false }?
 *   When getting the "executions" directory here, we pass `{ create: false }`.
 *   This means: "if the executions directory does not exist, do NOT create it —
 *   just throw an error."  We catch that error silently.
 *   This prevents accidentally creating the executions directory just to
 *   immediately try to delete it.
 *
 * CALLED FROM:
 *   src/features/executions/executors/* — execution deletion handler
 *   src/features/settings/ — "Delete all data" button
 */
/** Delete all datasets for an execution. */
export async function deleteExecutionDatasets(
  executionId: string,
): Promise<void> {
  try {
    const root = await getRoot();
    const execs = await root.getDirectoryHandle("executions", { create: false });
    await execs.removeEntry(executionId, { recursive: true });
  } catch {
    // ignore
  }
}

/**
 * IterableDir (local type alias)
 *
 * WHY THIS EXISTS:
 *   The official TypeScript type definitions for FileSystemDirectoryHandle do not
 *   include the .entries() async iterator method in all TypeScript versions.
 *   .entries() is part of the File System Access API spec, but TypeScript's
 *   lib types may lag behind.  To avoid a type error, we cast directory handles
 *   to this local type that explicitly declares the .entries() method.
 *
 * WHAT IS an AsyncIterableIterator?
 *   A regular iterator (like a for loop) works synchronously — it produces
 *   the next value instantly.  An AsyncIterableIterator works asynchronously
 *   — each call to .next() returns a Promise, so you must await each value.
 *   The `for await (const x of iter)` syntax handles this automatically.
 *
 * WHAT IS FileSystemHandle?
 *   The common base type for both FileSystemFileHandle and FileSystemDirectoryHandle.
 *   It has a .kind property: "file" or "directory".
 *
 * USED IN:
 *   cleanupOrphanedOPFSData() — to iterate execution and dataset directories
 */
type IterableDir = { entries(): AsyncIterableIterator<[string, FileSystemHandle]> };

/**
 * cleanupOrphanedOPFSData()
 *
 * WHY THIS EXISTS:
 *   Sometimes OPFS accumulates "orphaned" dataset folders — folders that exist
 *   in OPFS but have no corresponding record in IndexedDB.  This happens when:
 *     1. A sort or join worker creates temp datasets that were never cleaned up.
 *     2. An execution was interrupted and the cleanup code never ran.
 *     3. An IndexedDB record was deleted but the OPFS folder was not.
 *   This function scans ALL dataset folders in OPFS, compares them to the
 *   IndexedDB dataset records, and deletes any that are not registered.
 *
 * ALGORITHM:
 *   1. Load all dataset records from IndexedDB → build a Set of valid paths.
 *      Valid path format: "<executionId>/<datasetId>"
 *   2. Walk OPFS: autopilot/executions/<execId>/<dsId>/
 *   3. For each dataset directory found:
 *      - If "<execId>/<dsId>" is NOT in the valid Set → delete it.
 *   4. Return how many orphaned datasets were deleted.
 *
 * WHAT IS a Set?
 *   A Set is a JavaScript collection that holds UNIQUE values.
 *   Lookups are O(1) — checking if a value is in a Set is extremely fast,
 *   regardless of how many items the Set contains.
 *   Example:
 *     const s = new Set(["a", "b", "c"]);
 *     s.has("a") → true
 *     s.has("x") → false
 *
 * WHAT IS for await...of?
 *   This is the async version of for...of.
 *   It iterates over an AsyncIterableIterator, awaiting each value before
 *   moving to the next iteration.
 *
 * RETURNS:
 *   { deletedDatasets: number } — how many orphaned dataset folders were removed.
 *
 * CALLED FROM:
 *   src/features/settings/components/performance-settings.tsx
 *     — "Run garbage collection" button in the Settings page
 */
/**
 * Remove OPFS dataset directories that have no corresponding IndexedDB record.
 * Catches temp datasets from sort/join workers and data from deleted executions
 * that were never cleaned up.
 */
export async function cleanupOrphanedOPFSData(): Promise<{ deletedDatasets: number }> {
  const records = await db.datasets.toArray();
  const validPaths = new Set(records.map((r) => `${r.executionId}/${r.id}`));

  let deletedDatasets = 0;

  try {
    const root = await getRoot();
    const execs = await root.getDirectoryHandle("executions", { create: false });

    for await (const [execId, execEntry] of (execs as unknown as IterableDir).entries()) {
      if (execEntry.kind !== "directory") continue;
      const execDir = execEntry as FileSystemDirectoryHandle;

      for await (const [dsId, dsEntry] of (execDir as unknown as IterableDir).entries()) {
        if (dsEntry.kind !== "directory") continue;
        if (!validPaths.has(`${execId}/${dsId}`)) {
          try {
            await execDir.removeEntry(dsId, { recursive: true });
            deletedDatasets++;
          } catch {
            // ignore — concurrent deletion or permission error
          }
        }
      }
    }
  } catch {
    // OPFS not accessible or executions directory doesn't exist yet
  }

  return { deletedDatasets };
}
