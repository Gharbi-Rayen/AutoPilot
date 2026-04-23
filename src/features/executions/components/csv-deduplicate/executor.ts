import type { NodeExecutor } from "@/lib/execution-engine";
import { dispatchWorkerJob } from "@/lib/worker-manager";
import { isDatasetRef } from "@/types/dataset";
import type { DatasetRef } from "@/types/dataset";

export const executor: NodeExecutor = async (_nodeId, nodeData, context, executionId, onProgress) => {
  const {
    inputVariable, sourceVariable, variableName = "duplicateRows",
    column,
  } = nodeData as Record<string, unknown>;

  const resolvedVar = inputVariable ?? sourceVariable;
  const inputRef = typeof resolvedVar === "string"
    ? context[resolvedVar]
    : Object.values(context).find((v) => isDatasetRef(v));
  if (!isDatasetRef(inputRef)) throw new Error("csv-deduplicate: no dataset in context.");

  const result = await dispatchWorkerJob<unknown, {
    duplicatesRef: DatasetRef;
    duplicatesManifest: unknown;
    uniqueRef: DatasetRef;
    uniqueManifest: unknown;
    duplicateCount: number;
    removedCount: number;
  }>("csv-deduplicate", { inputRef, column: column ?? "", executionId, variableName }, onProgress);

  const uniqueVarName = `${variableName as string}_unique`;

  return {
    [variableName as string]: result.duplicatesRef,
    [`${variableName as string}_manifest`]: result.duplicatesManifest,
    [uniqueVarName]: result.uniqueRef,
    [`${uniqueVarName}_manifest`]: result.uniqueManifest,
    duplicateCount: result.duplicateCount,
    removedCount: result.removedCount,
  };
};
