import { DATASET_STORAGE } from "@/config/constants";
import {
  type AsyncOrSyncIterable,
  toAsyncIterable,
} from "./async-batch-iterator";
import { buildMatchKey } from "./hash-join";

export type JoinRiskLevel = "low" | "medium" | "high";

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

export interface JoinCardinalityEstimate {
  leftAvgRowBytes: number;
  rightAvgRowBytes: number;
  sampleSize: number;
  leftDistinctRatio: number;
  rightDistinctRatio: number;
  leftSkewRatio: number;
  rightSkewRatio: number;
  estimatedFanout: number;
  riskLevel: JoinRiskLevel;
  guidance: string;
  recommendedBuildSide: "left" | "right";
  warnings?: string[];
}

interface DatasetSampleStats {
  sampledRows: number;
  distinctKeys: number;
  maxBucketSize: number;
  avgRowBytes: number;
  keyTypes: Record<string, string>;
}

interface EstimateJoinCardinalityInput {
  leftRows: AsyncOrSyncIterable<Record<string, unknown>>;
  rightRows: AsyncOrSyncIterable<Record<string, unknown>>;
  leftKeys?: string[];
  rightKeys?: string[];
  joinType?: string;
  leftRowCount: number;
  rightRowCount: number;
  sampleSize?: number;
}

const sampleDatasetStats = async (
  rows: AsyncOrSyncIterable<Record<string, unknown>>,
  keyFields: string[],
  sampleSize: number,
): Promise<DatasetSampleStats> => {
  const counts = new Map<string, number>();
  let sampledRows = 0;
  let totalBytes = 0;
  const keyTypes: Record<string, string> = {};

  for await (const row of toAsyncIterable(rows)) {
    if (sampledRows >= sampleSize) {
      break;
    }

    if (sampledRows === 0) {
      for (const field of keyFields) {
        if (row[field] !== undefined && row[field] !== null) {
          keyTypes[field] = typeof row[field];
        }
      }
    }

    sampledRows += 1;
    totalBytes += Buffer.byteLength(JSON.stringify(row));
    const key = buildMatchKey(row, keyFields);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const maxBucketSize =
    counts.size === 0 ? 0 : Math.max(...Array.from(counts.values()));

  return {
    sampledRows,
    distinctKeys: counts.size,
    maxBucketSize,
    avgRowBytes: sampledRows > 0 ? Math.ceil(totalBytes / sampledRows) : 0,
    keyTypes,
  };
};

const clampRatio = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  if (value >= 1) {
    return 1;
  }

  return value;
};

export const estimateJoinCardinality = async ({
  leftRows,
  rightRows,
  leftKeys,
  rightKeys,
  joinType,
  leftRowCount,
  rightRowCount,
  sampleSize = DATASET_STORAGE.JOIN_CARDINALITY_SAMPLE_ROWS,
}: EstimateJoinCardinalityInput): Promise<JoinCardinalityEstimate> => {
  if (joinType === "cross") {
    const CROSS_JOIN_MAX_OUTPUT_ROWS = 1_000_000;
    const estimatedOutput = leftRowCount * rightRowCount;
    if (estimatedOutput > CROSS_JOIN_MAX_OUTPUT_ROWS) {
      throw new BudgetExceededError(
        `Cross Join would produce ~${estimatedOutput.toLocaleString()} rows. ` +
          `Maximum is ${CROSS_JOIN_MAX_OUTPUT_ROWS.toLocaleString()}.`,
      );
    }
    return {
      leftAvgRowBytes: 0,
      rightAvgRowBytes: 0,
      sampleSize: 0,
      leftDistinctRatio: 1,
      rightDistinctRatio: 1,
      leftSkewRatio: 0,
      rightSkewRatio: 0,
      estimatedFanout: leftRowCount * rightRowCount,
      riskLevel:
        leftRowCount * rightRowCount > DATASET_STORAGE.JOIN_SMALL_SIDE_MAX_ROWS
          ? "high"
          : ("low" as JoinRiskLevel),
      guidance: "Cross join cardinality is fully deterministic.",
      recommendedBuildSide: (leftRowCount <= rightRowCount
        ? "left"
        : "right") as "left" | "right",
    };
  }

  if (
    !leftKeys ||
    !rightKeys ||
    leftKeys.length === 0 ||
    rightKeys.length === 0
  ) {
    throw new Error(
      "Both leftKeys and rightKeys are required for non-cross joins.",
    );
  }

  const safeSampleSize = Math.max(100, sampleSize);

  const [leftStats, rightStats] = await Promise.all([
    sampleDatasetStats(leftRows, leftKeys, safeSampleSize),
    sampleDatasetStats(rightRows, rightKeys, safeSampleSize),
  ]);

  const leftDistinctRatio = clampRatio(
    leftStats.sampledRows === 0
      ? 0
      : leftStats.distinctKeys / leftStats.sampledRows,
  );
  const rightDistinctRatio = clampRatio(
    rightStats.sampledRows === 0
      ? 0
      : rightStats.distinctKeys / rightStats.sampledRows,
  );

  const leftSkewRatio = clampRatio(
    leftStats.sampledRows === 0
      ? 0
      : leftStats.maxBucketSize / leftStats.sampledRows,
  );
  const rightSkewRatio = clampRatio(
    rightStats.sampledRows === 0
      ? 0
      : rightStats.maxBucketSize / rightStats.sampledRows,
  );

  const estimatedLeftDistinct = Math.max(
    1,
    Math.floor(leftRowCount * Math.max(leftDistinctRatio, 0.0001)),
  );
  const estimatedRightDistinct = Math.max(
    1,
    Math.floor(rightRowCount * Math.max(rightDistinctRatio, 0.0001)),
  );

  const estimatedFanout =
    (leftRowCount / estimatedLeftDistinct) *
    (rightRowCount / estimatedRightDistinct);

  const skewLimitRatio = DATASET_STORAGE.JOIN_MAX_SKEW_RATIO / 100;
  const minDistinctRatio = DATASET_STORAGE.JOIN_MIN_DISTINCT_RATIO / 100;

  let riskLevel: JoinRiskLevel = "low";
  let guidance = "Key distribution looks healthy for hash join.";

  const hasHighSkew =
    leftSkewRatio >= skewLimitRatio || rightSkewRatio >= skewLimitRatio;
  const hasLowCardinality =
    leftDistinctRatio <= minDistinctRatio ||
    rightDistinctRatio <= minDistinctRatio;

  if (
    estimatedFanout >= DATASET_STORAGE.JOIN_MAX_ESTIMATED_FANOUT ||
    (hasHighSkew && hasLowCardinality)
  ) {
    riskLevel = "high";
    guidance =
      "Join key distribution is highly skewed. Reduce duplicates or split data before joining.";
  } else if (hasHighSkew || hasLowCardinality) {
    riskLevel = "medium";
    guidance =
      "Join key skew detected. Keep an eye on memory usage and consider pre-aggregation.";
  }

  const recommendedBuildSide: "left" | "right" =
    leftRowCount <= rightRowCount ? "left" : "right";

  const warnings: string[] = [];
  for (let i = 0; i < leftKeys.length; i++) {
    const leftType = leftStats.keyTypes[leftKeys[i]];
    const rightType = rightStats.keyTypes[rightKeys[i]];
    if (leftType && rightType && leftType !== rightType) {
      warnings.push(
        `Left key '${leftKeys[i]}' is type ${leftType} but right key '${rightKeys[i]}' is type ${rightType}. Values will be coerced to string for comparison.`,
      );
    }
  }

  return {
    leftAvgRowBytes: leftStats.avgRowBytes,
    rightAvgRowBytes: rightStats.avgRowBytes,
    sampleSize: Math.min(
      safeSampleSize,
      Math.max(leftStats.sampledRows, rightStats.sampledRows),
    ),
    leftDistinctRatio,
    rightDistinctRatio,
    leftSkewRatio,
    rightSkewRatio,
    estimatedFanout,
    riskLevel,
    guidance,
    recommendedBuildSide,
    warnings,
  };
};
