import { DATASET_STORAGE } from "@/config/constants";
import { type DatasetRef, isDatasetRef } from "./dataset-ref";
import { datasetService } from "./dataset-service";
import { inferDatasetSchema } from "./schema-inference";
import type { DatasetSchema } from "./schema-types";
import type { DatasetManifest } from "./types";

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const extractInlineRecords = (
  value: unknown,
): Array<Record<string, unknown>> => {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }

  if (!isRecord(value)) {
    return [];
  }

  if (Array.isArray(value.records)) {
    return value.records.filter(isRecord);
  }

  if (Array.isArray(value.data)) {
    return value.data.filter(isRecord);
  }

  return [];
};

export const resolveContextSchema = (
  value: unknown,
): DatasetSchema | undefined => {
  if (!isRecord(value) || !isRecord(value.schema)) {
    return undefined;
  }

  return value.schema as DatasetSchema;
};

const datasetRefFromManifest = (manifest: DatasetManifest): DatasetRef => {
  return {
    kind: "dataset",
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

export const resolveContextRecords = async (
  value: unknown,
): Promise<Array<Record<string, unknown>>> => {
  if (isDatasetRef(value)) {
    const records: Array<Record<string, unknown>> = [];

    for await (const row of datasetService.streamDatasetRows(
      value.executionId,
      value.datasetId,
    )) {
      if (isRecord(row)) {
        records.push(row);
      }
    }

    return records;
  }

  return extractInlineRecords(value);
};

export const resolveContextList = async (
  value: unknown,
): Promise<unknown[]> => {
  if (Array.isArray(value)) {
    return value;
  }

  if (isDatasetRef(value)) {
    return resolveContextRecords(value);
  }

  if (isRecord(value) && Array.isArray(value.records)) {
    return value.records;
  }

  return [];
};

export const persistContextValueIfNeeded = async ({
  executionId,
  variableName,
  value,
}: {
  executionId: string;
  variableName: string;
  value: unknown;
}): Promise<unknown> => {
  if (isDatasetRef(value)) {
    return value;
  }

  const records = extractInlineRecords(value);
  if (records.length === 0) {
    return value;
  }

  if (records.length <= DATASET_STORAGE.MAX_INLINE_DATASET_ROWS) {
    return value;
  }

  const schema = resolveContextSchema(value) ?? inferDatasetSchema(records);
  const manifest = await datasetService.persistRows({
    executionId,
    variableName,
    rows: records,
    schema,
  });

  return datasetRefFromManifest(manifest);
};

export const summarizeContextValueForOutput = (value: unknown): unknown => {
  if (isDatasetRef(value)) {
    return value;
  }

  const records = extractInlineRecords(value);
  if (records.length > 0) {
    const schema = resolveContextSchema(value) ?? inferDatasetSchema(records);

    return {
      kind: "dataset-summary",
      rowCount: records.length,
      schema,
      preview: records.slice(0, DATASET_STORAGE.OUTPUT_PREVIEW_ROWS),
    };
  }

  if (typeof value === "string" && value.length > 500000) {
    return `${value.slice(0, 1000)}... (truncated ${value.length} length string)`;
  }

  return value;
};

export const buildExecutionOutputSummary = (
  context: Record<string, unknown>,
): Record<string, unknown> => {
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => [
      key,
      summarizeContextValueForOutput(value),
    ]),
  );
};
