import { DATASET_STORAGE } from "@/config/constants";
import {
  assertBufferedBatchCount,
  assertCollectedRowCount,
} from "../pipeline/guards";
import {
  type AsyncOrSyncIterable,
  batchAsyncIterator,
  throwIfAborted,
} from "./async-batch-iterator";

interface BatchPipelineOptions<TInput> {
  source: AsyncOrSyncIterable<TInput>;
  batchSize: number;
  signal?: AbortSignal;
  executionId?: string;
  stage?: string;
}

interface MapBatchesOptions<TInput, TOutput>
  extends BatchPipelineOptions<TInput> {
  mapBatch: (
    batch: TInput[],
    signal?: AbortSignal,
  ) => Promise<TOutput[]> | TOutput[];
}

interface ReduceBatchesOptions<TInput, TState>
  extends BatchPipelineOptions<TInput> {
  initialState: TState;
  reduceBatch: (
    state: TState,
    batch: TInput[],
    signal?: AbortSignal,
  ) => Promise<TState> | TState;
}

export const mapBatches = async <TInput, TOutput>(
  options: MapBatchesOptions<TInput, TOutput>,
): Promise<TOutput[]> => {
  const output: TOutput[] = [];
  let bufferedBatches = 0;
  const stageLabel = options.stage ?? "mapBatches";

  for await (const batch of batchAsyncIterator(
    options.source,
    options.batchSize,
    options.signal,
    {
      executionId: options.executionId,
      stage: stageLabel,
    },
  )) {
    throwIfAborted(options.signal);
    const mapped = await options.mapBatch(batch, options.signal);
    if (mapped.length > 0) {
      bufferedBatches += 1;
      assertBufferedBatchCount({
        bufferedBatches,
        stage: stageLabel,
      });

      output.push(...mapped);

      const safeRowCount = Math.min(
        output.length,
        DATASET_STORAGE.MAX_PIPELINE_BUFFERED_ROWS + 1,
      );
      assertCollectedRowCount({
        rowCount: safeRowCount,
        stage: stageLabel,
      });
    }
  }

  return output;
};

export const mapBatchesStream = async function* <TInput, TOutput>(
  options: MapBatchesOptions<TInput, TOutput>,
): AsyncGenerator<TOutput, void, void> {
  const stageLabel = options.stage ?? "mapBatchesStream";

  for await (const batch of batchAsyncIterator(
    options.source,
    options.batchSize,
    options.signal,
    {
      executionId: options.executionId,
      stage: stageLabel,
    },
  )) {
    throwIfAborted(options.signal);
    const mapped = await options.mapBatch(batch, options.signal);

    for (const item of mapped) {
      yield item;
    }
  }
};

export const reduceBatches = async <TInput, TState>(
  options: ReduceBatchesOptions<TInput, TState>,
): Promise<TState> => {
  let state = options.initialState;
  const stageLabel = options.stage ?? "reduceBatches";

  for await (const batch of batchAsyncIterator(
    options.source,
    options.batchSize,
    options.signal,
    {
      executionId: options.executionId,
      stage: stageLabel,
    },
  )) {
    throwIfAborted(options.signal);
    state = await options.reduceBatch(state, batch, options.signal);
  }

  return state;
};
