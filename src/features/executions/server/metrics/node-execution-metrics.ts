import { PerformanceObserver, performance } from "node:perf_hooks";
import { EXECUTION_LIMITS } from "@/config/constants";

export interface NodeExecutionMetric {
  nodeId: string;
  nodeType: string;
  durationMs: number;
  rowsIn: number;
  rowsOut: number;
  bytesIn: number;
  bytesOut: number;
  cpuTimeMs: number;
  gcPauseMs: number;
  diskIOMs: number;
  memoryRssStartBytes: number;
  memoryRssEndBytes: number;
  memoryRssPeakBytes: number;
}

export interface NodeExecutionTypeAggregate {
  nodeType: string;
  count: number;
  durationMs: number;
  cpuTimeMs: number;
  gcPauseMs: number;
  diskIOMs: number;
}

export interface NodeExecutionPerformanceSummary {
  totals: {
    nodeCount: number;
    durationMs: number;
    cpuTimeMs: number;
    gcPauseMs: number;
    diskIOMs: number;
    rowsIn: number;
    rowsOut: number;
    bytesIn: number;
    bytesOut: number;
    peakNodeMemoryRssBytes: number;
  };
  bottleneck: {
    dominant: "cpu" | "disk" | "gc" | "mixed";
    cpuShare: number;
    diskShare: number;
    gcShare: number;
  };
  byNodeType: NodeExecutionTypeAggregate[];
  topSlowNodes: Array<
    Pick<
      NodeExecutionMetric,
      | "nodeId"
      | "nodeType"
      | "durationMs"
      | "cpuTimeMs"
      | "gcPauseMs"
      | "diskIOMs"
    >
  >;
}

interface NodeMetricCapture {
  startedAt: number;
  startCpu: NodeJS.CpuUsage;
  startMemoryRssBytes: number;
  gcPauseMs: number;
  gcObserver: PerformanceObserver | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isDatasetReference = (value: Record<string, unknown>): boolean => {
  return (
    value.kind === "dataset" &&
    typeof value.datasetId === "string" &&
    typeof value.executionId === "string"
  );
};

const estimateRowCount = (value: unknown): number => {
  if (Array.isArray(value)) {
    return value.length;
  }

  if (!isRecord(value)) {
    return 0;
  }

  if (typeof value.rowCount === "number" && Number.isFinite(value.rowCount)) {
    return Math.max(0, value.rowCount);
  }

  if (Array.isArray(value.records)) {
    return value.records.length;
  }

  if (value.kind === "dataset" && typeof value.rowCount === "number") {
    return Math.max(0, value.rowCount);
  }

  return Object.values(value as Record<string, unknown>).reduce<number>(
    (total, item) => {
      return total + estimateRowCount(item);
    },
    0,
  );
};

const estimateInMemoryRowCount = (value: unknown): number => {
  if (Array.isArray(value)) {
    return value.length;
  }

  if (!isRecord(value)) {
    return 0;
  }

  if (isDatasetReference(value)) {
    // Dataset references point to persisted storage and should not count as
    // in-memory rows for MAX_IN_MEMORY_ROWS enforcement.
    return 0;
  }

  if (Array.isArray(value.records)) {
    return value.records.length;
  }

  if (Array.isArray(value.preview)) {
    return value.preview.length;
  }

  return Object.entries(value).reduce<number>((total, [key, item]) => {
    if (key === "rowCount") {
      return total;
    }

    return total + estimateInMemoryRowCount(item);
  }, 0);
};

const estimateBytes = (value: unknown): number => {
  try {
    return Buffer.byteLength(JSON.stringify(value));
  } catch {
    return 0;
  }
};

export const startNodeMetricCapture = (): NodeMetricCapture => {
  const capture: NodeMetricCapture = {
    startedAt: performance.now(),
    startCpu: process.cpuUsage(),
    startMemoryRssBytes: process.memoryUsage().rss,
    gcPauseMs: 0,
    gcObserver: null,
  };

  try {
    const gcObserver = new PerformanceObserver((entries) => {
      for (const entry of entries.getEntries()) {
        capture.gcPauseMs += entry.duration;
      }
    });

    gcObserver.observe({
      entryTypes: ["gc"],
      buffered: false,
    });
    capture.gcObserver = gcObserver;
  } catch {
    capture.gcObserver = null;
  }

  return capture;
};

export const finishNodeMetricCapture = ({
  capture,
  nodeId,
  nodeType,
  input,
  output,
}: {
  capture: NodeMetricCapture;
  nodeId: string;
  nodeType: string;
  input: unknown;
  output: unknown;
}): NodeExecutionMetric => {
  capture.gcObserver?.disconnect();

  const durationMs = Math.max(performance.now() - capture.startedAt, 0);
  const cpuUsage = process.cpuUsage(capture.startCpu);
  const cpuTimeMs = Math.max((cpuUsage.user + cpuUsage.system) / 1000, 0);
  const endMemoryRssBytes = process.memoryUsage().rss;
  const memoryRssPeakBytes = Math.max(
    capture.startMemoryRssBytes,
    endMemoryRssBytes,
  );

  const rowsIn = estimateRowCount(input);
  const rowsOut = estimateRowCount(output);
  const inMemoryRowsOut = estimateInMemoryRowCount(output);
  const bytesIn = estimateBytes(input);
  const bytesOut = estimateBytes(output);
  const gcPauseMs = capture.gcPauseMs;
  const diskIOMs = Math.max(durationMs - cpuTimeMs - gcPauseMs, 0);

  if (inMemoryRowsOut > EXECUTION_LIMITS.MAX_IN_MEMORY_ROWS) {
    throw new Error(
      `Node '${nodeId}' exceeded MAX_IN_MEMORY_ROWS (${EXECUTION_LIMITS.MAX_IN_MEMORY_ROWS}). Output rows: ${inMemoryRowsOut}.`,
    );
  }

  return {
    nodeId,
    nodeType,
    durationMs,
    rowsIn,
    rowsOut,
    bytesIn,
    bytesOut,
    cpuTimeMs,
    gcPauseMs,
    diskIOMs,
    memoryRssStartBytes: capture.startMemoryRssBytes,
    memoryRssEndBytes: endMemoryRssBytes,
    memoryRssPeakBytes,
  };
};

const toShare = (value: number, total: number): number => {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(1, value / total));
};

const detectDominantBottleneck = ({
  cpuShare,
  diskShare,
  gcShare,
}: {
  cpuShare: number;
  diskShare: number;
  gcShare: number;
}): "cpu" | "disk" | "gc" | "mixed" => {
  const ranked = [
    ["cpu", cpuShare] as const,
    ["disk", diskShare] as const,
    ["gc", gcShare] as const,
  ].sort((left, right) => right[1] - left[1]);

  const top = ranked[0];
  const second = ranked[1];

  if (!top || top[1] < 0.4) {
    return "mixed";
  }

  if (second && top[1] - second[1] < 0.1) {
    return "mixed";
  }

  return top[0];
};

export const summarizeNodeExecutionMetrics = (
  metrics: NodeExecutionMetric[],
): NodeExecutionPerformanceSummary => {
  const totals = metrics.reduce(
    (acc, metric) => {
      acc.nodeCount += 1;
      acc.durationMs += metric.durationMs;
      acc.cpuTimeMs += metric.cpuTimeMs;
      acc.gcPauseMs += metric.gcPauseMs;
      acc.diskIOMs += metric.diskIOMs;
      acc.rowsIn += metric.rowsIn;
      acc.rowsOut += metric.rowsOut;
      acc.bytesIn += metric.bytesIn;
      acc.bytesOut += metric.bytesOut;
      acc.peakNodeMemoryRssBytes = Math.max(
        acc.peakNodeMemoryRssBytes,
        metric.memoryRssPeakBytes,
      );
      return acc;
    },
    {
      nodeCount: 0,
      durationMs: 0,
      cpuTimeMs: 0,
      gcPauseMs: 0,
      diskIOMs: 0,
      rowsIn: 0,
      rowsOut: 0,
      bytesIn: 0,
      bytesOut: 0,
      peakNodeMemoryRssBytes: 0,
    },
  );

  const cpuShare = toShare(totals.cpuTimeMs, totals.durationMs);
  const diskShare = toShare(totals.diskIOMs, totals.durationMs);
  const gcShare = toShare(totals.gcPauseMs, totals.durationMs);

  const byTypeMap = new Map<string, NodeExecutionTypeAggregate>();
  for (const metric of metrics) {
    const existing = byTypeMap.get(metric.nodeType) ?? {
      nodeType: metric.nodeType,
      count: 0,
      durationMs: 0,
      cpuTimeMs: 0,
      gcPauseMs: 0,
      diskIOMs: 0,
    };

    existing.count += 1;
    existing.durationMs += metric.durationMs;
    existing.cpuTimeMs += metric.cpuTimeMs;
    existing.gcPauseMs += metric.gcPauseMs;
    existing.diskIOMs += metric.diskIOMs;
    byTypeMap.set(metric.nodeType, existing);
  }

  const byNodeType = Array.from(byTypeMap.values()).sort(
    (left, right) => right.durationMs - left.durationMs,
  );

  const topSlowNodes = [...metrics]
    .sort((left, right) => right.durationMs - left.durationMs)
    .slice(0, 5)
    .map((metric) => ({
      nodeId: metric.nodeId,
      nodeType: metric.nodeType,
      durationMs: metric.durationMs,
      cpuTimeMs: metric.cpuTimeMs,
      gcPauseMs: metric.gcPauseMs,
      diskIOMs: metric.diskIOMs,
    }));

  return {
    totals,
    bottleneck: {
      dominant: detectDominantBottleneck({
        cpuShare,
        diskShare,
        gcShare,
      }),
      cpuShare,
      diskShare,
      gcShare,
    },
    byNodeType,
    topSlowNodes,
  };
};
