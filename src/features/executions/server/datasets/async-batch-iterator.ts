export type AsyncOrSyncIterable<T> = AsyncIterable<T> | Iterable<T>;

import { estimateBatchMemoryBytes } from "../pipeline/guards";
import {
  releasePipelineMemory,
  reservePipelineMemory,
} from "../resource-budget";

const toAbortError = (reason?: unknown) => {
  if (reason instanceof Error) {
    return reason;
  }

  return new Error("Dataset pipeline aborted");
};

export const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw toAbortError(signal.reason);
  }
};

const isAsyncIterable = <T>(value: unknown): value is AsyncIterable<T> => {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof (value as AsyncIterable<T>)[Symbol.asyncIterator] === "function"
  );
};

const isIterable = <T>(value: unknown): value is Iterable<T> => {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.iterator in value &&
    typeof (value as Iterable<T>)[Symbol.iterator] === "function"
  );
};

export const toAsyncIterable = async function* <T>(
  source: AsyncOrSyncIterable<T>,
  signal?: AbortSignal,
): AsyncGenerator<T, void, void> {
  if (isAsyncIterable<T>(source)) {
    for await (const item of source) {
      throwIfAborted(signal);
      yield item;
    }
    return;
  }

  if (!isIterable<T>(source)) {
    throw new Error("Expected an iterable or async iterable source");
  }

  for (const item of source) {
    throwIfAborted(signal);
    yield item;
  }
};

export const batchAsyncIterator = async function* <T>(
  source: AsyncOrSyncIterable<T>,
  batchSize: number,
  signal?: AbortSignal,
  options?: {
    executionId?: string;
    stage?: string;
  },
): AsyncGenerator<T[], void, void> {
  const safeBatchSize =
    Number.isInteger(batchSize) && batchSize > 0 ? batchSize : 1;

  let batch: T[] = [];
  let pendingReservationBytes = 0;

  const reserveBatch = (items: T[]) => {
    if (!options?.executionId || items.length === 0) {
      pendingReservationBytes = 0;
      return;
    }

    const estimatedBytes = estimateBatchMemoryBytes(items);
    reservePipelineMemory(
      options.executionId,
      estimatedBytes,
      options.stage ?? "pipeline batch iterator",
    );
    pendingReservationBytes = estimatedBytes;
  };

  const releasePendingReservation = () => {
    if (!options?.executionId || pendingReservationBytes <= 0) {
      pendingReservationBytes = 0;
      return;
    }

    releasePipelineMemory(options.executionId, pendingReservationBytes);
    pendingReservationBytes = 0;
  };

  try {
    for await (const item of toAsyncIterable(source, signal)) {
      batch.push(item);

      if (batch.length >= safeBatchSize) {
        const batchToYield = batch;
        batch = [];
        reserveBatch(batchToYield);
        yield batchToYield;
        releasePendingReservation();
      }
    }

    if (batch.length > 0) {
      const batchToYield = batch;
      batch = [];
      reserveBatch(batchToYield);
      yield batchToYield;
      releasePendingReservation();
    }
  } finally {
    releasePendingReservation();
  }
};
