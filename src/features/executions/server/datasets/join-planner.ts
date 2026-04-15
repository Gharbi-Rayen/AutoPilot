import { DATASET_STORAGE } from "@/config/constants";
import type { JoinCardinalityEstimate } from "./cardinality-estimator";
import type { OutputColumnSpec } from "./project-row";

export type JoinType =
  | "inner"
  | "left"
  | "right"
  | "full"
  | "full_exclusive"
  | "left_exclusive"
  | "right_exclusive";

export type JoinBuildSide = "left" | "right";

export type JoinPlan =
  | {
      strategy: "hash";
      buildSide: JoinBuildSide;
      reason: string;
      requiresPartitionedFlag: boolean;
      caseInsensitive: boolean;
      outputColumns?: OutputColumnSpec[];
      sharedColumns?: string[];
    }
  | {
      strategy: "reject";
      reason: string;
    };

interface PlanJoinInput {
  leftRows: number;
  rightRows: number;
  leftKeys: string[];
  rightKeys: string[];
  joinType: JoinType;
  allowPartitionedLargeJoin?: boolean;
  estimate?: JoinCardinalityEstimate;
  caseInsensitive?: boolean;
  outputColumns?: OutputColumnSpec[];
}

const KEY_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const validateJoinKey = (label: "leftKey" | "rightKey", value: string) => {
  const trimmed = value.trim();

  if (!trimmed) {
    return `${label} is required`;
  }

  if (!KEY_NAME_PATTERN.test(trimmed)) {
    return `${label} '${value}' is unsupported. Use a single field name (letters, numbers, underscore) without nesting.`;
  }

  return null;
};

export const planJoinStrategy = (input: PlanJoinInput): JoinPlan => {
  if (!input.leftKeys || input.leftKeys.length === 0) {
    return { strategy: "reject", reason: "leftKeys must be provided" };
  }
  if (!input.rightKeys || input.rightKeys.length === 0) {
    return { strategy: "reject", reason: "rightKeys must be provided" };
  }

  for (const key of input.leftKeys) {
    const leftKeyError = validateJoinKey("leftKey", key);
    if (leftKeyError) return { strategy: "reject", reason: leftKeyError };
  }
  for (const key of input.rightKeys) {
    const rightKeyError = validateJoinKey("rightKey", key);
    if (rightKeyError) return { strategy: "reject", reason: rightKeyError };
  }

  const leftRows = Math.max(0, input.leftRows);
  const rightRows = Math.max(0, input.rightRows);

  const leftIsLarge = leftRows > DATASET_STORAGE.JOIN_SMALL_SIDE_MAX_ROWS;
  const rightIsLarge = rightRows > DATASET_STORAGE.JOIN_SMALL_SIDE_MAX_ROWS;
  const largeLarge = leftIsLarge && rightIsLarge;

  if (
    largeLarge &&
    (leftRows > DATASET_STORAGE.JOIN_REQUIRE_PARTITIONED_ABOVE_ROWS ||
      rightRows > DATASET_STORAGE.JOIN_REQUIRE_PARTITIONED_ABOVE_ROWS) &&
    !input.allowPartitionedLargeJoin
  ) {
    return {
      strategy: "reject",
      reason:
        "Large-large join blocked by planner. Enable allowPartitionedLargeJoin to confirm the heavier strategy explicitly.",
    };
  }

  const buildSide: JoinBuildSide =
    input.estimate?.recommendedBuildSide ??
    (leftRows <= rightRows ? "left" : "right");

  const buildSideRows = buildSide === "left" ? leftRows : rightRows;

  if (buildSideRows > DATASET_STORAGE.JOIN_MAX_BUILD_SIDE_ROWS) {
    return {
      strategy: "reject",
      reason:
        "Join blocked because the build side exceeds the safe hash-join threshold. Reduce input size or use a partitioned strategy.",
    };
  }

  if (input.estimate?.riskLevel === "high") {
    if (!input.estimate.warnings) {
      input.estimate.warnings = [];
    }
    input.estimate.warnings.push(
      `Join cardinality warning: ${input.estimate.guidance}`,
    );
    // Instead of rejecting the join, we allow it to proceed with a severe warning.
  }

  return {
    strategy: "hash",
    buildSide,
    reason: largeLarge
      ? "Large-large join allowed via explicit partitioned strategy flag; executing guarded hash join on the smaller side."
      : input.estimate?.riskLevel === "high"
        ? `Hash join selected despite severe skew warning: ${input.estimate.guidance}`
        : input.estimate?.riskLevel === "medium"
          ? `Hash join selected with skew warning: ${input.estimate.guidance}`
          : "Hash join on the smaller side.",
    requiresPartitionedFlag: largeLarge,
    caseInsensitive: input.caseInsensitive ?? false,
    outputColumns: input.outputColumns,
  };
};
