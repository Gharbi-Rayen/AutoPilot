import type { NodeExecutor } from "@/lib/execution-engine";
import { dispatchWorkerJob } from "@/lib/worker-manager";
import { isDatasetRef } from "@/types/dataset";
import type { DatasetRef } from "@/types/dataset";
export const executor: NodeExecutor = async (_nodeId, nodeData, context, executionId, onProgress) => {
  const { inputVariable, variableName = "transformedData", ...rest } = nodeData as Record<string, unknown>;
  const inputRef = typeof inputVariable === "string" ? context[inputVariable] : Object.values(context).find((v) => isDatasetRef(v));
  if (!isDatasetRef(inputRef)) throw new Error("csv-transform: no dataset in context.");
  const result = await dispatchWorkerJob<unknown, { datasetRef: DatasetRef; manifest: unknown }>("csv-transform", { inputRef, ...rest, executionId, variableName }, onProgress);
  return { [variableName as string]: result.datasetRef };
};
