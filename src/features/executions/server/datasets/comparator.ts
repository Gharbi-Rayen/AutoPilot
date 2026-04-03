import { type DatasetSchema, resolveComparableFieldType } from "./schema-types";

export type SortDirection = "asc" | "desc";
export type SortNulls = "first" | "last";
export type SortCompareAs = "string" | "number" | "date" | "boolean";

type ComparableKind = "null" | "number" | "string" | "boolean";

interface ComparableValue {
  kind: ComparableKind;
  value: string | number | boolean | null;
}

interface RowComparatorOptions {
  field: string;
  direction?: SortDirection;
  compareAs?: "string" | "number" | "date";
  nulls?: SortNulls;
  schema?: DatasetSchema;
}

const toCompareMode = (
  compareAs: RowComparatorOptions["compareAs"],
  schema?: DatasetSchema,
  field?: string,
): SortCompareAs => {
  if (compareAs) {
    return compareAs;
  }

  if (field) {
    return resolveComparableFieldType(schema, field);
  }

  return "string";
};

const isNullish = (value: unknown): boolean => {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "")
  );
};

const toComparableValue = (
  value: unknown,
  compareAs: SortCompareAs,
): ComparableValue => {
  if (isNullish(value)) {
    return {
      kind: "null",
      value: null,
    };
  }

  if (compareAs === "number") {
    const numericValue = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(numericValue)) {
      return {
        kind: "number",
        value: numericValue,
      };
    }
  }

  if (compareAs === "date") {
    const timestamp = new Date(String(value)).getTime();
    if (Number.isFinite(timestamp)) {
      return {
        kind: "number",
        value: timestamp,
      };
    }
  }

  if (compareAs === "boolean") {
    if (typeof value === "boolean") {
      return {
        kind: "boolean",
        value,
      };
    }

    const normalized = String(value).trim().toLowerCase();
    if (normalized === "true" || normalized === "1") {
      return {
        kind: "boolean",
        value: true,
      };
    }

    if (normalized === "false" || normalized === "0") {
      return {
        kind: "boolean",
        value: false,
      };
    }
  }

  return {
    kind: "string",
    value: String(value),
  };
};

const normalizeComparatorResult = (result: number): number => {
  if (!Number.isFinite(result)) {
    return 0;
  }

  if (result > 0) {
    return 1;
  }

  if (result < 0) {
    return -1;
  }

  return 0;
};

const compareStrings = (left: string, right: string): number => {
  return normalizeComparatorResult(
    left.localeCompare(right, undefined, {
      sensitivity: "base",
      numeric: true,
    }),
  );
};

const compareSameKind = (
  left: ComparableValue,
  right: ComparableValue,
): number => {
  if (left.kind === "number" && right.kind === "number") {
    return normalizeComparatorResult(Number(left.value) - Number(right.value));
  }

  if (left.kind === "boolean" && right.kind === "boolean") {
    return normalizeComparatorResult(
      Number(Boolean(left.value)) - Number(Boolean(right.value)),
    );
  }

  return compareStrings(String(left.value ?? ""), String(right.value ?? ""));
};

const compareKinds = (
  leftKind: ComparableKind,
  rightKind: ComparableKind,
): number => {
  const order: Record<ComparableKind, number> = {
    null: 0,
    number: 1,
    boolean: 2,
    string: 3,
  };

  return normalizeComparatorResult(order[leftKind] - order[rightKind]);
};

export const createRowComparator = (options: RowComparatorOptions) => {
  const direction = options.direction ?? "asc";
  const nulls = options.nulls ?? "last";
  const compareMode = toCompareMode(
    options.compareAs,
    options.schema,
    options.field,
  );

  return (
    leftRow: Record<string, unknown>,
    rightRow: Record<string, unknown>,
  ): number => {
    const left = toComparableValue(leftRow[options.field], compareMode);
    const right = toComparableValue(rightRow[options.field], compareMode);

    if (left.kind === "null" || right.kind === "null") {
      if (left.kind === "null" && right.kind === "null") {
        return 0;
      }

      const nullOrder = nulls === "first" ? -1 : 1;
      return left.kind === "null" ? nullOrder : -nullOrder;
    }

    let result =
      left.kind === right.kind
        ? compareSameKind(left, right)
        : compareKinds(left.kind, right.kind);

    if (result === 0) {
      result = compareStrings(String(left.value), String(right.value));
    }

    return direction === "desc" ? -result : result;
  };
};
