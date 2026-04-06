import { DATASET_STORAGE } from "@/config/constants";
import type { AsyncOrSyncIterable } from "./async-batch-iterator";
import { toAsyncIterable } from "./async-batch-iterator";
import type { JoinBuildSide, JoinType } from "./join-planner";
import { type OutputColumnSpec, projectRow } from "./project-row";

interface HashJoinOptions {
  leftRows: AsyncOrSyncIterable<Record<string, unknown>>;
  rightRows: AsyncOrSyncIterable<Record<string, unknown>>;
  leftKeys: string[];
  rightKeys: string[];
  joinType: JoinType;
  buildSide: JoinBuildSide;
  maxMatchesPerKey?: number;
  caseInsensitive?: boolean;
  outputColumns?: OutputColumnSpec[];
}

type IndexedRow = {
  row: Record<string, unknown>;
  matched: boolean;
};

const normalizeVal = (val: string, ci: boolean) =>
  ci ? val.toLowerCase() : val;

export const buildMatchKey = (
  row: Record<string, unknown>,
  keyFields: string[],
  caseInsensitive: boolean = false,
): string => {
  return keyFields
    .map((field) => {
      const val = normalizeVal(String(row[field] ?? ""), caseInsensitive);
      return `${val.length}:${val}`;
    })
    .join("|");
};

const collectFieldNames = (rows: Array<Record<string, unknown>>): string[] =>
  Array.from(new Set(rows.flatMap((row) => Object.keys(row))));

const mergeRows = (
  leftRow: Record<string, unknown>,
  rightRow: Record<string, unknown>,
  rightKeys: string[],
): Record<string, unknown> => {
  const merged: Record<string, unknown> = { ...leftRow };

  for (const [field, value] of Object.entries(rightRow)) {
    if (Object.hasOwn(merged, field) && !rightKeys.includes(field)) {
      merged[`right_${field}`] = value;
    } else {
      merged[field] = value;
    }
  }

  return merged;
};

const withRightNulls = (
  leftRow: Record<string, unknown>,
  rightFields: string[],
  rightKeys: string[],
): Record<string, unknown> => {
  const merged: Record<string, unknown> = { ...leftRow };

  for (const field of rightFields) {
    if (Object.hasOwn(merged, field) && !rightKeys.includes(field)) {
      merged[`right_${field}`] = null;
    } else if (!Object.hasOwn(merged, field)) {
      merged[field] = null;
    }
  }

  return merged;
};

const withLeftNulls = (
  rightRow: Record<string, unknown>,
  leftFields: string[],
  rightKeys: string[],
): Record<string, unknown> => {
  const merged: Record<string, unknown> = {};

  for (const field of leftFields) {
    merged[field] = null;
  }

  for (const [field, value] of Object.entries(rightRow)) {
    if (Object.hasOwn(merged, field) && !rightKeys.includes(field)) {
      merged[`right_${field}`] = value;
    } else {
      merged[field] = value;
    }
  }

  return merged;
};

const requiresProbeUnmatchedOutput = (
  joinType: JoinType,
  probeSide: JoinBuildSide,
): boolean => {
  if (joinType === "anti") return true;
  if (joinType === "semi") return false;

  if (probeSide === "left") {
    return (
      joinType === "left" ||
      joinType === "full" ||
      joinType === "left_exclusive"
    );
  }

  return (
    joinType === "right" ||
    joinType === "full" ||
    joinType === "right_exclusive"
  );
};

const requiresBuildUnmatchedOutput = (
  joinType: JoinType,
  buildSide: JoinBuildSide,
): boolean => {
  if (joinType === "semi" || joinType === "anti") return false;

  if (buildSide === "left") {
    return (
      joinType === "left" ||
      joinType === "full" ||
      joinType === "left_exclusive"
    );
  }

  return (
    joinType === "right" ||
    joinType === "full" ||
    joinType === "right_exclusive"
  );
};

const emitsMatches = (joinType: JoinType): boolean => {
  return (
    joinType === "inner" ||
    joinType === "left" ||
    joinType === "right" ||
    joinType === "full" ||
    joinType === "natural"
  );
};

const toHashIndex = (
  rows: Array<Record<string, unknown>>,
  keyFields: string[],
  caseInsensitive: boolean = false,
): Map<string, IndexedRow[]> => {
  const index = new Map<string, IndexedRow[]>();

  for (const row of rows) {
    const key = buildMatchKey(row, keyFields, caseInsensitive);
    const entries = index.get(key);
    const indexedRow = {
      row,
      matched: false,
    };

    if (entries) {
      entries.push(indexedRow);
    } else {
      index.set(key, [indexedRow]);
    }
  }

  return index;
};

export const hashJoinRows = async function* ({
  leftRows,
  rightRows,
  leftKeys,
  rightKeys,
  joinType,
  buildSide,
  maxMatchesPerKey = DATASET_STORAGE.JOIN_MAX_MATCHES_PER_KEY,
  caseInsensitive = false,
  outputColumns,
}: HashJoinOptions): AsyncGenerator<Record<string, unknown>, void, void> {
  if (joinType === "natural" && (leftKeys.length === 0 || rightKeys.length === 0)) {
    throw new Error("Natural Join requires at least one shared column name.");
  }

  const buildOnLeft = buildSide === "left";

  const buildRows = buildOnLeft
    ? await toAsyncIterable(leftRows)
    : await toAsyncIterable(rightRows);

  const buildMaterialized: Array<Record<string, unknown>> = [];
  for await (const row of buildRows) {
    buildMaterialized.push(row);
  }

  const buildKey = buildOnLeft ? leftKeys : rightKeys;
  const buildIndex = toHashIndex(buildMaterialized, buildKey, caseInsensitive);

  const leftFields = buildOnLeft ? collectFieldNames(buildMaterialized) : [];
  const rightFields = buildOnLeft ? [] : collectFieldNames(buildMaterialized);

  const probeSide: JoinBuildSide = buildOnLeft ? "right" : "left";
  const probeRows = buildOnLeft
    ? toAsyncIterable(rightRows)
    : toAsyncIterable(leftRows);

  const probeKey = buildOnLeft ? rightKeys : leftKeys;

  for await (const probeRow of probeRows) {
    if (buildOnLeft) {
      for (const key of Object.keys(probeRow)) {
        if (!rightFields.includes(key)) {
          rightFields.push(key);
        }
      }
    } else {
      for (const key of Object.keys(probeRow)) {
        if (!leftFields.includes(key)) {
          leftFields.push(key);
        }
      }
    }

    const key = buildMatchKey(probeRow, probeKey, caseInsensitive);
    const matches = buildIndex.get(key) ?? [];

    if (matches.length > maxMatchesPerKey) {
      throw new Error(
        "Join stopped because a single key matched too many rows. Reduce duplicates on the join key before running this join.",
      );
    }

    if (matches.length === 0) {
      if (joinType === "anti" && probeSide === "left") {
        yield probeRow;
      } else if (requiresProbeUnmatchedOutput(joinType, probeSide)) {
        if (probeSide === "left") {
          yield projectRow(
            withRightNulls(probeRow, rightFields, rightKeys),
            outputColumns,
          );
        } else {
          yield projectRow(
            withLeftNulls(probeRow, leftFields, rightKeys),
            outputColumns,
          );
        }
      }
      continue;
    }

    if (joinType === "semi" && probeSide === "left") {
      yield probeRow;
      continue;
    }

    for (const match of matches) {
      match.matched = true;

      if (emitsMatches(joinType)) {
        if (buildOnLeft) {
          yield projectRow(
            mergeRows(match.row, probeRow, rightKeys),
            outputColumns,
          );
        } else {
          yield projectRow(
            mergeRows(probeRow, match.row, rightKeys),
            outputColumns,
          );
        }
      }
    }
  }

  if (requiresBuildUnmatchedOutput(joinType, buildSide)) {
    for (const matches of buildIndex.values()) {
      for (const match of matches) {
        if (match.matched) {
          continue;
        }

        if (buildOnLeft) {
          yield projectRow(
            withRightNulls(match.row, rightFields, rightKeys),
            outputColumns,
          );
        } else {
          yield projectRow(
            withLeftNulls(match.row, leftFields, rightKeys),
            outputColumns,
          );
        }
      }
    }
  }
};
