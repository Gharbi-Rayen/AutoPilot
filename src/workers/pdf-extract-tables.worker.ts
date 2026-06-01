/**
 * PDF Extract Tables — Browser Web Worker
 *
 * Uses pdfjs-dist text content with x/y coordinates to detect and extract
 * table-like data from PDF pages. Writes the result to OPFS as a DatasetRef
 * so it can be piped directly into CSV nodes.
 *
 * ALGORITHM (3 phases):
 *   Phase 1 — Collect: scan all pages in range, record every non-empty text
 *             item with its (x, y, page) position.
 *   Phase 2 — Columns: cluster all x-positions globally into column buckets
 *             (items within COL_TOLERANCE units share a column).
 *   Phase 3 — Rows: group items by (page, y-bucket). Assign each item to its
 *             nearest column. Sort rows top-to-bottom across pages. If
 *             hasHeaderRow is true, use the first row's text as column names.
 *
 * INPUT:
 *   fileBuffer     — PDF as ArrayBuffer
 *   fileName       — original file name
 *   executionId    — current execution ID (for OPFS path)
 *   variableName   — output variable name (used in manifest)
 *   fromPage?      — 1-based start page (default: 1)
 *   toPage?        — 1-based end page (default: last)
 *   hasHeaderRow?  — first row of first page becomes column headers (default: true)
 *   colTolerance?  — x-axis column grouping tolerance in pts (default: 12)
 *   rowTolerance?  — y-axis row grouping tolerance in pts (default: 4)
 *   chunkSize?     — rows per OPFS chunk (from performance settings, default 10 000)
 *
 * OUTPUT:
 *   datasetRef: DatasetRef
 *   manifest: DatasetManifest
 *   columnNames: string[]
 *   rowCount: number
 */

import { createId } from "@paralleldrive/cuid2";
import type { WorkerJobMessage, WorkerOutboundMessage } from "@/lib/worker-manager";
import { DATASET_MANIFEST_VERSION, type DatasetRef, type DatasetRow } from "@/types/dataset";
import { writeToOPFS } from "./_opfs-helpers";

let pdfjsLib: typeof import("pdfjs-dist");

async function getPdfJs() {
  if (!pdfjsLib) {
    pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  }
  return pdfjsLib;
}

type RawItem = { str: string; x: number; y: number; page: number };
type GroupedRow = { page: number; y: number; items: { str: string; colIdx: number }[] };

self.onmessage = async (event: MessageEvent<WorkerJobMessage>) => {
  const { jobId, input } = event.data;
  const {
    fileBuffer,
    fileName,
    executionId,
    variableName = "pdfTables",
    fromPage: rawFrom,
    toPage: rawTo,
    hasHeaderRow = true,
    colTolerance = 12,
    rowTolerance = 4,
    chunkSize = 10_000,
  } = input as {
    fileBuffer: ArrayBuffer;
    fileName: string;
    executionId: string;
    variableName?: string;
    fromPage?: number;
    toPage?: number;
    hasHeaderRow?: boolean;
    colTolerance?: number;
    rowTolerance?: number;
    chunkSize?: number;
  };

  const post = (msg: WorkerOutboundMessage) => self.postMessage(msg);

  try {
    post({ kind: "progress", jobId, progress: 5, message: "Loading PDF..." });
    const lib = await getPdfJs();
    const pdf = await lib.getDocument({ data: fileBuffer }).promise;
    const numPages = pdf.numPages;

    const from = Math.max(1, rawFrom ?? 1);
    const to = Math.min(numPages, rawTo ?? numPages);
    const rangeLen = to - from + 1;

    // ── Phase 1: collect all positioned text items ─────────────────────────────
    const allItems: RawItem[] = [];
    for (let p = from; p <= to; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent({ includeMarkedContent: false });
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        allItems.push({ str: item.str, x: item.transform[4], y: item.transform[5], page: p });
      }
      post({
        kind: "progress",
        jobId,
        progress: 5 + Math.floor(((p - from + 1) / rangeLen) * 40),
        message: `Scanning page ${p}/${to}...`,
      });
    }

    if (allItems.length === 0) {
      // Empty PDF range — write empty dataset
      const datasetId = createId();
      const now = new Date().toISOString();
      const { chunks, totalBytes } = await writeToOPFS(executionId, datasetId, [], chunkSize);
      const manifest = {
        version: DATASET_MANIFEST_VERSION,
        datasetId,
        executionId,
        variableName,
        createdAt: now,
        updatedAt: now,
        rowCount: 0,
        chunkCount: chunks.length,
        byteSize: totalBytes,
        schema: {},
        chunks,
      };
      const datasetRef: DatasetRef = {
        kind: "dataset",
        datasetId,
        executionId,
        variableName,
        rowCount: 0,
        chunkCount: chunks.length,
        byteSize: totalBytes,
        schema: {},
      };
      post({ kind: "result", jobId, output: { datasetRef, manifest, columnNames: [], rowCount: 0 } });
      return;
    }

    post({ kind: "progress", jobId, progress: 48, message: "Detecting columns..." });

    // ── Phase 2: global column detection ──────────────────────────────────────
    const sortedX = allItems.map((i) => i.x).sort((a, b) => a - b);
    const columns: number[] = [];
    for (const x of sortedX) {
      if (!columns.some((c) => Math.abs(c - x) <= colTolerance)) columns.push(x);
    }
    columns.sort((a, b) => a - b);

    // ── Phase 3: group into rows, assign columns ───────────────────────────────
    const groups: GroupedRow[] = [];
    for (const item of allItems) {
      let group = groups.find(
        (g) => g.page === item.page && Math.abs(g.y - item.y) <= rowTolerance,
      );
      if (!group) {
        group = { page: item.page, y: item.y, items: [] };
        groups.push(group);
      }
      let bestCol = 0;
      let bestDist = Infinity;
      for (let i = 0; i < columns.length; i++) {
        const d = Math.abs(columns[i] - item.x);
        if (d < bestDist) { bestDist = d; bestCol = i; }
      }
      group.items.push({ str: item.str, colIdx: bestCol });
    }

    // Sort: page ascending, y descending (top of page first)
    groups.sort((a, b) => (a.page !== b.page ? a.page - b.page : b.y - a.y));

    // Build cell arrays for each row
    const tableRows: { page: number; cells: string[] }[] = groups.map((g) => {
      const cells: string[] = new Array(columns.length).fill("");
      for (const item of g.items) {
        cells[item.colIdx] = `${cells[item.colIdx]} ${item.str}`.trim();
      }
      return { page: g.page, cells };
    });

    // Determine column names
    let colNames: string[];
    let dataStart: number;
    if (hasHeaderRow && tableRows.length > 0) {
      colNames = tableRows[0].cells.map((cell, i) => cell.trim() || `col_${i + 1}`);
      dataStart = 1;
    } else {
      colNames = columns.map((_, i) => `col_${i + 1}`);
      dataStart = 0;
    }

    post({ kind: "progress", jobId, progress: 55, message: "Writing dataset..." });

    // Build DatasetRows
    const datasetRows: DatasetRow[] = [];
    for (let i = dataStart; i < tableRows.length; i++) {
      const { page, cells } = tableRows[i];
      const row: DatasetRow = { page: String(page) };
      for (let j = 0; j < colNames.length; j++) {
        row[colNames[j]] = cells[j] ?? "";
      }
      datasetRows.push(row);
    }

    type FieldType = "string" | "number" | "boolean" | "date" | "null" | "unknown";
    type SchemaMap = Record<string, { type: FieldType; nullable: boolean; sampleValues?: string[] }>;

    // Build schema
    const schema: SchemaMap = {
      page: { type: "number", nullable: false },
    };
    for (const col of colNames) {
      const samples = datasetRows.slice(0, 5).map((r) => String(r[col] ?? "")).filter(Boolean);
      schema[col] = { type: "string", nullable: true, sampleValues: samples };
    }

    // Write to OPFS
    const datasetId = createId();
    const now = new Date().toISOString();
    const { chunks, totalBytes } = await writeToOPFS(executionId, datasetId, datasetRows, chunkSize);

    post({ kind: "progress", jobId, progress: 95, message: "Finalising..." });

    const manifest = {
      version: DATASET_MANIFEST_VERSION,
      datasetId,
      executionId,
      variableName,
      createdAt: now,
      updatedAt: now,
      rowCount: datasetRows.length,
      chunkCount: chunks.length,
      byteSize: totalBytes,
      schema,
      chunks,
    };
    const datasetRef: DatasetRef = {
      kind: "dataset",
      datasetId,
      executionId,
      variableName,
      rowCount: datasetRows.length,
      chunkCount: chunks.length,
      byteSize: totalBytes,
      schema,
    };

    post({
      kind: "result",
      jobId,
      output: { datasetRef, manifest, columnNames: ["page", ...colNames], rowCount: datasetRows.length, fileName },
    });
  } catch (err) {
    post({ kind: "error", jobId, error: String(err) });
  }
};
