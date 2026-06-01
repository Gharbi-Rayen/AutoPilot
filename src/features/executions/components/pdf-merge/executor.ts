import type { NodeExecutor } from "@/lib/execution-engine";
import { dispatchWorkerJob } from "@/lib/worker-manager";

export const executor: NodeExecutor = async (_nodeId, nodeData, context, _executionId, onProgress) => {
  const {
    pdfVariables = "",
    variableName = "mergedPdf",
    fileName: outputName,
  } = nodeData as {
    pdfVariables?: string;
    variableName?: string;
    fileName?: string;
  };

  const varNames = pdfVariables
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (varNames.length === 0)
    throw new Error("PDF Merge: no PDF variables configured.");

  const pdfBuffers: { buffer: ArrayBuffer; fileName: string }[] = [];
  for (const varName of varNames) {
    const fileVar = context[varName] as { buffer?: ArrayBuffer; fileName?: string; kind?: string } | undefined;
    if (!fileVar?.buffer)
      throw new Error(`PDF Merge: variable "${varName}" is not a file or has no buffer.`);
    pdfBuffers.push({ buffer: fileVar.buffer, fileName: fileVar.fileName ?? varName });
  }

  const firstFileName = pdfBuffers[0]?.fileName ?? "merged";
  const defaultOutputName = outputName?.trim() || `${firstFileName.replace(/\.pdf$/i, "")}_merged.pdf`;

  const result = await dispatchWorkerJob<
    unknown,
    { buffer: ArrayBuffer; fileName: string; size: number; pageCount: number; sourceCount: number }
  >(
    "pdf-merge",
    { pdfBuffers, outputName: defaultOutputName },
    onProgress,
  );

  return {
    [variableName]: {
      kind: "file",
      buffer: result.buffer,
      fileName: result.fileName,
      size: result.size,
      type: "application/pdf",
      pageCount: result.pageCount,
      sourceCount: result.sourceCount,
    },
  };
};
