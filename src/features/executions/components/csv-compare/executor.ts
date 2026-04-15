import { NonRetriableError } from "inngest";
import { DATASET_STORAGE } from "@/config/constants";
import { isDatasetRef } from "@/features/executions/server/datasets/dataset-ref";
import {
  availableContextKeys,
  extractInlineRows,
  resolveContextValue,
  withCsvNodeStatus,
} from "../csv-shared/executor-utils";
import type { NodeExecutor } from "../types";

type CsvCompareData = {
  leftVariable?: string;
  rightVariable?: string;
  variableName?: string;
  keyField?: string;
  compareFields?: string | string[];
};

interface DatasetRef {
  kind: "dataset";
  datasetId: string;
  executionId: string;
  variableName: string;
  storage: string;
  manifestVersion: number;
  rowCount: number;
  chunkCount: number;
  byteSize: number;
}

type CsvCompareWorkerResult = {
  isIdentical: boolean;
  summary: string;
  keyField: string | null;
  compareFields: string[];
  addedCount: number;
  removedCount: number;
  changedCount: number;
  unchangedCount: number;
  changedDiffRowCount: number;
  addedRef: DatasetRef | null;
  removedRef: DatasetRef | null;
  changedRef: DatasetRef | null;
};

const KEY_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const parseCommaList = (value: string | undefined): string[] => {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

export const CsvCompareExecutor: NodeExecutor<CsvCompareData> = async ({
  data,
  nodeId,
  executionId,
  context,
  publish,
  step,
}) =>
  withCsvNodeStatus(nodeId, publish, async () => {
    if (!executionId) {
      throw new NonRetriableError(
        "Execution context is missing executionId for csv-compare",
      );
    }

    const variableName = data.variableName?.trim();
    const leftVariable = data.leftVariable?.trim();
    const rightVariable = data.rightVariable?.trim();
    const keyField = data.keyField?.trim();

    if (!variableName) {
      throw new NonRetriableError("Variable name is required");
    }

    if (!leftVariable || !rightVariable) {
      throw new NonRetriableError(
        "Both left and right source variables are required",
      );
    }

    if (keyField && !KEY_NAME_PATTERN.test(keyField)) {
      throw new NonRetriableError(
        `keyField '${keyField}' is unsupported. Use a single field name without nesting.`,
      );
    }

    const leftSource = resolveContextValue(context, leftVariable);
    if (leftSource === undefined) {
      const availableKeys = availableContextKeys(context);
      throw new NonRetriableError(
        `Left source variable '${leftVariable}' not found in workflow context. Available keys: ${availableKeys || "(none)"}`,
      );
    }

    const rightSource = resolveContextValue(context, rightVariable);
    if (rightSource === undefined) {
      const availableKeys = availableContextKeys(context);
      throw new NonRetriableError(
        `Right source variable '${rightVariable}' not found in workflow context. Available keys: ${availableKeys || "(none)"}`,
      );
    }

    const leftInlineRows = extractInlineRows(leftSource);
    const rightInlineRows = extractInlineRows(rightSource);

    const leftRows = isDatasetRef(leftSource)
      ? leftSource.rowCount
      : leftInlineRows.length;
    const rightRows = isDatasetRef(rightSource)
      ? rightSource.rowCount
      : rightInlineRows.length;

    if (leftRows === 0 && rightRows === 0) {
      throw new NonRetriableError(
        "At least one source variable must contain CSV records",
      );
    }

    const requestedFields = Array.isArray(data.compareFields)
      ? data.compareFields
      : parseCommaList(data.compareFields);

    const minRows = Math.min(leftRows, rightRows);
    if (keyField && minRows > DATASET_STORAGE.COMPARE_MAX_INDEX_ROWS) {
      throw new NonRetriableError(
        "Keyed compare blocked because the index side exceeds the safe memory threshold. Reduce input size or compare in partitions.",
      );
    }

    const completionPromise = step.waitForEvent("wait-for-csv-compare", {
      event: "csv/compare.complete",
      match: "data.executionId",
      timeout: "60m",
    });

    const { randomUUID } = await import("node:crypto");
    const addedDatasetId = randomUUID();
    const removedDatasetId = randomUUID();
    const changedDatasetId = randomUUID();

    await step.run("enqueue-csv-compare", async () => {
      const { getCsvCompareQueue } = await import("@/lib/worker-queue");
      const queue = getCsvCompareQueue();
      await queue.add(
        "compare",
        {
          executionId,
          variableName,
          leftSource,
          rightSource,
          leftRows,
          rightRows,
          keyField,
          compareFields: requestedFields,
          addedDatasetId,
          removedDatasetId,
          changedDatasetId,
        },
        {
          jobId: `${executionId}-${variableName}`,
          removeOnComplete: 50,
          removeOnFail: 20,
        },
      );
    });

    const completion = await completionPromise;
    const failureMessage = completion?.data?.error ?? completion?.data?.reason;

    if (typeof failureMessage === "string" && failureMessage.length > 0) {
      throw new NonRetriableError(`CSV compare failed: ${failureMessage}`);
    }

    if (!completion || !completion.data?.result) {
      throw new NonRetriableError(
        "Wait for csv compare timed out after 60 minutes",
      );
    }

    const output = completion.data.result as CsvCompareWorkerResult;

    const addedVarName = `${variableName}__added`;
    const removedVarName = `${variableName}__removed`;
    const changedVarName = `${variableName}__changed`;

    // Dataset refs go as top-level keys so resolveExecutionVariableValue can
    // find them directly (the same pattern used by filter, sort, etc.).
    return {
      [variableName]: {
        _compareResult: true,
        isIdentical: output.isIdentical,
        summary: output.summary,
        keyField: output.keyField,
        compareFields: output.compareFields,
        addedCount: output.addedCount,
        removedCount: output.removedCount,
        changedCount: output.changedCount,
        unchangedCount: output.unchangedCount,
        changedDiffRowCount: output.changedDiffRowCount,
        // Names used by the viewer to request each sub-dataset
        addedVarName: output.addedRef ? addedVarName : null,
        removedVarName: output.removedRef ? removedVarName : null,
        changedVarName: output.changedRef ? changedVarName : null,
      },
      // Top-level dataset refs — resolved directly by the dataset API
      ...(output.addedRef ? { [addedVarName]: output.addedRef } : {}),
      ...(output.removedRef ? { [removedVarName]: output.removedRef } : {}),
      ...(output.changedRef ? { [changedVarName]: output.changedRef } : {}),
    };
  });
