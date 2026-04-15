import { NonRetriableError } from "inngest";
import { estimateJoinCardinality } from "@/features/executions/server/datasets/cardinality-estimator";
import { isDatasetRef } from "@/features/executions/server/datasets/dataset-ref";
import {
  type JoinType,
  planJoinStrategy,
} from "@/features/executions/server/datasets/join-planner";
import {
  availableContextKeys,
  extractInlineRows,
  resolveContextValue,
  streamContextRows,
  withCsvNodeStatus,
} from "../csv-shared/executor-utils";
import type { NodeExecutor } from "../types";

type CsvJoinData = {
  leftVariable?: string;
  rightVariable?: string;
  keyPairs?: { leftKey: string; rightKey: string }[];
  variableName?: string;
  joinType?: JoinType;
  allowPartitionedLargeJoin?: boolean;
  caseInsensitive?: boolean;
  outputColumns?: import("../../server/datasets/project-row").OutputColumnSpec[];
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
    const keyPairs = data.keyPairs ?? [];

    if (!variableName) {
      throw new NonRetriableError("Variable name is required");
    }

    if (!leftVariable || !rightVariable) {
      throw new NonRetriableError(
        "Both left and right source variables are required",
      );
    }

    const joinType = data.joinType ?? "inner";

    if (keyPairs.length === 0) {
      throw new NonRetriableError("At least one key pair is required");
    }

    const leftKeys = keyPairs.map((p) => p.leftKey.trim()).filter(Boolean);
    const rightKeys = keyPairs.map((p) => p.rightKey.trim()).filter(Boolean);

    if (
      leftKeys.length !== keyPairs.length ||
      rightKeys.length !== keyPairs.length
    ) {
      throw new NonRetriableError(
        "All key pairs must have both leftKey and rightKey defined",
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

    if (leftRows === 0 || rightRows === 0) {
      throw new NonRetriableError(
        "Both source variables must contain CSV records (array, records payload, or DatasetRef)",
      );
    }

    const { plan, estimate } = await step.run("csv-join-plan", async () => {
      const estimateResult = await estimateJoinCardinality({
        leftRows: streamContextRows(leftSource),
        rightRows: streamContextRows(rightSource),
        leftKeys,
        rightKeys,
        joinType,
        leftRowCount: leftRows,
        rightRowCount: rightRows,
      });

      const planResult = planJoinStrategy({
        leftRows,
        rightRows,
        leftKeys,
        rightKeys,
        joinType,
        allowPartitionedLargeJoin: data.allowPartitionedLargeJoin,
        estimate: estimateResult,
        caseInsensitive: data.caseInsensitive ?? false,
        outputColumns: data.outputColumns,
      });

      if (planResult.strategy === "reject") {
        throw new NonRetriableError(planResult.reason);
      }

      return { plan: planResult, estimate: estimateResult };
    });

    if (estimate.warnings && estimate.warnings.length > 0) {
      for (const warning of estimate.warnings) {
        console.warn(`[csv-join] ${warning}`);
      }
    }

    const completionPromise = step.waitForEvent("wait-for-csv-join", {
      event: "csv/join.complete",
      match: "data.executionId",
      timeout: "60m",
    });

    const { randomUUID } = await import("node:crypto");
    const datasetId = randomUUID();
    const leftSourceSchema = isDatasetRef(leftSource)
      ? leftSource.schema
      : undefined;

    await step.run("enqueue-csv-join", async () => {
      if (!leftKeys?.length) {
        throw new NonRetriableError(
          `[csv-join] leftKeys is empty for joinType="${joinType}". Keys must be resolved before enqueueing.`,
        );
      }

      const { getCsvJoinQueue } = await import("@/lib/worker-queue");
      const queue = getCsvJoinQueue();
      await queue.add(
        "join",
        {
          plan,
          executionId,
          datasetId,
          variableName,
          leftRef: leftSource,
          rightRef: rightSource,
          leftKeys,
          rightKeys,
          joinType,
          schema: leftSourceSchema,
        },
        {
          jobId: `${executionId}-${datasetId}`,
          removeOnComplete: 50,
          removeOnFail: 20,
        },
      );
      console.log("[csv-join] Job enqueued — executionId:", executionId);
    });

    const completion = await completionPromise;

    if (!completion) {
      throw new NonRetriableError(
        "Wait for csv join timed out after 60 minutes",
      );
    }

    const workerResult = completion.data.result as {
      datasetRef: {
        kind: "dataset";
        datasetId: string;
        executionId: string;
        variableName: string;
        storage: string;
        manifestVersion: number;
        rowCount: number;
        chunkCount: number;
        byteSize: number;
        schema?: Record<string, unknown>;
      };
    };

    if (!workerResult?.datasetRef?.datasetId) {
      throw new NonRetriableError(
        "CSV join worker returned an invalid dataset reference",
      );
    }

    return {
      [variableName]: {
        ...workerResult.datasetRef,
        summary: {
          leftRows,
          rightRows,
          joinType,
          strategy: plan.strategy,
          buildSide: "buildSide" in plan ? plan.buildSide : undefined,
          plannerReason: plan.reason,
          requiresPartitionedFlag:
            "requiresPartitionedFlag" in plan
              ? plan.requiresPartitionedFlag
              : undefined,
          estimate,
          warnings: estimate.warnings,
        },
      },
    };
  });
