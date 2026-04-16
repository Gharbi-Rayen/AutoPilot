export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_PAGE_SIZE: 10,
  MAX_PAGE_SIZE: 100,
  MIN_PAGE_SIZE: 1,
};

/** Max rows to keep fully in-memory before spilling to OPFS chunks */
export const MAX_IN_MEMORY_ROWS = 200_000;

/** Default chunk size when writing datasets to OPFS */
export const DATASET_CHUNK_SIZE_ROWS = 10_000;

/** Max rows to show in inline previews */
export const DATASET_PREVIEW_ROWS = 10;

/** Max rows for a single page in the dataset viewer */
export const DATASET_PAGE_SIZE = 100;
