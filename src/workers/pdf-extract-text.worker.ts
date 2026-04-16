/**
 * PDF Extract Text — Browser Web Worker
 * Uses pdfjs-dist to extract text content from a PDF ArrayBuffer.
 */

import type { WorkerJobMessage, WorkerOutboundMessage } from "@/lib/worker-manager";

// pdfjs-dist must be loaded with the correct workerSrc in browser workers.
// We use the legacy build which is compatible with web workers.
let pdfjsLib: typeof import("pdfjs-dist");

async function getPdfJs() {
  if (!pdfjsLib) {
    pdfjsLib = await import("pdfjs-dist");
    // Point to the pdf.worker bundled by Next.js / the public folder
    pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  }
  return pdfjsLib;
}

self.onmessage = async (event: MessageEvent<WorkerJobMessage>) => {
  const { jobId, input } = event.data;
  const { fileBuffer, fileName } = input as {
    fileBuffer: ArrayBuffer;
    fileName: string;
  };
  const post = (msg: WorkerOutboundMessage) => self.postMessage(msg);

  try {
    post({ kind: "progress", jobId, progress: 10, message: "Loading PDF..." });
    const lib = await getPdfJs();
    const pdf = await lib.getDocument({ data: fileBuffer }).promise;
    const numPages = pdf.numPages;

    post({ kind: "progress", jobId, progress: 20, message: `PDF has ${numPages} pages` });

    const pages: { pageNumber: number; text: string }[] = [];
    for (let i = 1; i <= numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .trim();
      pages.push({ pageNumber: i, text });
      post({
        kind: "progress",
        jobId,
        progress: 20 + Math.floor((i / numPages) * 70),
        message: `Extracted page ${i}/${numPages}`,
      });
    }

    const fullText = pages.map((p) => p.text).join("\n\n");
    post({
      kind: "result",
      jobId,
      output: { fileName, numPages, pages, fullText, charCount: fullText.length },
    });
  } catch (err) {
    post({ kind: "error", jobId, error: String(err) });
  }
};

export {};
