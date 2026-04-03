import { DATASET_STORAGE } from "@/config/constants";
import type { AsyncOrSyncIterable } from "./async-batch-iterator";
import { toAsyncIterable } from "./async-batch-iterator";
import type { JoinBuildSide, JoinType } from "./join-planner";

interface HashJoinOptions {
  leftRows: AsyncOrSyncIterable<Record<string, unknown>>;
  rightRows: AsyncOrSyncIterable<Record<string, unknown>>;
  leftKey: string;
  rightKey: string;
  joinType: JoinType;
  buildSide: JoinBuildSide;
  maxMatchesPerKey?: number;
}

type IndexedRow = {
  row: Record<string, unknown>;
  matched: boolean;
};

const collectFieldNames = (rows: Array<Record<string, unknown>>): string[] =>
  Array.from(new Set(rows.flatMap((row) => Object.keys(row))));

const mergeRows = (
  leftRow: Record<string, unknown>,
  rightRow: Record<string, unknown>,
  rightKey: string,
): Record<string, unknown> => {
  const merged: Record<string, unknown> = { ...leftRow };

  for (const [field, value] of Object.entries(rightRow)) {
    if (Object.hasOwn(merged, field) && field !== rightKey) {
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
  rightKey: string,
): Record<string, unknown> => {
  const merged: Record<string, unknown> = { ...leftRow };

  for (const field of rightFields) {
    if (Object.hasOwn(merged, field) && field !== rightKey) {
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
  rightKey: string,
): Record<string, unknown> => {
  const merged: Record<string, unknown> = {};

  for (const field of leftFields) {
    merged[field] = null;
  }

  for (const [field, value] of Object.entries(rightRow)) {
    if (Object.hasOwn(merged, field) && field !== rightKey) {
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
    joinType === "full"
  );
};

const toHashIndex = (
  rows: Array<Record<string, unknown>>,
  keyField: string,
): Map<string, IndexedRow[]> => {
  const index = new Map<string, IndexedRow[]>();

  for (const row of rows) {
    const key = String(row[keyField] ?? "");
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
  leftKey,
  rightKey,
  joinType,
  buildSide,
  maxMatchesPerKey = DATASET_STORAGE.JOIN_MAX_MATCHES_PER_KEY,
}: HashJoinOptions): AsyncGenerator<Record<string, unknown>, void, void> {
  const buildOnLeft = buildSide === "left";

  const buildRows = buildOnLeft
    ? await toAsyncIterable(leftRows)
    : await toAsyncIterable(rightRows);

  const buildMaterialized: Array<Record<string, unknown>> = [];
  for await (const row of buildRows) {
    buildMaterialized.push(row);
  }

  const buildKey = buildOnLeft ? leftKey : rightKey;
  const buildIndex = toHashIndex(buildMaterialized, buildKey);

  const leftFields = buildOnLeft ? collectFieldNames(buildMaterialized) : [];
  const rightFields = buildOnLeft ? [] : collectFieldNames(buildMaterialized);

  const probeSide: JoinBuildSide = buildOnLeft ? "right" : "left";
  const probeRows = buildOnLeft
    ? toAsyncIterable(rightRows)
    : toAsyncIterable(leftRows);

  const probeKey = buildOnLeft ? rightKey : leftKey;

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

    const key = String(probeRow[probeKey] ?? "");
    const matches = buildIndex.get(key) ?? [];

    if (matches.length > maxMatchesPerKey) {
      throw new Error(
        "Join stopped because a single key matched too many rows. Reduce duplicates on the join key before running this join.",
      );
    }

    if (matches.length === 0) {
      if (requiresProbeUnmatchedOutput(joinType, probeSide)) {
        if (probeSide === "left") {
          yield withRightNulls(probeRow, rightFields, rightKey);
        } else {
          yield withLeftNulls(probeRow, leftFields, rightKey);
        }
      }
      continue;
    }

    for (const match of matches) {
      match.matched = true;

      if (emitsMatches(joinType)) {
        if (buildOnLeft) {
          yield mergeRows(match.row, probeRow, rightKey);
        } else {
          yield mergeRows(probeRow, match.row, rightKey);
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
          yield withRightNulls(match.row, rightFields, rightKey);
        } else {
          yield withLeftNulls(match.row, leftFields, rightKey);
        }
      }
    }
  }
};
