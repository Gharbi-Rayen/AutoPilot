import type { NodeExecutor } from "@/lib/execution-engine";
import { dispatchWorkerJob } from "@/lib/worker-manager";
import type { DatasetRef } from "@/types/dataset";
import { isDatasetRef } from "@/types/dataset";

interface CompareWorkerOutput {
  compareResult: Record<string, unknown>;
  addedRef: DatasetRef;
  removedRef: DatasetRef;
  changedRef: DatasetRef;
  commonRef: DatasetRef;
  schemaDiffRef: DatasetRef;
  addedManifest: unknown;
  removedManifest: unknown;
  changedManifest: unknown;
  commonManifest: unknown;
  schemaDiffManifest: unknown;
}

export const executor: NodeExecutor = async (
  _nodeId,
  nodeData,
  context,
  executionId,
  onProgress,
) => {
  const {
    leftVariable,
    rightVariable,
    variableName = "diffData",
    keyField = "",
    compareFields = "",
  } = nodeData as Record<string, unknown>;

  const baseRef = typeof leftVariable === "string" ? context[leftVariable] : undefined;
  const compareRef = typeof rightVariable === "string" ? context[rightVariable] : undefined;

  if (!isDatasetRef(baseRef))
    throw new Error(
      `CSV Compare: base dataset not found. Check that "${leftVariable}" is a valid parsed dataset variable.`,
    );
  if (!isDatasetRef(compareRef))
    throw new Error(
      `CSV Compare: compare dataset not found. Check that "${rightVariable}" is a valid parsed dataset variable.`,
    );

  const result = await dispatchWorkerJob<unknown, CompareWorkerOutput>(
    "csv-compare",
    {
      baseRef,
      compareRef,
      keyField: keyField ?? "",
      compareFields: compareFields ?? "",
      executionId,
      variableName,
    },
    onProgress,
  );

  // Return the CompareResult under variableName (stored as inlineOutput by the engine)
  // plus the three DatasetRefs and their manifests (stored in db.datasets by the engine).
  return {
    [variableName as string]: result.compareResult,
    [`${variableName as string}_added`]: result.addedRef,
    [`${variableName as string}_removed`]: result.removedRef,
    [`${variableName as string}_changed`]: result.changedRef,
    [`${variableName as string}_common`]: result.commonRef,
    [`${variableName as string}_schema_diff`]: result.schemaDiffRef,
    [`${variableName as string}_added_manifest`]: result.addedManifest,
    [`${variableName as string}_removed_manifest`]: result.removedManifest,
    [`${variableName as string}_changed_manifest`]: result.changedManifest,
    [`${variableName as string}_common_manifest`]: result.commonManifest,
    [`${variableName as string}_schema_diff_manifest`]: result.schemaDiffManifest,
  };
};
