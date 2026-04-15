/**
 * Singleton BullMQ queue connections for use inside Inngest executors.
 *
 * Each executor module must NOT create new Redis/Queue instances per call —
 * that opens a new TCP connection on every Inngest step execution and will
 * exhaust Redis maxclients under any real load.
 *
 * These singletons are created once per process lifetime and reused.
 * In serverless (Vercel) they persist for the life of the warm instance.
 * In long-running processes (workers, Railway) they persist forever.
 *
 * NOTE: Workers have their own dedicated connections defined in their own files.
 *       These singletons are only for the executor side (enqueue calls).
 */

import { Queue } from "bullmq";
import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

function makeConnection(): Redis {
  return new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false,
  });
}

function makeQueue(name: string): Queue {
  return new Queue(name, {
    connection: makeConnection(),
    defaultJobOptions: {
      removeOnComplete: 100,
      removeOnFail: 50,
    },
  });
}

// One Queue singleton per operation type — created on first use.
// Lazy initialization so the connection is only opened when the executor actually runs.
let _parseQueue: Queue | undefined;
let _sortQueue: Queue | undefined;
let _filterQueue: Queue | undefined;
let _joinQueue: Queue | undefined;
let _sequenceQueue: Queue | undefined;
let _aggregateQueue: Queue | undefined;
let _columnStatsQueue: Queue | undefined;
let _compareQueue: Queue | undefined;
let _deduplicateQueue: Queue | undefined;
let _transformQueue: Queue | undefined;

export const getCsvParseQueue = (): Queue => {
  if (!_parseQueue) {
    _parseQueue = makeQueue("csv-parse");
  }
  return _parseQueue;
};

export const getCsvSortQueue = (): Queue => {
  if (!_sortQueue) {
    _sortQueue = makeQueue("csv-sort");
  }
  return _sortQueue;
};

export const getCsvFilterQueue = (): Queue => {
  if (!_filterQueue) {
    _filterQueue = makeQueue("csv-filter");
  }
  return _filterQueue;
};

export const getCsvJoinQueue = (): Queue => {
  if (!_joinQueue) {
    _joinQueue = makeQueue("csv-join");
  }
  return _joinQueue;
};

export const getCsvConsecutiveSequenceQueue = (): Queue => {
  if (!_sequenceQueue) {
    _sequenceQueue = makeQueue("csv-consecutive-sequence");
  }
  return _sequenceQueue;
};

export const getCsvAggregateQueue = (): Queue => {
  if (!_aggregateQueue) {
    _aggregateQueue = makeQueue("csv-aggregate");
  }
  return _aggregateQueue;
};

export const getCsvColumnStatsQueue = (): Queue => {
  if (!_columnStatsQueue) {
    _columnStatsQueue = makeQueue("csv-column-stats");
  }
  return _columnStatsQueue;
};

export const getCsvCompareQueue = (): Queue => {
  if (!_compareQueue) {
    _compareQueue = makeQueue("csv-compare");
  }
  return _compareQueue;
};

export const getCsvDeduplicateQueue = (): Queue => {
  if (!_deduplicateQueue) {
    _deduplicateQueue = makeQueue("csv-deduplicate");
  }
  return _deduplicateQueue;
};

export const getCsvTransformQueue = (): Queue => {
  if (!_transformQueue) {
    _transformQueue = makeQueue("csv-transform");
  }
  return _transformQueue;
};
