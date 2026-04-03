export type DatasetFieldType =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "null"
  | "unknown";

export interface DatasetFieldSchema {
  type: DatasetFieldType;
  nullable: boolean;
  sampleValues?: string[];
}

export type DatasetSchema = Record<string, DatasetFieldSchema>;

export const DATASET_TYPE_POLICY = {
  id: "canonical-schema-typed-storage" as const,
  description:
    "Persist values in canonical schema-typed form and normalize again at read boundaries.",
};

export const getFieldSchema = (
  schema: DatasetSchema | undefined,
  fieldName: string,
): DatasetFieldSchema | undefined => {
  if (!schema) {
    return undefined;
  }

  return schema[fieldName];
};

export const resolveComparableFieldType = (
  schema: DatasetSchema | undefined,
  fieldName: string,
): Extract<DatasetFieldType, "string" | "number" | "boolean" | "date"> => {
  const fieldType = getFieldSchema(schema, fieldName)?.type;

  if (
    fieldType === "number" ||
    fieldType === "boolean" ||
    fieldType === "date"
  ) {
    return fieldType;
  }

  return "string";
};
