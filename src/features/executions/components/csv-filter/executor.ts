import type { NodeExecutor } from "@/lib/execution-engine";
import { dispatchWorkerJob } from "@/lib/worker-manager";
import { isDatasetRef } from "@/types/dataset";
import type { DatasetRef } from "@/types/dataset";

const OP_MAP: Record<string, string> = {
  eq: "equals",
  ne: "not_equals",
  gt: "greater_than",
  gte: "greater_than_or_equal",
  lt: "less_than",
  lte: "less_than_or_equal",
};

export const executor: NodeExecutor = async (_nodeId, nodeData, context, executionId, onProgress) => {
  const {
    inputVariable, sourceVariable, variableName = "filteredData",
    field, operator, value,
    ...rest
  } = nodeData as Record<string, unknown>;
  const resolvedVar = inputVariable ?? sourceVariable;
  const inputRef = typeof resolvedVar === "string" ? context[resolvedVar] : Object.values(context).find((v) => isDatasetRef(v));
  if (!isDatasetRef(inputRef)) throw new Error("csv-filter: no dataset in context.");
  const mappedOp = OP_MAP[operator as string] ?? operator;
  const conditions = field ? [{ field, operator: mappedOp, value: value ?? "" }] : [];
  const result = await dispatchWorkerJob<unknown, { datasetRef: DatasetRef; manifest: unknown }>("csv-filter", { inputRef, ...rest, conditions, logic: "AND", executionId, variableName }, onProgress);
  return {
    [variableName as string]: result.datasetRef,
    [`${variableName as string}_manifest`]: result.manifest,
  };
};
