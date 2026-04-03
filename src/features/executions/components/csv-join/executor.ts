import { NonRetriableError } from "inngest";
import { DATASET_STORAGE } from "@/config/constants";
import { estimateJoinCardinality } from "@/features/executions/server/datasets/cardinality-estimator";
import { isDatasetRef } from "@/features/executions/server/datasets/dataset-ref";
import { datasetService } from "@/features/executions/server/datasets/dataset-service";
import { hashJoinRows } from "@/features/executions/server/datasets/hash-join";
import {
  type JoinType,
  planJoinStrategy,
} from "@/features/executions/server/datasets/join-planner";
import {
  availableContextKeys,
  extractInlineRows,
  resolveContextValue,
  streamContextRows,
  toDatasetRefOutput,
  withCsvNodeStatus,
} from "../csv-shared/executor-utils";
import type { NodeExecutor } from "../types";

type CsvJoinData = {
  leftVariable?: string;
  rightVariable?: string;
  leftKey?: string;
  rightKey?: string;
  variableName?: string;
  joinType?: JoinType;
  allowPartitionedLargeJoin?: boolean;
};

export const CsvJoinExecutor: NodeExecutor<CsvJoinData> = async ({
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
        "Execution context is missing executionId for csv-join",
      );
    }

    const variableName = data.variableName?.trim();
    const leftVariable = data.leftVariable?.trim();
    const rightVariable = data.rightVariable?.trim();
    const leftKey = data.leftKey?.trim();
    const rightKey = data.rightKey?.trim();

    if (!variableName) {
      throw new NonRetriableError("Variable name is required");
    }

    if (!leftVariable || !rightVariable) {
      throw new NonRetriableError(
        "Both left and right source variables are required",
      );
    }

    if (!leftKey || !rightKey) {
      throw new NonRetriableError("Both leftKey and rightKey are required");
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

    if (leftRows === 0 || rightRows === 0) {
      throw new NonRetriableError(
        "Both source variables must contain CSV records (array, records payload, or DatasetRef)",
      );
    }

    const joinType = data.joinType ?? "inner";
    const estimate = await step.run("csv-join-estimate", async () => {
      return estimateJoinCardinality({
        leftRows: streamContextRows(leftSource),
        rightRows: streamContextRows(rightSource),
        leftKey,
        rightKey,
        leftRowCount: leftRows,
        rightRowCount: rightRows,
      });
    });

    const plan = planJoinStrategy({
      leftRows,
      rightRows,
      leftKey,
      rightKey,
      joinType,
      allowPartitionedLargeJoin: data.allowPartitionedLargeJoin,
      estimate,
    });

    if (plan.strategy === "reject") {
      throw new NonRetriableError(plan.reason);
    }

    const output = await step.run("csv-join", async () => {
      const joinedRows = hashJoinRows({
        leftRows: streamContextRows(leftSource),
        rightRows: streamContextRows(rightSource),
        leftKey,
        rightKey,
        joinType,
        buildSide: plan.buildSide,
      });

      const manifest = await datasetService.persistRowsFromStream({
        executionId,
        variableName,
        rows: joinedRows,
        chunkSize: DATASET_STORAGE.DEFAULT_CHUNK_SIZE_ROWS,
      });

      return {
        ...toDatasetRefOutput(manifest),
        summary: {
          leftRows,
          rightRows,
          joinType,
          strategy: plan.strategy,
          buildSide: plan.buildSide,
          plannerReason: plan.reason,
          requiresPartitionedFlag: plan.requiresPartitionedFlag,
          estimate,
        },
      };
    });

    return {
      [variableName]: output,
    };
  });
