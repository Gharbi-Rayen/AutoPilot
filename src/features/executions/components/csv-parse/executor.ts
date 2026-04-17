import type { NodeExecutor } from "@/lib/execution-engine";
import { dispatchWorkerJob } from "@/lib/worker-manager";
import type { DatasetRef } from "@/types/dataset";

export const executor: NodeExecutor = async (_nodeId, nodeData, context, executionId, onProgress) => {
  const { csvVariable, inputVariable, variableName = "parsedData" } = nodeData as {
    csvVariable?: string;
    inputVariable?: string;
    variableName?: string;
  };

  const resolvedVar = csvVariable ?? inputVariable;
  const fileVar = resolvedVar
    ? context[resolvedVar]
    : Object.values(context).find((v) => typeof v === "object" && v !== null && (v as { kind?: string }).kind === "file");

  if (!fileVar || typeof fileVar !== "object")
    throw new Error("CSV Parse: no file in context. Connect an Upload File node.");

  const { buffer, fileName, mimeType } = fileVar as { buffer: ArrayBuffer; fileName: string; mimeType: string };
  onProgress(5, "Sending to parser...");

  const fileContent = await new Blob([buffer], { type: mimeType }).text();
  const result = await dispatchWorkerJob<unknown, { manifest: unknown; datasetRef: DatasetRef }>(
    "csv-parse",
    { fileContent, fileName, executionId, variableName },
    onProgress,
  );

  return { [variableName]: result.datasetRef, [`${variableName}_manifest`]: result.manifest };
};
