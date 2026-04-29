import type { NodeExecutor } from "@/lib/execution-engine";
import { dispatchWorkerJob } from "@/lib/worker-manager";
import { isDatasetRef } from "@/types/dataset";
import type { DatasetRef } from "@/types/dataset";

export const executor: NodeExecutor = async (
  _nodeId,
  nodeData,
  context,
  executionId,
  onProgress,
) => {
  const { sourceVariable, variableName = "transformedData", transforms } =
    nodeData as {
      sourceVariable?: string;
      variableName?: string;
      transforms?: unknown[];
    };

  const inputRef =
    typeof sourceVariable === "string"
      ? context[sourceVariable]
      : Object.values(context).find((v) => isDatasetRef(v));

  if (!isDatasetRef(inputRef)) {
    throw new Error("Column Transform: no dataset found in the execution context.");
  }

  if (!Array.isArray(transforms) || transforms.length === 0) {
    throw new Error("Column Transform: no column transforms configured.");
  }

  const result = await dispatchWorkerJob<
    unknown,
    { datasetRef: DatasetRef; manifest: unknown }
  >(
    "csv-column-transform",
    { inputRef, transforms, executionId, variableName },
    onProgress,
  );

  return {
    [variableName as string]: result.datasetRef,
    [`${variableName as string}_manifest`]: result.manifest,
  };
};
