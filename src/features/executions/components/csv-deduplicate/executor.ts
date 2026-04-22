import type { NodeExecutor } from "@/lib/execution-engine";
import { dispatchWorkerJob } from "@/lib/worker-manager";
import { isDatasetRef } from "@/types/dataset";
import type { DatasetRef } from "@/types/dataset";

export const executor: NodeExecutor = async (_nodeId, nodeData, context, executionId, onProgress) => {
  const {
    inputVariable, sourceVariable, variableName = "dedupedData",
    fields, keep, includeDuplicates, duplicatesVariableName,
    ...rest
  } = nodeData as Record<string, unknown>;
  const resolvedVar = inputVariable ?? sourceVariable;
  const inputRef = typeof resolvedVar === "string" ? context[resolvedVar] : Object.values(context).find((v) => isDatasetRef(v));
  if (!isDatasetRef(inputRef)) throw new Error("csv-deduplicate: no dataset in context.");
  const keyFields = fields
    ? String(fields).split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const result = await dispatchWorkerJob<unknown, { datasetRef: DatasetRef; manifest: unknown }>("csv-deduplicate", { inputRef, ...rest, keyFields, keep, includeDuplicates, duplicatesVariableName, executionId, variableName }, onProgress);
  return {
    [variableName as string]: result.datasetRef,
    [`${variableName as string}_manifest`]: result.manifest,
  };
};
