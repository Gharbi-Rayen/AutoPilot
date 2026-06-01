/**
 * PDF Merge — Browser Web Worker
 *
 * Uses pdf-lib to merge multiple PDF ArrayBuffers into a single PDF.
 * Pages are appended in the order the buffers are provided.
 *
 * INPUT:
 *   pdfBuffers  — array of { buffer: ArrayBuffer, fileName: string }
 *   outputName? — desired file name for the merged PDF (default: "merged.pdf")
 *
 * OUTPUT:
 *   buffer: ArrayBuffer   — merged PDF bytes
 *   fileName: string
 *   size: number          — byte size
 *   pageCount: number     — total pages in merged PDF
 *   sourceCount: number   — number of input PDFs merged
 */

import type { WorkerJobMessage, WorkerOutboundMessage } from "@/lib/worker-manager";
import { PDFDocument } from "pdf-lib";

self.onmessage = async (event: MessageEvent<WorkerJobMessage>) => {
  const { jobId, input } = event.data;
  const {
    pdfBuffers,
    outputName = "merged.pdf",
  } = input as {
    pdfBuffers: { buffer: ArrayBuffer; fileName: string }[];
    outputName?: string;
  };

  const post = (msg: WorkerOutboundMessage) => self.postMessage(msg);

  try {
    if (!pdfBuffers || pdfBuffers.length === 0) {
      throw new Error("PDF Merge: at least one PDF input is required.");
    }

    post({ kind: "progress", jobId, progress: 5, message: `Merging ${pdfBuffers.length} PDF(s)...` });

    const merged = await PDFDocument.create();
    let totalPages = 0;

    for (let i = 0; i < pdfBuffers.length; i++) {
      const { buffer, fileName } = pdfBuffers[i];
      post({
        kind: "progress",
        jobId,
        progress: 5 + Math.floor(((i + 1) / pdfBuffers.length) * 80),
        message: `Loading ${fileName} (${i + 1}/${pdfBuffers.length})...`,
      });
      const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
      const indices = src.getPageIndices();
      const copied = await merged.copyPages(src, indices);
      for (const page of copied) merged.addPage(page);
      totalPages += indices.length;
    }

    post({ kind: "progress", jobId, progress: 90, message: "Saving merged PDF..." });

    const bytes = await merged.save();
    const buffer = bytes.buffer as ArrayBuffer;

    post({
      kind: "result",
      jobId,
      output: { buffer, fileName: outputName, size: bytes.byteLength, pageCount: totalPages, sourceCount: pdfBuffers.length },
    });
  } catch (err) {
    post({ kind: "error", jobId, error: String(err) });
  }
};
