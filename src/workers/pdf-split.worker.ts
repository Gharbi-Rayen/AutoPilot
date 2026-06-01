/**
 * PDF Split — Browser Web Worker
 *
 * Uses pdf-lib to split a PDF into multiple files by page ranges.
 *
 * RANGE SYNTAX:
 *   "1-3,5,7-9"  → three segments: pages 1-3, page 5, pages 7-9
 *   ""  or blank  → one file per page (split every page)
 *
 * INPUT:
 *   fileBuffer   — PDF as ArrayBuffer
 *   fileName     — original file name (used to name output segments)
 *   pageRanges?  — range string (blank = split every page)
 *   filePrefix?  — prefix for output file names (default: original name without extension)
 *
 * OUTPUT:
 *   segments: { buffer: ArrayBuffer, fileName: string, size: number, pages: number[] }[]
 *   totalSegments: number
 *   sourcePageCount: number
 */

import type { WorkerJobMessage, WorkerOutboundMessage } from "@/lib/worker-manager";
import { PDFDocument } from "pdf-lib";

function parseRanges(rangeStr: string, numPages: number): number[][] {
  const str = rangeStr.trim();
  if (!str) {
    // One segment per page
    return Array.from({ length: numPages }, (_, i) => [i + 1]);
  }
  const segments: number[][] = [];
  for (const part of str.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (part.includes("-")) {
      const [rawStart, rawEnd] = part.split("-").map(Number);
      const start = Math.max(1, rawStart);
      const end = Math.min(numPages, rawEnd);
      if (start <= end) {
        const pages: number[] = [];
        for (let i = start; i <= end; i++) pages.push(i);
        segments.push(pages);
      }
    } else {
      const n = Number(part);
      if (n >= 1 && n <= numPages) segments.push([n]);
    }
  }
  return segments.length > 0 ? segments : Array.from({ length: numPages }, (_, i) => [i + 1]);
}

function segmentFileName(prefix: string, index: number, total: number, pages: number[]): string {
  const pad = String(index + 1).padStart(String(total).length, "0");
  const pageLabel = pages.length === 1 ? `p${pages[0]}` : `p${pages[0]}-${pages[pages.length - 1]}`;
  return `${prefix}_${pad}_${pageLabel}.pdf`;
}

self.onmessage = async (event: MessageEvent<WorkerJobMessage>) => {
  const { jobId, input } = event.data;
  const {
    fileBuffer,
    fileName,
    pageRanges = "",
    filePrefix: rawPrefix,
  } = input as {
    fileBuffer: ArrayBuffer;
    fileName: string;
    pageRanges?: string;
    filePrefix?: string;
  };

  const post = (msg: WorkerOutboundMessage) => self.postMessage(msg);

  try {
    post({ kind: "progress", jobId, progress: 5, message: "Loading PDF..." });
    const src = await PDFDocument.load(fileBuffer, { ignoreEncryption: true });
    const numPages = src.getPageCount();
    const prefix = rawPrefix?.trim() || fileName.replace(/\.pdf$/i, "") || "split";

    const segments = parseRanges(pageRanges, numPages);
    post({ kind: "progress", jobId, progress: 15, message: `Splitting into ${segments.length} segment(s)...` });

    const results: { buffer: ArrayBuffer; fileName: string; size: number; pages: number[] }[] = [];

    for (let i = 0; i < segments.length; i++) {
      const pages = segments[i];
      const doc = await PDFDocument.create();
      // pdf-lib uses 0-based page indices
      const indices = pages.map((p) => p - 1);
      const copied = await doc.copyPages(src, indices);
      for (const page of copied) doc.addPage(page);
      const bytes = await doc.save();
      results.push({
        buffer: bytes.buffer as ArrayBuffer,
        fileName: segmentFileName(prefix, i, segments.length, pages),
        size: bytes.byteLength,
        pages,
      });
      post({
        kind: "progress",
        jobId,
        progress: 15 + Math.floor(((i + 1) / segments.length) * 80),
        message: `Segment ${i + 1}/${segments.length} (pages ${pages.join(", ")})`,
      });
    }

    post({
      kind: "result",
      jobId,
      output: { segments: results, totalSegments: results.length, sourcePageCount: numPages },
    });
  } catch (err) {
    post({ kind: "error", jobId, error: String(err) });
  }
};
