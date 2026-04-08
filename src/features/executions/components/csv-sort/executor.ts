import { NonRetriableError } from "inngest";
import { resolveContextSchema } from "@/features/executions/server/datasets/context-resolver";
import { isDatasetRef } from "@/features/executions/server/datasets/dataset-ref";
import {
  availableContextKeys,
  extractInlineRows,
  resolveContextValue,
  withCsvNodeStatus,
} from "../csv-shared/executor-utils";
import type { NodeExecutor } from "../types";

type CsvSortData = {
  sourceVariable?: string;
  variableName?: string;
  sortField?: string;
  direction?: "asc" | "desc";
  compareAs?: "string" | "number" | "date";
  nulls?: "first" | "last";
};

type CsvSortWorkerResult = {
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
  summary: {
    sourceRows: number;
    strategy: "in-memory" | "external";
    sortField: string;
    direction: "asc" | "desc";
    compareAs: "string" | "number" | "date";
    nulls: "first" | "last";
    runCount?: number;
    mergeFanIn?: number;
  };
};

export const CsvSortExecutor: NodeExecutor<CsvSortData> = async ({
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
        "Execution context is missing executionId for csv-sort",
      );
    }

    const variableName = data.variableName?.trim();
    const sourceVariable = data.sourceVariable?.trim();
    const sortField = data.sortField?.trim();

    if (!variableName) {
      throw new NonRetriableError("Variable name is required");
    }

    if (!sourceVariable) {
      throw new NonRetriableError("Source variable is required");
    }

    if (!sortField) {
      throw new NonRetriableError("Sort field is required");
    }

    const source = resolveContextValue(context, sourceVariable);
    if (source === undefined) {
      const availableKeys = availableContextKeys(context);
      throw new NonRetriableError(
        `Source variable '${sourceVariable}' not found in workflow context. Available keys: ${availableKeys || "(none)"}`,
      );
    }

    const sourceSchema = resolveContextSchema(source);
    const inlineRows = extractInlineRows(source);
    const sourceRows = isDatasetRef(source)
      ? source.rowCount
      : inlineRows.length;

    if (sourceRows === 0) {
      throw new NonRetriableError(
        "Source variable must contain CSV records (array, records payload, or DatasetRef)",
      );
    }

    const direction = data.direction ?? "asc";
    const compareAs = data.compareAs ?? "string";
    const nulls = data.nulls ?? "last";

    const completionPromise = step.waitForEvent("wait-for-csv-sort-complete", {
      event: "csv/sort.complete",
      match: "data.executionId",
      timeout: "60m",
    });

    const { randomUUID } = await import("node:crypto");
    const datasetId = randomUUID();

    await step.run("enqueue-csv-sort", async () => {
      const { Queue } = await import("bullmq");
      const { default: Redis } = await import("ioredis");

      const connection = new Redis(
        process.env.REDIS_URL ?? "redis://localhost:6379",
        {
          maxRetriesPerRequest: null,
        },
      );

      const queue = new Queue("csv-sort", { connection });
      await queue.add("sort", {
        executionId,
        datasetId,
        variableName,
        sourceRef: source,
        sortField,
        direction,
        compareAs,
        nulls,
        sourceRows,
        sourceSchema,
      });
      await queue.close();
    });

    const completion = await completionPromise;
    const failureMessage = completion?.data?.error ?? completion?.data?.reason;

    if (typeof failureMessage === "string" && failureMessage.length > 0) {
      throw new NonRetriableError(`CSV sort failed: ${failureMessage}`);
    }

    if (!completion || !completion.data?.result) {
      throw new NonRetriableError(
        "Wait for csv sort timed out after 60 minutes",
      );
    }

    const output = completion.data.result as CsvSortWorkerResult;

    if (!output.datasetRef?.datasetId) {
      throw new NonRetriableError(
        "CSV sort worker returned an invalid dataset reference",
      );
    }

    return {
      [variableName]: {
        ...output.datasetRef,
        summary: output.summary,
      },
    };
  });
