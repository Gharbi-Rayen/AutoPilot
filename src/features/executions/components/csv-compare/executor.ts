import type { NodeExecutor } from "@/lib/execution-engine";
import { dispatchWorkerJob } from "@/lib/worker-manager";
import type { DatasetRef } from "@/types/dataset";
import { isDatasetRef } from "@/types/dataset";
export const executor: NodeExecutor = async (_nodeId, nodeData, context, executionId, onProgress) => {
  const { leftVariable, rightVariable, variableName = "diffData", ...rest } = nodeData as Record<string, unknown>;
  const baseRef = typeof leftVariable === "string" ? context[leftVariable] : undefined;
  const compareRef = typeof rightVariable === "string" ? context[rightVariable] : undefined;
  if (!isDatasetRef(baseRef)) throw new Error("CSV Compare: base dataset not found.");
  if (!isDatasetRef(compareRef)) throw new Error("CSV Compare: compare dataset not found.");
  const result = await dispatchWorkerJob<unknown, { datasetRef: DatasetRef; manifest: unknown; summary: unknown }>("csv-compare", { baseRef, compareRef, ...rest, executionId, variableName }, onProgress);
  return {
    [variableName as string]: result.datasetRef,
    [`${variableName as string}_manifest`]: result.manifest,
    [`${variableName as string}_summary`]: result.summary,
  };
};
