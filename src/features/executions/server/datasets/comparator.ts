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

// Pre-create once; localeCompare with options re-instantiates Intl.Collator on
// every call which is ~5–10× slower for large sorts.
const COLLATOR = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
});

const compareStrings = (left: string, right: string): number => {
  return normalizeComparatorResult(COLLATOR.compare(left, right));
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

/**
 * Creates a function that extracts a precomputed sort key from a row.
 * The key is computed once per row and used for all comparisons,
 * avoiding repeated type coercion and object allocation.
 *
 * Numeric/date fields return `number`, string/boolean fields return `string`,
 * and null/missing/invalid values return `null`.
 */
export const createKeyExtractor = (
  options: RowComparatorOptions,
): ((row: Record<string, unknown>) => number | string | null) => {
  const compareMode = toCompareMode(
    options.compareAs,
    options.schema,
    options.field,
  );
  const { field } = options;

  return (row: Record<string, unknown>): number | string | null => {
    const value = row[field];
    if (isNullish(value)) return null;

    if (compareMode === "number") {
      const n = typeof value === "number" ? value : Number(value);
      return Number.isFinite(n) ? n : null;
    }

    if (compareMode === "date") {
      const ts = new Date(String(value)).getTime();
      return Number.isFinite(ts) ? ts : null;
    }

    if (compareMode === "boolean") {
      if (typeof value === "boolean") return value ? 1 : 0;
      const norm = String(value).trim().toLowerCase();
      if (norm === "true" || norm === "1") return 1;
      if (norm === "false" || norm === "0") return 0;
      return null;
    }

    // string fallback
    return String(value);
  };
};

/**
 * Creates a fast comparator that works directly on precomputed sort keys.
 * Handles direction, null positioning, and stability via sequence tiebreaker.
 *
 * Pair with `createKeyExtractor` — both must use the same `direction` and `nulls`.
 */
export const createKeyComparator = (
  direction: SortDirection,
  nulls: SortNulls,
): ((
  aKey: number | string | null,
  bKey: number | string | null,
  aSeq: number,
  bSeq: number,
) => number) => {
  const nullOrder = nulls === "first" ? -1 : 1;

  return (aKey, bKey, aSeq, bSeq): number => {
    // Null handling is independent of direction — always first or always last.
    if (aKey === null || bKey === null) {
      if (aKey === null && bKey === null) return aSeq - bSeq;
      return aKey === null ? nullOrder : -nullOrder;
    }

    let cmp: number;
    if (typeof aKey === "number" && typeof bKey === "number") {
      // Direct numeric comparison; handles -Infinity / Infinity correctly.
      cmp = aKey === bKey ? 0 : aKey < bKey ? -1 : 1;
    } else if (typeof aKey !== typeof bKey) {
      // Mixed types: number sorts before string (matches compareKinds ordering).
      cmp = typeof aKey === "number" ? -1 : 1;
    } else {
      cmp = normalizeComparatorResult(
        COLLATOR.compare(aKey as string, bKey as string),
      );
    }

    if (cmp !== 0) return direction === "desc" ? -cmp : cmp;
    return aSeq - bSeq; // stability tiebreaker
  };
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
