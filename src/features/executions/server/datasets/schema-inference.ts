import type {
  DatasetFieldSchema,
  DatasetFieldType,
  DatasetSchema,
} from "./schema-types";

type DatasetRow = Record<string, unknown>;

const BOOLEAN_TRUE_VALUES = new Set(["true", "1", "yes", "y", "on"]);
const BOOLEAN_FALSE_VALUES = new Set(["false", "0", "no", "n", "off"]);

const isDateLikeString = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (!/[-/:T]/.test(trimmed)) {
    return false;
  }

  const timestamp = Date.parse(trimmed);
  return Number.isFinite(timestamp);
};

const detectValueType = (value: unknown): DatasetFieldType => {
  if (value === undefined || value === null) {
    return "null";
  }

  if (typeof value === "boolean") {
    return "boolean";
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? "number" : "unknown";
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return "null";
    }

    const lower = trimmed.toLowerCase();
    if (BOOLEAN_TRUE_VALUES.has(lower) || BOOLEAN_FALSE_VALUES.has(lower)) {
      return "boolean";
    }

    const parsedNumber = Number(trimmed);
    if (Number.isFinite(parsedNumber)) {
      return "number";
    }

    if (isDateLikeString(trimmed)) {
      return "date";
    }

    return "string";
  }

  return "unknown";
};

const stringifySampleValue = (value: unknown) => {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value);
};

const selectDominantType = (
  counts: Map<DatasetFieldType, number>,
): DatasetFieldType => {
  const candidates: DatasetFieldType[] = [
    "number",
    "boolean",
    "date",
    "string",
    "unknown",
  ];

  let dominant: DatasetFieldType = "unknown";
  let dominantCount = -1;

  for (const candidate of candidates) {
    const count = counts.get(candidate) ?? 0;
    if (count > dominantCount) {
      dominant = candidate;
      dominantCount = count;
    }
  }

  return dominant;
};

export const inferDatasetSchema = (
  rows: DatasetRow[],
  sampleLimit = 500,
): DatasetSchema => {
  const schema: DatasetSchema = {};
  if (rows.length === 0) {
    return schema;
  }

  const sampledRows = rows.slice(0, Math.max(1, sampleLimit));
  const fieldNames = Array.from(
    new Set(sampledRows.flatMap((row) => Object.keys(row))),
  );

  for (const fieldName of fieldNames) {
    const typeCounts = new Map<DatasetFieldType, number>();
    const sampleValues: string[] = [];
    let nullable = false;

    for (const row of sampledRows) {
      const value = row[fieldName];
      const type = detectValueType(value);

      if (type === "null") {
        nullable = true;
      } else {
        typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
      }

      if (sampleValues.length < 3) {
        sampleValues.push(stringifySampleValue(value));
      }
    }

    const type = selectDominantType(typeCounts);

    schema[fieldName] = {
      type,
      nullable,
      sampleValues,
    };
  }

  return schema;
};

export const coerceValueBySchema = (
  value: unknown,
  fieldSchema: DatasetFieldSchema,
): unknown => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (fieldSchema.type === "number") {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (fieldSchema.type === "boolean") {
    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "number") {
      if (value === 1) {
        return true;
      }
      if (value === 0) {
        return false;
      }
      return null;
    }

    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (BOOLEAN_TRUE_VALUES.has(normalized)) {
        return true;
      }
      if (BOOLEAN_FALSE_VALUES.has(normalized)) {
        return false;
      }
    }

    return null;
  }

  if (fieldSchema.type === "date") {
    const parsedDate = new Date(String(value));
    if (Number.isNaN(parsedDate.getTime())) {
      return null;
    }
    return parsedDate.toISOString();
  }

  if (fieldSchema.type === "string") {
    return String(value);
  }

  if (fieldSchema.type === "null") {
    return null;
  }

  return value;
};

export const applySchemaToRow = (
  row: DatasetRow,
  schema: DatasetSchema,
): DatasetRow => {
  const typedRow: DatasetRow = { ...row };

  for (const [fieldName, fieldSchema] of Object.entries(schema)) {
    typedRow[fieldName] = coerceValueBySchema(typedRow[fieldName], fieldSchema);
  }

  return typedRow;
};

export const applySchemaToRows = (
  rows: DatasetRow[],
  schema: DatasetSchema,
): DatasetRow[] => {
  return rows.map((row) => applySchemaToRow(row, schema));
};
