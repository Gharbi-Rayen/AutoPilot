import type { NodeExecutor } from "@/lib/execution-engine";
import { dispatchWorkerJob } from "@/lib/worker-manager";

export const executor: NodeExecutor = async (_nodeId, nodeData, context, _executionId, onProgress) => {
  const { inputVariable, pdfVariable, variableName = "pdfTables" } = nodeData as { inputVariable?: string; pdfVariable?: string; variableName?: string; };
  const resolvedVar = pdfVariable ?? inputVariable;
  const fileVar = resolvedVar ? context[resolvedVar] : Object.values(context).find((v) => typeof v === "object" && v !== null && (v as { kind?: string }).kind === "file");
  if (!fileVar || typeof fileVar !== "object") throw new Error("PDF Extract Tables: no file in context.");
  const { buffer, fileName } = fileVar as { buffer: ArrayBuffer; fileName: string };
  // Use pdf-extract-text worker — table extraction uses same text pipeline
  const result = await dispatchWorkerJob<unknown, { fullText: string; pages: unknown[]; numPages: number }>("pdf-extract-text", { fileBuffer: buffer, fileName }, onProgress);
  return { [variableName]: { pages: result.pages, numPages: result.numPages, fileName } };
};
