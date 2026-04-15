export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_PAGE_SIZE: 5,
  MAX_PAGE_SIZE: 100,
  MIN_PAGE_SIZE: 1,
};

const toPositiveInteger = (value: string | undefined, fallback: number) => {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
};

const resolveDatasetStorageFormat = () => {
  const configuredStorageFormat = process.env.DATASET_STORAGE_FORMAT;

  if (
    configuredStorageFormat === "jsonl" ||
    configuredStorageFormat === "object-storage" ||
    configuredStorageFormat === "columnar"
  ) {
    return configuredStorageFormat;
  }

  return "jsonl";
};

export const EXECUTION_LIMITS = {
  MAX_IN_MEMORY_ROWS: toPositiveInteger(
    process.env.MAX_IN_MEMORY_ROWS,
    200_000,
  ),
  DEFAULT_BATCH_SIZE: toPositiveInteger(process.env.DEFAULT_BATCH_SIZE, 1_000),
  MAX_EXECUTION_OUTPUT_BYTES: toPositiveInteger(
    process.env.MAX_EXECUTION_OUTPUT_BYTES,
    2 * 1024 * 1024,
  ),
};

export const DATASET_STORAGE = {
  ROOT_DIRECTORY:
    process.env.DATASET_STORAGE_ROOT ?? ".autopilot-data/execution-datasets",
  DEFAULT_STORAGE_FORMAT: resolveDatasetStorageFormat(),
  ENABLE_COLUMNAR_ADAPTER:
    process.env.DATASET_ENABLE_COLUMNAR_ADAPTER === "true",
  COLUMNAR_PROTOTYPE_MODE:
    process.env.DATASET_COLUMNAR_PROTOTYPE_MODE !== "false",
  DEFAULT_CHUNK_SIZE_ROWS: toPositiveInteger(
    process.env.DATASET_CHUNK_SIZE_ROWS,
    25_000,
  ),
  CHUNK_OFFSET_STRIDE_ROWS: toPositiveInteger(
    process.env.DATASET_CHUNK_OFFSET_STRIDE_ROWS,
    100,
  ),
  MAX_CHUNK_READ_ROWS: toPositiveInteger(
    process.env.DATASET_MAX_CHUNK_READ_ROWS,
    5000,
  ),
  MAX_INLINE_DATASET_ROWS: toPositiveInteger(
    process.env.DATASET_MAX_INLINE_ROWS,
    5000,
  ),
  MAX_PIPELINE_BUFFERED_BATCHES: toPositiveInteger(
    process.env.DATASET_MAX_PIPELINE_BUFFERED_BATCHES,
    32,
  ),
  MAX_PIPELINE_BUFFERED_ROWS: toPositiveInteger(
    process.env.DATASET_MAX_PIPELINE_BUFFERED_ROWS,
    200_000,
  ),
  MAX_TOTAL_DISK_USAGE_BYTES: toPositiveInteger(
    process.env.DATASET_MAX_TOTAL_DISK_USAGE_BYTES,
    4 * 1024 * 1024 * 1024,
  ),
  MAX_TOTAL_TEMP_FILES: toPositiveInteger(
    process.env.DATASET_MAX_TOTAL_TEMP_FILES,
    400,
  ),
  MAX_PIPELINE_MEMORY_BYTES: toPositiveInteger(
    process.env.DATASET_MAX_PIPELINE_MEMORY_BYTES,
    256 * 1024 * 1024,
  ),
  MAX_CONCURRENT_HEAVY_EXECUTIONS: toPositiveInteger(
    process.env.DATASET_MAX_CONCURRENT_HEAVY_EXECUTIONS,
    2,
  ),
  EXECUTION_QUEUE_POLL_INTERVAL_MS: toPositiveInteger(
    process.env.DATASET_EXECUTION_QUEUE_POLL_INTERVAL_MS,
    150,
  ),
  RUN_STARTUP_CLEANUP: process.env.DATASET_RUN_STARTUP_CLEANUP === "true",
  EXECUTION_QUEUE_MAX_WAIT_MS: toPositiveInteger(
    process.env.DATASET_EXECUTION_QUEUE_MAX_WAIT_MS,
    30 * 60 * 1000,
  ),
  OUTPUT_PREVIEW_ROWS: toPositiveInteger(
    process.env.DATASET_OUTPUT_PREVIEW_ROWS,
    10,
  ),
  EXTERNAL_SORT_RUN_TARGET_BYTES: toPositiveInteger(
    process.env.DATASET_EXTERNAL_SORT_RUN_TARGET_BYTES,
    256 * 1024 * 1024, // 256 MB — fewer runs, fewer merge passes (was 50 MB)
  ),
  EXTERNAL_SORT_MAX_FAN_IN: toPositiveInteger(
    process.env.DATASET_EXTERNAL_SORT_MAX_FAN_IN,
    16, // wider merge fan-in reduces passes needed (was 8)
  ),
  JOIN_SMALL_SIDE_MAX_ROWS: toPositiveInteger(
    process.env.DATASET_JOIN_SMALL_SIDE_MAX_ROWS,
    100_000,
  ),
  JOIN_MAX_BUILD_SIDE_ROWS: toPositiveInteger(
    process.env.DATASET_JOIN_MAX_BUILD_SIDE_ROWS,
    15_000_000,
  ),
  JOIN_REQUIRE_PARTITIONED_ABOVE_ROWS: toPositiveInteger(
    process.env.DATASET_JOIN_REQUIRE_PARTITIONED_ABOVE_ROWS,
    10_000_000,
  ),
  JOIN_CARDINALITY_SAMPLE_ROWS: toPositiveInteger(
    process.env.DATASET_JOIN_CARDINALITY_SAMPLE_ROWS,
    5_000,
  ),
  JOIN_MAX_SKEW_RATIO: toPositiveInteger(
    process.env.DATASET_JOIN_MAX_SKEW_RATIO_PERCENT,
    35,
  ),
  JOIN_MIN_DISTINCT_RATIO: toPositiveInteger(
    process.env.DATASET_JOIN_MIN_DISTINCT_RATIO_PERCENT,
    5,
  ),
  JOIN_MAX_ESTIMATED_FANOUT: toPositiveInteger(
    process.env.DATASET_JOIN_MAX_ESTIMATED_FANOUT,
    100_000,
  ),
  JOIN_MAX_MATCHES_PER_KEY: toPositiveInteger(
    process.env.DATASET_JOIN_MAX_MATCHES_PER_KEY,
    50_000,
  ),
  COMPARE_MAX_INDEX_ROWS: toPositiveInteger(
    process.env.DATASET_COMPARE_MAX_INDEX_ROWS,
    15_000_000,
  ),
  COMPARE_MAX_DIFF_SAMPLES: toPositiveInteger(
    process.env.DATASET_COMPARE_MAX_DIFF_SAMPLES,
    2_000,
  ),
  TEMP_DATASET_MAX_AGE_MS: toPositiveInteger(
    process.env.DATASET_TEMP_MAX_AGE_MS,
    24 * 60 * 60 * 1000,
  ),
  COMPLETED_DATASET_TTL_MS: toPositiveInteger(
    process.env.DATASET_COMPLETED_TTL_MS,
    7 * 24 * 60 * 60 * 1000,
  ),
  ORPHAN_DATASET_TTL_MS: toPositiveInteger(
    process.env.DATASET_ORPHAN_TTL_MS,
    2 * 24 * 60 * 60 * 1000,
  ),
  // Cross-join limits — raise via env vars if you have the hardware for it
  CROSS_JOIN_MAX_OUTPUT_ROWS: toPositiveInteger(
    process.env.DATASET_CROSS_JOIN_MAX_OUTPUT_ROWS,
    100_000_000, // 100M default; override with DATASET_CROSS_JOIN_MAX_OUTPUT_ROWS
  ),
  CROSS_JOIN_MAX_RIGHT_ROWS: toPositiveInteger(
    process.env.DATASET_CROSS_JOIN_MAX_RIGHT_ROWS,
    100_000, // right side is materialized in memory; 100K ≈ ~20 MB typical
  ),
};

export const UNION_DEDUP_MAX_ROWS = 500_000;
