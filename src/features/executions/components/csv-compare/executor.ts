import type { NodeExecutor } from "@/lib/execution-engine";
import { dispatchWorkerJob } from "@/lib/worker-manager";
import { isDatasetRef } from "@/types/dataset";
import type { DatasetRef } from "@/types/dataset";
export const executor: NodeExecutor = async (_nodeId, nodeData, context, executionId, onProgress) => {
  const { baseVariable, compareVariable, variableName = "diffData", ...rest } = nodeData as Record<string, unknown>;
  const baseRef = typeof baseVariable === "string" ? context[baseVariable] : undefined;
  const compareRef = typeof compareVariable === "string" ? context[compareVariable] : undefined;
  if (!isDatasetRef(baseRef)) throw new Error("CSV Compare: base dataset not found.");
  if (!isDatasetRef(compareRef)) throw new Error("CSV Compare: compare dataset not found.");
  const result = await dispatchWorkerJob<unknown, { datasetRef: DatasetRef; manifest: unknown; summary: unknown }>("csv-compare", { baseRef, compareRef, ...rest, executionId, variableName }, onProgress);
  return { [variableName as string]: result.datasetRef };
};
