import type { NodeExecutor } from "@/lib/execution-engine";
import { dispatchWorkerJob } from "@/lib/worker-manager";

export const executor: NodeExecutor = async (_nodeId, nodeData, context, _executionId, onProgress) => {
  const { inputVariable, variableName = "pdfText" } = nodeData as { inputVariable?: string; variableName?: string; };
  const fileVar = inputVariable ? context[inputVariable] : Object.values(context).find((v) => typeof v === "object" && v !== null && (v as { kind?: string }).kind === "file");
  if (!fileVar || typeof fileVar !== "object") throw new Error("PDF Extract Text: no file in context.");
  const { buffer, fileName } = fileVar as { buffer: ArrayBuffer; fileName: string };
  const result = await dispatchWorkerJob<unknown, { fullText: string; pages: unknown[]; numPages: number }>("pdf-extract-text", { fileBuffer: buffer, fileName }, onProgress);
  return { [variableName]: { fullText: result.fullText, pages: result.pages, numPages: result.numPages, fileName } };
};
