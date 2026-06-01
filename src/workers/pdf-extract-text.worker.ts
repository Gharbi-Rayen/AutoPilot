/**
 * PDF Extract Text — Browser Web Worker
 *
 * Uses pdfjs-dist to extract text content from a PDF ArrayBuffer.
 * Supports optional page range and metadata extraction.
 *
 * INPUT:
 *   fileBuffer     — PDF as ArrayBuffer
 *   fileName       — original file name (for output labeling)
 *   fromPage?      — 1-based start page (default: 1)
 *   toPage?        — 1-based end page (default: last page)
 *   cleanText?     — if true, collapse whitespace and trim each page's text
 *   includeMetadata? — if true, also extract PDF info dict fields
 *
 * OUTPUT:
 *   fileName, numPages, fromPage, toPage,
 *   pages: { pageNumber, text, charCount }[],
 *   fullText, totalCharCount,
 *   metadata?: { title, author, subject, keywords, creator, producer, creationDate, modDate }
 */

import type { WorkerJobMessage, WorkerOutboundMessage } from "@/lib/worker-manager";

let pdfjsLib: typeof import("pdfjs-dist");

async function getPdfJs() {
  if (!pdfjsLib) {
    pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  }
  return pdfjsLib;
}

self.onmessage = async (event: MessageEvent<WorkerJobMessage>) => {
  const { jobId, input } = event.data;
  const {
    fileBuffer,
    fileName,
    fromPage: rawFrom,
    toPage: rawTo,
    cleanText = false,
    includeMetadata = false,
  } = input as {
    fileBuffer: ArrayBuffer;
    fileName: string;
    fromPage?: number;
    toPage?: number;
    cleanText?: boolean;
    includeMetadata?: boolean;
  };

  const post = (msg: WorkerOutboundMessage) => self.postMessage(msg);

  try {
    post({ kind: "progress", jobId, progress: 5, message: "Loading PDF..." });
    const lib = await getPdfJs();
    const pdf = await lib.getDocument({ data: fileBuffer }).promise;
    const numPages = pdf.numPages;

    const from = Math.max(1, rawFrom ?? 1);
    const to = Math.min(numPages, rawTo ?? numPages);

    if (from > to) {
      throw new Error(`Invalid page range ${from}–${to} (PDF has ${numPages} pages)`);
    }

    post({ kind: "progress", jobId, progress: 15, message: `PDF loaded — ${numPages} pages total, extracting ${from}–${to}` });

    const pages: { pageNumber: number; text: string; charCount: number }[] = [];
    const rangeLen = to - from + 1;

    for (let i = from; i <= to; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent({ includeMarkedContent: false });

      // Join text items, inserting space or newline based on hasEOL
      let text = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        text += item.str;
        if (item.hasEOL) text += "\n";
        else if (item.str && !item.str.endsWith(" ")) text += " ";
      }
      text = cleanText ? text.replace(/[ \t]+/g, " ").trim() : text.trimEnd();

      pages.push({ pageNumber: i, text, charCount: text.length });
      post({
        kind: "progress",
        jobId,
        progress: 15 + Math.floor(((i - from + 1) / rangeLen) * 75),
        message: `Extracted page ${i}/${to}`,
      });
    }

    const fullText = pages.map((p) => p.text).join("\n\n");
    const totalCharCount = fullText.length;

    // Optional PDF metadata extraction
    let metadata: Record<string, string> | undefined;
    if (includeMetadata) {
      try {
        const info = await pdf.getMetadata();
        const raw = info.info as Record<string, unknown>;
        metadata = {};
        for (const key of ["Title", "Author", "Subject", "Keywords", "Creator", "Producer", "CreationDate", "ModDate"]) {
          if (typeof raw[key] === "string") metadata[key.toLowerCase()] = raw[key] as string;
        }
      } catch {
        // metadata unavailable — skip silently
      }
    }

    post({
      kind: "result",
      jobId,
      output: { fileName, numPages, fromPage: from, toPage: to, pages, fullText, totalCharCount, metadata },
    });
  } catch (err) {
    post({ kind: "error", jobId, error: String(err) });
  }
};
