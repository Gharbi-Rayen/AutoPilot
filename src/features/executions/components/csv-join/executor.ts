import type { NodeExecutor } from "@/lib/execution-engine";
import { dispatchWorkerJob } from "@/lib/worker-manager";
import { isDatasetRef } from "@/types/dataset";
import type { DatasetRef } from "@/types/dataset";
export const executor: NodeExecutor = async (_nodeId, nodeData, context, executionId, onProgress) => {
  const { leftVariable, rightVariable, variableName = "joinedData", ...rest } = nodeData as Record<string, unknown>;
  const leftRef = typeof leftVariable === "string" ? context[leftVariable] : undefined;
  const rightRef = typeof rightVariable === "string" ? context[rightVariable] : undefined;
  if (!isDatasetRef(leftRef)) throw new Error("CSV Join: left dataset not found.");
  if (!isDatasetRef(rightRef)) throw new Error("CSV Join: right dataset not found.");
  const result = await dispatchWorkerJob<unknown, { datasetRef: DatasetRef; manifest: unknown }>("csv-join", { leftRef, rightRef, ...rest, executionId, variableName }, onProgress);
  return { [variableName as string]: result.datasetRef };
};
