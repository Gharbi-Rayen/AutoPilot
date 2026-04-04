import { Readable } from "node:stream";
import { parse } from "csv-parse";
import { NonRetriableError } from "inngest";
import { DATASET_STORAGE, EXECUTION_LIMITS } from "@/config/constants";
import {
  applyCsvPredicate,
  type CsvOperator,
  parseNumber,
  resolveContextValue,
  toDatasetRefOutput,
} from "@/features/executions/components/csv-shared/executor-utils";
import type {
  NodeExecutorParams,
  StepTools,
  workflowContext,
} from "@/features/executions/components/types";
import { isDatasetRef } from "@/features/executions/server/datasets/dataset-ref";
import { datasetService } from "@/features/executions/server/datasets/dataset-service";
import {
  applySchemaToRow,
  applySchemaToRows,
  inferDatasetSchema,
} from "@/features/executions/server/datasets/schema-inference";
import type { DatasetSchema } from "@/features/executions/server/datasets/schema-types";
import type { NodeType } from "@/generated/prisma";
import { FileChannel } from "@/inngest/channels/file";
import type { FusionChainPlan, FusionPlannerNode } from "./fusion-planner";

type CsvParseData = {
  csvVariable?: string;
  variableName?: string;
  hasHeader?: boolean;
  delimiter?: string;
};

type CsvFilterData = {
  sourceVariable?: string;
  variableName?: string;
  field?: string;
  operator?: CsvOperator;
  value?: string;
};

type CsvAggregateData = {
  sourceVariable?: string;
  variableName?: string;
  groupBy?: string;
  operation?: "count" | "sum" | "avg" | "min" | "max";
  targetField?: string;
};

type FusedNodeOutput = {
  nodeId: string;
  nodeType: NodeType;
  output: workflowContext;
};

export interface FusedChainRunResult {
  nodeOutputs: FusedNodeOutput[];
}

const COMMON_DELIMITERS = [",", ";", "\t", "|", ":"] as const;
const FUSION_SCHEMA_SAMPLE_ROWS = Math.max(
  100,
  EXECUTION_LIMITS.DEFAULT_BATCH_SIZE,
);

const normalizeVariableReference = (reference: string | undefined): string => {
  if (!reference) {
    return "";
  }

  const trimmed = reference.trim();
  if (!trimmed) {
    return "";
  }

  const unwrapped = /^\{\{\s*(.+?)\s*\}\}$/.exec(trimmed)?.[1] ?? trimmed;

  return unwrapped
    .replace(/^context\./, "")
    .replace(/^\$\./, "")
    .trim();
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

const resolveNodeData = <T extends Record<string, unknown>>(
  node: FusionPlannerNode,
): T => {
  if (typeof node.data !== "object" || node.data === null) {
    return {} as T;
  }

  return node.data as T;
};

const resolveCsvSource = async (
  value: unknown,
): Promise<{ csvText: string; fileName: string; mimeType: string }> => {
  if (!value) {
    throw new NonRetriableError(
      "Source CSV variable was not found in workflow context",
    );
  }

  if (typeof value === "string") {
    return {
      csvText: value,
      fileName: "data.csv",
      mimeType: "",
    };
  }

  if (isDatasetRef(value)) {
    const firstRow = await datasetService.getDatasetRows(
      value.executionId,
      value.datasetId,
      0,
      0,
      1,
    );
    if (firstRow.rows.length === 0) {
      throw new NonRetriableError("Source dataset is empty");
    }
    const rowData = firstRow.rows[0] as Record<string, unknown>;
    if (!rowData.buffer) {
      throw new NonRetriableError(
        "Dataset row does not contain buffer field from UPLOAD_FILE",
      );
    }
    const buffer = toBuffer(rowData.buffer);
    if (!buffer) {
      throw new NonRetriableError("Failed to convert dataset buffer");
    }
    let fileName = "data.csv";
    let mimeType = "";
    if (rowData.fileName && typeof rowData.fileName === "string") {
      fileName = rowData.fileName;
    } else if (rowData.name && typeof rowData.name === "string") {
      fileName = rowData.name;
    }
    if (rowData.mimeType && typeof rowData.mimeType === "string") {
      mimeType = rowData.mimeType;
    }
    return {
      csvText: buffer.toString("utf-8"),
      fileName,
      mimeType,
    };
  }

  if (typeof value !== "object" || value === null) {
    throw new NonRetriableError(
      "CSV object must have a buffer, URL, content, DatasetRef, or be a string",
    );
  }

  const csv = value as {
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

  if (csv.buffer !== undefined) {
    const buffer = toBuffer(csv.buffer);
    if (!buffer) {
      throw new NonRetriableError("Unsupported CSV buffer format");
    }
    csvText = buffer.toString("utf-8");
  } else if (
    typeof (csv as { fileBlobPath: string }).fileBlobPath === "string"
  ) {
    const { readFile } = await import("node:fs/promises");
    const buffer = await readFile(
      (csv as { fileBlobPath: string }).fileBlobPath,
    );
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
      "CSV object must have a buffer, URL, content, DatasetRef, or be a string",
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

  return {
    csvText,
    fileName,
    mimeType,
  };
};

const publishFusedNodeStatus = async ({
  status,
  publish,
  nodeIds,
}: {
  status: "loading" | "error" | "success";
  publish: NodeExecutorParams["publish"];
  nodeIds: string[];
}) => {
  await Promise.all(
    nodeIds.map((nodeId) =>
      publish(
        FileChannel().status({
          nodeId,
          status,
        }),
      ),
    ),
  );
};

export const runFusedCsvParseFilterAggregate = async ({
  plan,
  executionId,
  context,
  step,
  publish,
  nodesById,
}: {
  plan: FusionChainPlan;
  executionId: string;
  context: workflowContext;
  step: StepTools;
  publish: NodeExecutorParams["publish"];
  nodesById: Map<string, FusionPlannerNode>;
}): Promise<FusedChainRunResult> => {
  const [parseNodeId, filterNodeId, aggregateNodeId] = plan.nodeIds;
  const parseNode = nodesById.get(parseNodeId);
  const filterNode = nodesById.get(filterNodeId);
  const aggregateNode = nodesById.get(aggregateNodeId);

  if (!parseNode || !filterNode || !aggregateNode) {
    throw new NonRetriableError(
      "Unable to resolve nodes for fused pipeline execution",
    );
  }

  const parseData = resolveNodeData<CsvParseData>(parseNode);
  const filterData = resolveNodeData<CsvFilterData>(filterNode);
  const aggregateData = resolveNodeData<CsvAggregateData>(aggregateNode);

  const parseVariableName = parseData.variableName?.trim();
  const parseSourceVariable = parseData.csvVariable?.trim();
  const filterVariableName = filterData.variableName?.trim();
  const aggregateVariableName = aggregateData.variableName?.trim();
  const filterField = filterData.field?.trim();
  const groupBy = aggregateData.groupBy?.trim();
  const operation = aggregateData.operation ?? "count";
  const targetField = aggregateData.targetField?.trim();

  if (!parseVariableName || !parseSourceVariable) {
    throw new NonRetriableError(
      "CSV parse node is missing required variable configuration",
    );
  }

  if (!filterVariableName || !filterField) {
    throw new NonRetriableError(
      "CSV filter node is missing required variable configuration",
    );
  }

  if (!aggregateVariableName || !groupBy) {
    throw new NonRetriableError(
      "CSV aggregate node is missing required variable configuration",
    );
  }

  if (operation !== "count" && !targetField) {
    throw new NonRetriableError(
      "targetField is required for sum/avg/min/max operations",
    );
  }

  const normalizedFilterSource = normalizeVariableReference(
    filterData.sourceVariable,
  );
  const normalizedAggregateSource = normalizeVariableReference(
    aggregateData.sourceVariable,
  );

  if (
    normalizedFilterSource !== parseVariableName ||
    normalizedAggregateSource !== filterVariableName
  ) {
    throw new NonRetriableError(
      "Fusion source-variable alignment check failed for parse/filter/aggregate chain",
    );
  }

  const operator = filterData.operator ?? "eq";
  const nodeIds = [parseNode.id, filterNode.id, aggregateNode.id];

  await publishFusedNodeStatus({
    status: "loading",
    publish,
    nodeIds,
  });

  try {
    const nodeOutputs = await step.run(
      `fused-csv-chain-${parseNode.id}`,
      async (): Promise<FusedNodeOutput[]> => {
        const rawSource = resolveContextValue(context, parseSourceVariable);
        const source = await resolveCsvSource(rawSource);

        const hasHeader = parseData.hasHeader ?? true;
        const csvText = source.csvText.replace(/^\uFEFF/, "").trim();
        if (!csvText) {
          throw new NonRetriableError("CSV content is empty");
        }

        const normalizedDelimiter = normalizeDelimiter(parseData.delimiter);
        const detectedDelimiter =
          normalizedDelimiter ?? detectDelimiter(csvText);
        const isTxtSource =
          source.fileName.toLowerCase().endsWith(".txt") ||
          source.mimeType.toLowerCase().startsWith("text/plain");

        let sourceSchema: DatasetSchema | undefined;
        let headers: string[] = [];
        let sourceRows = 0;
        let matchedRows = 0;

        const buckets = new Map<
          string,
          {
            count: number;
            numericCount: number;
            sum: number;
            min: number | null;
            max: number | null;
          }
        >();

        const consumeTypedRow = (row: Record<string, unknown>) => {
          sourceRows += 1;

          if (
            !applyCsvPredicate(row, filterField, operator, filterData.value)
          ) {
            return;
          }

          matchedRows += 1;

          const groupKey = String(row[groupBy] ?? "");
          const bucket = buckets.get(groupKey) ?? {
            count: 0,
            numericCount: 0,
            sum: 0,
            min: null,
            max: null,
          };

          bucket.count += 1;

          if (operation !== "count" && targetField) {
            const numericValue = parseNumber(row[targetField]);
            if (numericValue !== null) {
              bucket.numericCount += 1;
              bucket.sum += numericValue;
              bucket.min =
                bucket.min === null
                  ? numericValue
                  : Math.min(bucket.min, numericValue);
              bucket.max =
                bucket.max === null
                  ? numericValue
                  : Math.max(bucket.max, numericValue);
            }
          }

          buckets.set(groupKey, bucket);
        };

        const schemaProbeRows: Array<Record<string, unknown>> = [];

        const consumeNormalizedRow = (
          normalizedRow: Record<string, unknown>,
        ) => {
          if (!sourceSchema) {
            schemaProbeRows.push(normalizedRow);

            if (schemaProbeRows.length < FUSION_SCHEMA_SAMPLE_ROWS) {
              return;
            }

            sourceSchema = inferDatasetSchema(schemaProbeRows);
            headers = Object.keys(schemaProbeRows[0] ?? {});

            for (const typedRow of applySchemaToRows(
              schemaProbeRows,
              sourceSchema,
            )) {
              consumeTypedRow(typedRow);
            }

            schemaProbeRows.length = 0;
            return;
          }

          const typedRow = applySchemaToRow(normalizedRow, sourceSchema);
          if (headers.length === 0) {
            headers = Object.keys(typedRow);
          }

          consumeTypedRow(typedRow);
        };

        if (!detectedDelimiter && isTxtSource) {
          const txtResult = parseTxtAsSingleColumn(csvText, hasHeader);
          headers = txtResult.headers;

          for (const row of txtResult.records) {
            consumeNormalizedRow(row);
          }
        } else {
          const parser = parse({
            columns: hasHeader,
            delimiter: detectedDelimiter ?? ",",
            bom: true,
            trim: true,
            skip_empty_lines: true,
            relax_column_count: true,
          });

          Readable.from(csvText).pipe(parser);

          for await (const parsed of parser as AsyncIterable<unknown>) {
            const normalized = normalizeParsedRecord(parsed);
            if (!normalized) {
              continue;
            }

            consumeNormalizedRow(normalized);
          }
        }

        if (!sourceSchema) {
          sourceSchema = inferDatasetSchema(schemaProbeRows);
          if (headers.length === 0) {
            headers = Object.keys(schemaProbeRows[0] ?? {});
          }

          for (const typedRow of applySchemaToRows(
            schemaProbeRows,
            sourceSchema,
          )) {
            consumeTypedRow(typedRow);
          }
        }

        if (sourceRows === 0) {
          throw new NonRetriableError(
            "Source variable must contain CSV records (array, records payload, or DatasetRef)",
          );
        }

        if (matchedRows === 0) {
          throw new NonRetriableError(
            "Source variable must contain CSV records (array, records payload, or DatasetRef)",
          );
        }

        const aggregateRecords = Array.from(buckets.entries()).map(
          ([groupKey, bucket]) => {
            const result: Record<string, unknown> = {
              [groupBy]: groupKey,
              count: bucket.count,
              numericCount: bucket.numericCount,
            };

            if (operation === "count") {
              result.value = bucket.count;
              return result;
            }

            if (bucket.numericCount === 0) {
              result.value = null;
              return result;
            }

            if (operation === "sum") {
              result.value = bucket.sum;
              return result;
            }

            if (operation === "avg") {
              result.value = bucket.sum / bucket.numericCount;
              return result;
            }

            if (operation === "min") {
              result.value = bucket.min;
              return result;
            }

            result.value = bucket.max;
            return result;
          },
        );

        const aggregateSchema = inferDatasetSchema(aggregateRecords);
        const typedAggregateRecords = applySchemaToRows(
          aggregateRecords,
          aggregateSchema,
        );

        const manifest = await datasetService.persistRowsFromStream({
          executionId,
          variableName: aggregateVariableName,
          rows: typedAggregateRecords,
          chunkSize: DATASET_STORAGE.DEFAULT_CHUNK_SIZE_ROWS,
          schema: aggregateSchema,
        });

        const aggregateOutput = {
          ...toDatasetRefOutput(manifest),
          summary: {
            sourceRows: matchedRows,
            groupCount: aggregateRecords.length,
            operation,
            targetField: targetField ?? null,
            fused: true,
          },
        };

        const parseOutput = {
          kind: "fused-dataset-summary" as const,
          fused: true,
          rowCount: sourceRows,
          schema: sourceSchema,
          headers,
          delimiter: detectedDelimiter ?? null,
          fileName: source.fileName,
          note: "Intermediate parse dataset was skipped by fusion.",
        };

        const filterOutput = {
          kind: "fused-dataset-summary" as const,
          fused: true,
          rowCount: matchedRows,
          schema: sourceSchema,
          summary: {
            sourceRows,
            matchedRows,
            filteredOut: Math.max(sourceRows - matchedRows, 0),
            field: filterField,
            operator,
          },
          note: "Intermediate filter dataset was skipped by fusion.",
        };

        return [
          {
            nodeId: parseNode.id,
            nodeType: parseNode.type,
            output: {
              [parseVariableName]: parseOutput,
            },
          },
          {
            nodeId: filterNode.id,
            nodeType: filterNode.type,
            output: {
              [filterVariableName]: filterOutput,
            },
          },
          {
            nodeId: aggregateNode.id,
            nodeType: aggregateNode.type,
            output: {
              [aggregateVariableName]: aggregateOutput,
            },
          },
        ];
      },
    );

    await publishFusedNodeStatus({
      status: "success",
      publish,
      nodeIds,
    });

    return {
      nodeOutputs,
    };
  } catch (error) {
    await publishFusedNodeStatus({
      status: "error",
      publish,
      nodeIds,
    });

    throw error;
  }
};
