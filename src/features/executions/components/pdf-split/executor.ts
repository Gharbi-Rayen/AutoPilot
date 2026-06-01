import type { NodeExecutor } from "@/lib/execution-engine";
import { dispatchWorkerJob } from "@/lib/worker-manager";

export const executor: NodeExecutor = async (_nodeId, nodeData, context, _executionId, onProgress) => {
  const {
    pdfVariable,
    inputVariable,
    variableName = "pdfSegments",
    pageRanges = "",
    filePrefix,
  } = nodeData as {
    pdfVariable?: string;
    inputVariable?: string;
    variableName?: string;
    pageRanges?: string;
    filePrefix?: string;
  };

  const resolvedVar = pdfVariable ?? inputVariable;
  const fileVar = resolvedVar
    ? context[resolvedVar]
    : Object.values(context).find(
        (v) => typeof v === "object" && v !== null && (v as { kind?: string }).kind === "file",
      );
  if (!fileVar || typeof fileVar !== "object")
    throw new Error("PDF Split: no file found in context.");

  const { buffer, fileName } = fileVar as { buffer: ArrayBuffer; fileName: string };

  const result = await dispatchWorkerJob<
    unknown,
    {
      segments: { buffer: ArrayBuffer; fileName: string; size: number; pages: number[] }[];
      totalSegments: number;
      sourcePageCount: number;
    }
  >(
    "pdf-split",
    { fileBuffer: buffer, fileName, pageRanges, filePrefix },
    onProgress,
  );

  const segments = result.segments.map((seg) => ({
    kind: "file",
    buffer: seg.buffer,
    fileName: seg.fileName,
    size: seg.size,
    type: "application/pdf",
    pages: seg.pages,
  }));

  return {
    [variableName]: segments,
    [`${variableName}_count`]: result.totalSegments,
    [`${variableName}_sourcePages`]: result.sourcePageCount,
  };
};
