import { Readable } from "node:stream";
import { parse } from "csv-parse";
import { NonRetriableError } from "inngest";
import { EXECUTION_LIMITS } from "@/config/constants";
import type { NodeExecutor } from "@/features/executions/components/types";
import { datasetService } from "@/features/executions/server/datasets/dataset-service";
import {
  applySchemaToRow,
  applySchemaToRows,
  inferDatasetSchema,
} from "@/features/executions/server/datasets/schema-inference";
import { DATASET_TYPE_POLICY } from "@/features/executions/server/datasets/schema-types";
import type { DatasetManifest } from "@/features/executions/server/datasets/types";
import { FileChannel } from "@/inngest/channels/file";

type CsvParseData = {
  csvVariable?: string;
  variableName?: string;
  hasHeader?: boolean;
  delimiter?: string;
};

const COMMON_DELIMITERS = [",", ";", "\t", "|", ":"] as const;
const CSV_WRITE_BATCH_SIZE = Math.max(1, EXECUTION_LIMITS.DEFAULT_BATCH_SIZE);
const CSV_SCHEMA_SAMPLE_ROWS = Math.max(
  100,
  EXECUTION_LIMITS.DEFAULT_BATCH_SIZE,
);

const normalizeDelimiter = (delimiter?: string): string | undefined => {
  if (!delimiter) {
    return undefined;
  }

  const trimmed = delimiter.trim();
  if (!trimmed || trimmed.toLowerCase() === "auto") {
    return undefined;
  }

  if (trimmed === "\\t" || trimmed.toLowerCase() === "tab") {
    return "\t";
  }

  return trimmed[0];
};

const countOccurrences = (text: string, char: string): number => {
  let count = 0;
  for (const token of text) {
    if (token === char) {
      count += 1;
    }
  }
  return count;
};

const detectDelimiter = (csvText: string): string | null => {
  const sampleLines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 25);

  if (sampleLines.length === 0) {
    return null;
  }

  let bestDelimiter: string | null = null;
  let bestScore = -Infinity;

  for (const delimiter of COMMON_DELIMITERS) {
    const counts = sampleLines.map((line) => countOccurrences(line, delimiter));
    const nonZero = counts.filter((count) => count > 0);

    if (nonZero.length === 0) {
      continue;
    }

    const average =
      nonZero.reduce((sum, count) => sum + count, 0) / nonZero.length;
    const variance =
      nonZero.reduce((sum, count) => sum + (count - average) ** 2, 0) /
      nonZero.length;

    const score = nonZero.length * 10 + average * 5 - variance;
    if (score > bestScore) {
      bestScore = score;
      bestDelimiter = delimiter;
    }
  }

  return bestDelimiter;
};

const toBuffer = (value: unknown): Buffer | null => {
  if (Buffer.isBuffer(value)) {
    return value;
  }

  if (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { data?: unknown }).data)
  ) {
    return Buffer.from((value as { data: number[] }).data);
  }

  if (Array.isArray(value) && value.every((item) => typeof item === "number")) {
    return Buffer.from(value as number[]);
  }

  if (typeof value === "string") {
    return Buffer.from(value, "utf-8");
  }

  return null;
};

const asRecord = (row: unknown[]): Record<string, unknown> => {
  const pairs = row.map(
    (value, index) => [`column_${index + 1}`, value] as const,
  );
  return Object.fromEntries(pairs);
};

const parseTxtAsSingleColumn = (
  csvText: string,
  hasHeader: boolean,
): {
  records: Array<Record<string, unknown>>;
  headers: string[];
} => {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return {
      records: [],
      headers: [],
    };
  }

  if (hasHeader) {
    const [headerLine, ...dataLines] = lines;
    const header = headerLine || "value";

    return {
      records: dataLines.map((line) => ({
        [header]: line,
      })),
      headers: [header],
    };
  }

  return {
    records: lines.map((line) => ({
      column_1: line,
    })),
    headers: ["column_1"],
  };
};

const normalizeParsedRecord = (
  value: unknown,
): Record<string, unknown> | null => {
  if (Array.isArray(value)) {
    return asRecord(value);
  }

  if (typeof value === "object" && value !== null) {
    return value as Record<string, unknown>;
  }

  return null;
};

const toDatasetRefOutput = (manifest: DatasetManifest) => {
  return {
    kind: "dataset" as const,
    datasetId: manifest.datasetId,
    executionId: manifest.executionId,
    variableName: manifest.variableName,
    storage: manifest.storage,
    manifestVersion: manifest.version,
    rowCount: manifest.rowCount,
    chunkCount: manifest.chunkCount,
    byteSize: manifest.byteSize,
    schema: manifest.schema,
  };
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
    const parsedData = await step.run("parse-csv", async () => {
      const csvObj = context[csvVariable];

      if (!csvObj) {
        throw new NonRetriableError(
          `CSV variable '${csvVariable}' not found in workflow context`,
        );
      }

      const csv = csvObj as {
        buffer?: unknown;
        url?: unknown;
        content?: unknown;
        fileName?: unknown;
        name?: unknown;
        mimeType?: unknown;
      };

      let csvText = "";
      let fileName = "data.csv";
      let mimeType = "";

      if (typeof csvObj === "string") {
        csvText = csvObj;
      } else if (csv.buffer !== undefined) {
        const buffer = toBuffer(csv.buffer);
        if (!buffer) {
          throw new NonRetriableError("Unsupported CSV buffer format");
        }
        csvText = buffer.toString("utf-8");
      } else if (typeof csv.url === "string" && csv.url.length > 0) {
        const response = await fetch(csv.url);
        if (!response.ok) {
          throw new NonRetriableError(
            `Failed to fetch CSV from URL: ${response.statusText}`,
          );
        }
        csvText = await response.text();
      } else if (typeof csv.content === "string") {
        csvText = csv.content;
      } else {
        throw new NonRetriableError(
          "CSV object must have a buffer, URL, content, or be a string",
        );
      }

      if (typeof csv.fileName === "string" && csv.fileName.length > 0) {
        fileName = csv.fileName;
      } else if (typeof csv.name === "string" && csv.name.length > 0) {
        fileName = csv.name;
      }

      if (typeof csv.mimeType === "string" && csv.mimeType.length > 0) {
        mimeType = csv.mimeType;
      }

      csvText = csvText.replace(/^\uFEFF/, "").trim();
      if (!csvText) {
        throw new NonRetriableError("CSV content is empty");
      }

      const normalizedDelimiter = normalizeDelimiter(data.delimiter);
      const detectedDelimiter = normalizedDelimiter ?? detectDelimiter(csvText);

      const isTxtSource =
        fileName.toLowerCase().endsWith(".txt") ||
        mimeType.toLowerCase().startsWith("text/plain");

      if (!detectedDelimiter && isTxtSource) {
        const txtResult = parseTxtAsSingleColumn(csvText, hasHeader);
        const schema = inferDatasetSchema(txtResult.records);
        const typedRecords = applySchemaToRows(txtResult.records, schema);
        const manifest = await datasetService.persistRowsFromStream({
          executionId,
          variableName,
          rows: typedRecords,
          chunkSize: CSV_WRITE_BATCH_SIZE,
          schema,
        });
        const datasetRef = toDatasetRefOutput(manifest);

        return {
          ...datasetRef,
          headers: txtResult.headers,
          delimiter: null,
          fileName,
          typePolicy: DATASET_TYPE_POLICY.id,
        };
      }

      const delimiter = detectedDelimiter ?? ",";
      const parser = parse({
        columns: hasHeader,
        delimiter,
        bom: true,
        trim: true,
        skip_empty_lines: true,
        relax_column_count: true,
      });

      Readable.from(csvText).pipe(parser);

      const session = await datasetService.beginWrite({
        executionId,
        variableName,
        chunkSize: CSV_WRITE_BATCH_SIZE,
      });

      const pendingRows: Array<Record<string, unknown>> = [];
      const schemaProbeRows: Array<Record<string, unknown>> = [];
      let inferredSchema = session.schema;
      let headers: string[] = [];

      const flushPendingRows = async (force = false) => {
        if (pendingRows.length === 0) {
          return;
        }

        if (!force && pendingRows.length < CSV_WRITE_BATCH_SIZE) {
          return;
        }

        const rows = pendingRows.splice(0, pendingRows.length);
        await datasetService.appendRows(session, rows);
      };

      try {
        for await (const parsed of parser as AsyncIterable<unknown>) {
          const normalized = normalizeParsedRecord(parsed);
          if (!normalized) {
            continue;
          }

          if (!inferredSchema) {
            schemaProbeRows.push(normalized);

            if (schemaProbeRows.length < CSV_SCHEMA_SAMPLE_ROWS) {
              continue;
            }

            inferredSchema = inferDatasetSchema(schemaProbeRows);
            session.schema = inferredSchema;
            headers = Object.keys(schemaProbeRows[0] ?? {});

            pendingRows.push(
              ...applySchemaToRows(schemaProbeRows, inferredSchema),
            );
            schemaProbeRows.length = 0;

            await flushPendingRows();
            continue;
          }

          const typedRow = applySchemaToRow(normalized, inferredSchema);
          if (headers.length === 0) {
            headers = Object.keys(typedRow);
          }

          pendingRows.push(typedRow);
          await flushPendingRows();
        }

        if (!inferredSchema) {
          inferredSchema = inferDatasetSchema(schemaProbeRows);
          session.schema = inferredSchema;
          headers = Object.keys(schemaProbeRows[0] ?? {});
          pendingRows.push(
            ...applySchemaToRows(schemaProbeRows, inferredSchema),
          );
        }

        await flushPendingRows(true);

        const manifest = await datasetService.commitWrite(session);
        const datasetRef = toDatasetRefOutput(manifest);

        return {
          ...datasetRef,
          headers,
          delimiter,
          fileName,
          typePolicy: DATASET_TYPE_POLICY.id,
        };
      } catch (error) {
        await datasetService.abortWrite(session);
        throw error;
      }
    });

    await updateStatePublish("success");

    return {
      [data.variableName]: parsedData,
    };
  } catch (error) {
    await updateStatePublish("error");
    throw error instanceof Error
      ? new NonRetriableError(error.message)
      : new NonRetriableError("Failed to parse CSV");
  }
};
