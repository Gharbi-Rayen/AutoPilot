import type { NodeExecutor } from "@/lib/execution-engine";
import { dispatchWorkerJob } from "@/lib/worker-manager";
import { isDatasetRef } from "@/types/dataset";
export const executor: NodeExecutor = async (_nodeId, nodeData, context, _executionId, onProgress) => {
  const { inputVariable, sourceVariable, variableName = "columnStats" } = nodeData as Record<string, unknown>;
  const resolvedVar = inputVariable ?? sourceVariable;
  const inputRef = typeof resolvedVar === "string" ? context[resolvedVar] : Object.values(context).find((v) => isDatasetRef(v));
  if (!isDatasetRef(inputRef)) throw new Error("CSV Column Stats: no dataset in context.");
  const result = await dispatchWorkerJob<unknown, { stats: unknown[]; rowCount: number }>("csv-column-stats", { inputRef }, onProgress);
  return { [variableName as string]: { stats: result.stats, rowCount: result.rowCount } };
};
