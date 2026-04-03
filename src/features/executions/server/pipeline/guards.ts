import { DATASET_STORAGE } from "@/config/constants";
import { estimateDataSizeBytes } from "../resource-budget";

const formatStage = (stage?: string) => {
  return stage ? ` (${stage})` : "";
};

export const assertBufferedBatchCount = ({
  bufferedBatches,
  stage,
}: {
  bufferedBatches: number;
  stage?: string;
}) => {
  if (bufferedBatches <= DATASET_STORAGE.MAX_PIPELINE_BUFFERED_BATCHES) {
    return;
  }

  throw new Error(
    `Pipeline buffering exceeded the safety limit${formatStage(stage)}. Use streaming helpers instead of collecting all batches.`,
  );
};

export const assertCollectedRowCount = ({
  rowCount,
  stage,
}: {
  rowCount: number;
  stage?: string;
}) => {
  if (rowCount <= DATASET_STORAGE.MAX_PIPELINE_BUFFERED_ROWS) {
    return;
  }

  throw new Error(
    `Pipeline row buffering exceeded the safety limit${formatStage(stage)}. Process rows incrementally to keep memory usage bounded.`,
  );
};

export const estimateBatchMemoryBytes = <T>(batch: T[]): number => {
  return estimateDataSizeBytes(batch);
};
