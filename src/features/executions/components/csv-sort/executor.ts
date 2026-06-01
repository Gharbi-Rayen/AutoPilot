import type { NodeExecutor } from "@/lib/execution-engine";
import { dispatchWorkerJob } from "@/lib/worker-manager";
import { isDatasetRef } from "@/types/dataset";
import type { DatasetRef } from "@/types/dataset";

export const executor: NodeExecutor = async (_nodeId, nodeData, context, executionId, onProgress) => {
  const {
    inputVariable, sourceVariable, variableName = "sortedData",
    sortMode, sortField, direction, compareAs, nulls,
    ...rest
  } = nodeData as Record<string, unknown>;
  const resolvedVar = inputVariable ?? sourceVariable;
  const inputRef = typeof resolvedVar === "string" ? context[resolvedVar] : Object.values(context).find((v) => isDatasetRef(v));
  if (!isDatasetRef(inputRef)) throw new Error("csv-sort: no dataset in context.");

  let sortColumns: { field: string; direction: "asc" | "desc" }[];
  if (sortMode === "full-row") {
    const schema = (inputRef as DatasetRef).schema ?? {};
    sortColumns = Object.keys(schema).map((field) => ({
      field,
      direction: (direction as "asc" | "desc") ?? "asc",
    }));
  } else {
    sortColumns = sortField
      ? [{ field: sortField as string, direction: (direction as "asc" | "desc") ?? "asc" }]
      : [];
  }

  const resolvedCompareAs = sortMode === "full-row" ? "string" : compareAs;

  const result = await dispatchWorkerJob<unknown, { datasetRef: DatasetRef; manifest: unknown }>(
    "csv-sort",
    { inputRef, ...rest, sortColumns, compareAs: resolvedCompareAs, nulls, executionId, variableName },
    onProgress,
  );
  return {
    [variableName as string]: result.datasetRef,
    [`${variableName as string}_manifest`]: result.manifest,
  };
};
