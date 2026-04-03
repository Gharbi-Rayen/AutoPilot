import type { DatasetSchema } from "./schema-types";

export interface DatasetRef {
  kind: "dataset";
  datasetId: string;
  executionId: string;
  variableName: string;
  storage: "jsonl" | "object-storage" | "columnar";
  manifestVersion: number;
  rowCount: number;
  chunkCount: number;
  byteSize: number;
  schema?: DatasetSchema;
}

export const isDatasetRef = (value: unknown): value is DatasetRef => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<DatasetRef>;

  return (
    candidate.kind === "dataset" &&
    typeof candidate.datasetId === "string" &&
    typeof candidate.executionId === "string" &&
    typeof candidate.variableName === "string" &&
    typeof candidate.storage === "string" &&
    typeof candidate.manifestVersion === "number" &&
    typeof candidate.rowCount === "number" &&
    typeof candidate.chunkCount === "number" &&
    typeof candidate.byteSize === "number"
  );
};
