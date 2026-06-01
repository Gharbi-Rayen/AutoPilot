import type { NodeExecutor } from "@/lib/execution-engine";
import { dispatchWorkerJob } from "@/lib/worker-manager";

export const executor: NodeExecutor = async (_nodeId, nodeData, context, _executionId, onProgress) => {
  const {
    pdfVariable,
    inputVariable,
    variableName = "pdfText",
    fromPage,
    toPage,
    cleanText = false,
    includeMetadata = false,
  } = nodeData as {
    pdfVariable?: string;
    inputVariable?: string;
    variableName?: string;
    fromPage?: number;
    toPage?: number;
    cleanText?: boolean;
    includeMetadata?: boolean;
  };

  const resolvedVar = pdfVariable ?? inputVariable;
  const fileVar = resolvedVar
    ? context[resolvedVar]
    : Object.values(context).find(
        (v) => typeof v === "object" && v !== null && (v as { kind?: string }).kind === "file",
      );
  if (!fileVar || typeof fileVar !== "object")
    throw new Error("PDF Extract Text: no file found in context.");

  const { buffer, fileName } = fileVar as { buffer: ArrayBuffer; fileName: string };

  const result = await dispatchWorkerJob<
    unknown,
    {
      fullText: string;
      pages: { pageNumber: number; text: string; charCount: number }[];
      numPages: number;
      fromPage: number;
      toPage: number;
      totalCharCount: number;
      metadata?: Record<string, string>;
    }
  >(
    "pdf-extract-text",
    { fileBuffer: buffer, fileName, fromPage, toPage, cleanText, includeMetadata },
    onProgress,
  );

  return {
    [variableName]: {
      kind: "pdf-text",
      fullText: result.fullText,
      pages: result.pages,
      numPages: result.numPages,
      fromPage: result.fromPage,
      toPage: result.toPage,
      totalCharCount: result.totalCharCount,
      fileName,
      ...(result.metadata ? { metadata: result.metadata } : {}),
    },
  };
};
