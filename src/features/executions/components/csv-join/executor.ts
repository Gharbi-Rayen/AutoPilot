import { NonRetriableError } from "inngest";
import { DATASET_STORAGE } from "@/config/constants";
import { estimateJoinCardinality } from "@/features/executions/server/datasets/cardinality-estimator";
import { isDatasetRef } from "@/features/executions/server/datasets/dataset-ref";
import { datasetService } from "@/features/executions/server/datasets/dataset-service";
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
import { unionAllRows, unionRows } from "./union-executor";

type CsvJoinData = {
  leftVariable?: string;
  rightVariable?: string;
  keyPairs?: { leftKey: string; rightKey: string }[];
  variableName?: string;
  joinType?: JoinType | "cross" | "natural";
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

    if (
        joinType !== 'cross' &&
        joinType !== 'natural' &&
        joinType !== 'union' &&
        joinType !== 'union_all' &&
        keyPairs.length === 0
      ) {
      throw new NonRetriableError("At least one key pair is required");
    }

    let leftKeys = keyPairs.map((p) => p.leftKey.trim()).filter(Boolean);
    let rightKeys = keyPairs.map((p) => p.rightKey.trim()).filter(Boolean);

    if (
        joinType !== 'cross' &&
        joinType !== 'natural' &&
        joinType !== 'union' &&
        joinType !== 'union_all' &&
        (leftKeys.length !== keyPairs.length ||
          rightKeys.length !== keyPairs.length)
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

    if (joinType === "union" || joinType === "union_all") {
      const output = await step.run("csv-union", async () => {
        const _unionRows =
          joinType === "union_all"
            ? unionAllRows(
                streamContextRows(leftSource),
                streamContextRows(rightSource),
              )
            : unionRows(
                streamContextRows(leftSource),
                streamContextRows(rightSource),
              );

        const manifest = await datasetService.persistRowsFromStream({
          executionId,
          variableName,
          rows: _unionRows,
          chunkSize: DATASET_STORAGE.DEFAULT_CHUNK_SIZE_ROWS,
        });

        return {
          ...toDatasetRefOutput(manifest),
          summary: {
            leftRows,
            rightRows,
            joinType,
            strategy: "union",
          },
        };
      });

      return { [variableName]: output };
    }

    if (joinType === "natural") {
      const getColumns = (
        source: unknown,
        inlineRows: Array<Record<string, unknown>>,
      ) => {
        if (isDatasetRef(source)) {
          return source.schema ? Object.keys(source.schema) : [];
        }
        return inlineRows.length > 0 ? Object.keys(inlineRows[0]) : [];
      };

      const leftCols = getColumns(leftSource, leftInlineRows);
      const rightCols = getColumns(rightSource, rightInlineRows);

      const sharedColumns = leftCols.filter((col) => rightCols.includes(col));
      if (sharedColumns.length === 0) {
        throw new NonRetriableError(
          `Natural Join requires at least one shared column name. Left schema: [${leftCols.join(
            ", ",
          )}]. Right schema: [${rightCols.join(", ")}].`,
        );
      }

      leftKeys = sharedColumns;
      rightKeys = sharedColumns;
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

      const isFilteredJoin = joinType === "semi" || joinType === "anti";

      const planResult = planJoinStrategy({
        leftRows,
        rightRows,
        leftKeys,
        rightKeys,
        joinType: joinType as JoinType,
        allowPartitionedLargeJoin:
          data.allowPartitionedLargeJoin || isFilteredJoin,
        estimate: estimateResult,
        caseInsensitive: data.caseInsensitive ?? false,
        outputColumns: data.outputColumns,
      });

      if (joinType === "natural" && planResult.strategy === "hash") {
        planResult.sharedColumns = leftKeys;
      }

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

    await step.run("enqueue-csv-join", async () => {
      // Note: "union" and "union_all" are caught earlier entirely, so `joinType` here is strictly constrained
      if (!leftKeys?.length && joinType !== "cross" && joinType !== "natural") {
        throw new NonRetriableError(
          `[csv-join] leftKeys is empty for joinType="${joinType}". Keys must be resolved before enqueueing.`,
        );
      }

      const { Queue } = await import("bullmq");
      const { default: Redis } = await import("ioredis");

      // Create a DEDICATED connection for this queue instance
      const connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
        maxRetriesPerRequest: null,
      });

      const queue = new Queue("csv-join", { connection });
      await queue.add("join", {
        plan,
        executionId,
        datasetId,
        variableName,
        leftRef: leftSource,
        rightRef: rightSource,
        leftKeys,
        rightKeys,
        joinType,
        schema: (leftSource as any).schema,
      });
      console.log("[csv-join] Job enqueued to Redis:", process.env.REDIS_URL ?? "redis://localhost:6379");
      const jobCounts = await queue.getJobCounts();
      console.log("[csv-join] Queue state:", jobCounts);
      await queue.close();
    });

    const completion = await completionPromise;

    if (!completion) {
      throw new NonRetriableError(
        "Wait for csv join timed out after 60 minutes",
      );
    }

    const output = {
      datasetId: completion.data.datasetId,
      variableName: completion.data.variableName,
      rowCount: completion.data.rowCount,
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
    };

    return {
      [variableName]: output,
    };
  });
