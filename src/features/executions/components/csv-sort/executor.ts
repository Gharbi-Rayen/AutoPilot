import type { NodeExecutor } from "@/lib/execution-engine";
import { dispatchWorkerJob } from "@/lib/worker-manager";
import { isDatasetRef } from "@/types/dataset";
import type { DatasetRef } from "@/types/dataset";
export const executor: NodeExecutor = async (_nodeId, nodeData, context, executionId, onProgress) => {
  const { inputVariable, sourceVariable, variableName = "sortedData", ...rest } = nodeData as Record<string, unknown>;
  const resolvedVar = inputVariable ?? sourceVariable;
  const inputRef = typeof resolvedVar === "string" ? context[resolvedVar] : Object.values(context).find((v) => isDatasetRef(v));
  if (!isDatasetRef(inputRef)) throw new Error("csv-sort: no dataset in context.");
  const result = await dispatchWorkerJob<unknown, { datasetRef: DatasetRef; manifest: unknown }>("csv-sort", { inputRef, ...rest, executionId, variableName }, onProgress);
  return {
    [variableName as string]: result.datasetRef,
    [`${variableName as string}_manifest`]: result.manifest,
  };
};
