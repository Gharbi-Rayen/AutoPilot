import { DATASET_STORAGE } from "@/config/constants";
import {
  type AsyncOrSyncIterable,
  toAsyncIterable,
} from "./async-batch-iterator";

export type JoinRiskLevel = "low" | "medium" | "high";

export interface JoinCardinalityEstimate {
  sampleSize: number;
  leftDistinctRatio: number;
  rightDistinctRatio: number;
  leftSkewRatio: number;
  rightSkewRatio: number;
  estimatedFanout: number;
  riskLevel: JoinRiskLevel;
  guidance: string;
  recommendedBuildSide: "left" | "right";
}

interface KeySampleStats {
  sampledRows: number;
  distinctKeys: number;
  maxBucketSize: number;
}

interface EstimateJoinCardinalityInput {
  leftRows: AsyncOrSyncIterable<Record<string, unknown>>;
  rightRows: AsyncOrSyncIterable<Record<string, unknown>>;
  leftKey: string;
  rightKey: string;
  leftRowCount: number;
  rightRowCount: number;
  sampleSize?: number;
}

const sampleKeyStats = async (
  rows: AsyncOrSyncIterable<Record<string, unknown>>,
  keyField: string,
  sampleSize: number,
): Promise<KeySampleStats> => {
  const counts = new Map<string, number>();
  let sampledRows = 0;

  for await (const row of toAsyncIterable(rows)) {
    if (sampledRows >= sampleSize) {
      break;
    }

    sampledRows += 1;
    const key = String(row[keyField] ?? "");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const maxBucketSize =
    counts.size === 0 ? 0 : Math.max(...Array.from(counts.values()));

  return {
    sampledRows,
    distinctKeys: counts.size,
    maxBucketSize,
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
  leftKey,
  rightKey,
  leftRowCount,
  rightRowCount,
  sampleSize = DATASET_STORAGE.JOIN_CARDINALITY_SAMPLE_ROWS,
}: EstimateJoinCardinalityInput): Promise<JoinCardinalityEstimate> => {
  const safeSampleSize = Math.max(100, sampleSize);

  const [leftStats, rightStats] = await Promise.all([
    sampleKeyStats(leftRows, leftKey, safeSampleSize),
    sampleKeyStats(rightRows, rightKey, safeSampleSize),
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

  return {
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
  };
};
