import type { NodeExecutor } from "@/lib/execution-engine";
import { dispatchWorkerJob } from "@/lib/worker-manager";
import type { DatasetRef } from "@/types/dataset";

export const executor: NodeExecutor = async (_nodeId, nodeData, context, executionId, onProgress) => {
  const {
    pdfVariable,
    inputVariable,
    variableName = "pdfTables",
    fromPage,
    toPage,
    hasHeaderRow = true,
    colTolerance,
    chunkSize,
  } = nodeData as {
    pdfVariable?: string;
    inputVariable?: string;
    variableName?: string;
    fromPage?: number;
    toPage?: number;
    hasHeaderRow?: boolean;
    colTolerance?: number;
    chunkSize?: number;
  };

  const resolvedVar = pdfVariable ?? inputVariable;
  const fileVar = resolvedVar
    ? context[resolvedVar]
    : Object.values(context).find(
        (v) => typeof v === "object" && v !== null && (v as { kind?: string }).kind === "file",
      );
  if (!fileVar || typeof fileVar !== "object")
    throw new Error("PDF Extract Tables: no file found in context.");

  const { buffer, fileName } = fileVar as { buffer: ArrayBuffer; fileName: string };

  const result = await dispatchWorkerJob<
    unknown,
    { datasetRef: DatasetRef; manifest: unknown; columnNames: string[]; rowCount: number }
  >(
    "pdf-extract-tables",
    { fileBuffer: buffer, fileName, executionId, variableName, fromPage, toPage, hasHeaderRow, colTolerance, chunkSize },
    onProgress,
  );

  return {
    [variableName]: result.datasetRef,
    [`${variableName}_manifest`]: result.manifest,
  };
};
