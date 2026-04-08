import { NonRetriableError } from "inngest";
import type { NodeExecutor } from "@/features/executions/components/types";
import { DATASET_TYPE_POLICY } from "@/features/executions/server/datasets/schema-types";
import { FileChannel } from "@/inngest/channels/file";

type CsvParseData = {
  csvVariable?: string;
  variableName?: string;
  hasHeader?: boolean;
  delimiter?: string;
};

export const CsvParseExecutor: NodeExecutor<CsvParseData> = async ({
  data,
  nodeId,
  executionId,
  context,
  step,
  publish,
}) => {
  const updateStatePublish = async (state: "loading" | "error" | "success") => {
    return await publish(
      FileChannel().status({
        nodeId,
        status: state,
      }),
    );
  };

  await updateStatePublish("loading");

  if (!data.variableName) {
    await updateStatePublish("error");
    throw new NonRetriableError("Variable name is required");
  }

  if (!data.csvVariable) {
    await updateStatePublish("error");
    throw new NonRetriableError("Source CSV variable is required");
  }

  const variableName = data.variableName;
  const csvVariable = data.csvVariable;
  const hasHeader = data.hasHeader ?? true;

  if (!executionId) {
    await updateStatePublish("error");
    throw new NonRetriableError(
      "Execution context is missing executionId for CSV parsing",
    );
  }

  try {
    const csvObj = context[csvVariable] as {
      fileBlobPath?: string;
      fileName?: unknown;
      name?: unknown;
    };

    if (!csvObj) {
      throw new NonRetriableError(
        `CSV variable '${csvVariable}' not found in workflow context`,
      );
    }

    if (typeof csvObj.fileBlobPath !== "string") {
      throw new NonRetriableError(
        "Reading raw CSV currently requires a 'fileBlobPath'. Inline strings or URLs strictly require an upstream fetch proxy to materialize binary.",
      );
    }

    let fileName = "data.csv";
    if (typeof csvObj.fileName === "string" && csvObj.fileName.length > 0) {
      fileName = csvObj.fileName;
    } else if (typeof csvObj.name === "string" && csvObj.name.length > 0) {
      fileName = csvObj.name;
    }

    const { randomUUID } = await import("node:crypto");
    const datasetId = randomUUID();

    // 1. Register the step.waitForEvent before enqueuing so we don't miss the event
    // if the BullMQ worker finishes extremely quickly (e.g. for a 1MB file).
    const parseResultPromise = step.waitForEvent(
      "wait-for-csv-parse-complete",
      {
        event: "csv/parse.complete",
        match: "data.executionId",
        timeout: "30m",
      },
    );

    // 2. Enqueue job
    await step.run("enqueue-csv-parse", async () => {
      const { Queue } = await import("bullmq");
      const { default: Redis } = await import("ioredis");

      // Create a DEDICATED connection for this queue instance
      const connection = new Redis(
        process.env.REDIS_URL || "redis://localhost:6379",
        {
          maxRetriesPerRequest: null,
        },
      );

      const queue = new Queue("csv-parse", { connection });

      await queue.add(
        `parse:${executionId}`,
        {
          fileBlobPath: csvObj.fileBlobPath,
          executionId,
          datasetId,
          variableName,
          delimiter: data.delimiter,
          hasHeader,
        },
        { jobId: `${executionId}-${datasetId}` },
      );

      await queue.close();

      return { enqueued: true };
    });

    // 3. Wait for the worker to signal back
    const parseResult = await parseResultPromise;

    const parseFailureMessage =
      parseResult?.data?.error ?? parseResult?.data?.reason;
    if (
      typeof parseFailureMessage === "string" &&
      parseFailureMessage.length > 0
    ) {
      throw new NonRetriableError(`CSV parse failed: ${parseFailureMessage}`);
    }

    if (!parseResult) {
      throw new NonRetriableError(
        `[csv-parse] Timed out waiting for parse to complete — executionId=${executionId}`,
      );
    }

    await updateStatePublish("success");

    const manifest = parseResult.data.result;
    const headers = Array.isArray(manifest.headers)
      ? manifest.headers.filter(
          (header: unknown): header is string => typeof header === "string",
        )
      : [];
    const columnCount =
      typeof manifest.columnCount === "number"
        ? Math.max(0, manifest.columnCount)
        : headers.length;
    const delimiter =
      typeof manifest.delimiter === "string" && manifest.delimiter.length > 0
        ? manifest.delimiter
        : undefined;

    return {
      [variableName]: {
        kind: "dataset",
        datasetId: manifest.datasetId || datasetId,
        executionId,
        variableName,
        storage: manifest.storage || "jsonl",
        manifestVersion: manifest.version || manifest.manifestVersion || 1,
        rowCount: manifest.rowCount,
        chunkCount: manifest.chunkCount,
        byteSize: manifest.byteSize || 0,
        schema: manifest.schema,
        headers,
        columnCount,
        delimiter,
        parsedMetadata: {
          rowCount: manifest.rowCount,
          columnCount,
          columns: headers,
          delimiter: delimiter ?? null,
        },
        typePolicy: DATASET_TYPE_POLICY.id,
        fileName,
      },
    };
  } catch (error) {
    await updateStatePublish("error");
    throw error instanceof Error
      ? new NonRetriableError(error.message)
      : new NonRetriableError("Failed to parse CSV");
  }
};
