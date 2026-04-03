import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { PerformanceObserver, performance } from "node:perf_hooks";
import { DATASET_STORAGE, EXECUTION_LIMITS } from "../../src/config/constants";
import { datasetService } from "../../src/features/executions/server/datasets/dataset-service";

const TARGET_SIZES_MB = [100, 250, 400] as const;

type BenchResult = {
  targetSizeMb: number;
  generatedRows: number;
  generatedBytes: number;
  writeDurationMs: number;
  readDurationMs: number;
  cpuTimeMs: number;
  gcPauseMs: number;
  diskIOMs: number;
  peakRssBytes: number;
  chunkCount: number;
};

const rowTemplate = (index: number) => {
  return {
    id: index,
    name: `row-${index.toString().padStart(8, "0")}`,
    category: index % 7,
    amount: Number((index * 1.13).toFixed(4)),
    createdAt: new Date(1700000000000 + index * 1000).toISOString(),
    active: index % 2 === 0,
  };
};

const estimateByteLength = (value: unknown) => {
  return Buffer.byteLength(JSON.stringify(value));
};

const generateRows = function* (targetBytes: number) {
  let generatedBytes = 0;
  let generatedRows = 0;

  while (generatedBytes < targetBytes) {
    const row = rowTemplate(generatedRows + 1);
    generatedBytes += estimateByteLength(row) + 1;
    generatedRows += 1;
    yield row;
  }

  return {
    generatedRows,
    generatedBytes,
  };
};

const runBenchmark = async (targetSizeMb: number): Promise<BenchResult> => {
  const executionId = `bench-${targetSizeMb}mb-${randomUUID()}`;
  const variableName = `dataset_${targetSizeMb}mb`;
  const targetBytes = targetSizeMb * 1024 * 1024;

  const cpuStart = process.cpuUsage();
  const rssStart = process.memoryUsage().rss;
  let peakRss = rssStart;
  let gcPauseMs = 0;

  const gcObserver = new PerformanceObserver((entries) => {
    for (const entry of entries.getEntries()) {
      gcPauseMs += entry.duration;
    }
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  });

  try {
    gcObserver.observe({ entryTypes: ["gc"], buffered: false });
  } catch {
    // gc observer not available in some runtimes.
  }

  let generatedRows = 0;
  let generatedBytes = 0;

  const sourceRows = (async function* () {
    for (const row of generateRows(targetBytes)) {
      generatedRows += 1;
      generatedBytes += estimateByteLength(row) + 1;
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
      yield row;
    }
  })();

  const writeStart = performance.now();
  const manifest = await datasetService.persistRowsFromStream({
    executionId,
    variableName,
    rows: sourceRows,
    chunkSize: EXECUTION_LIMITS.DEFAULT_BATCH_SIZE,
  });
  const writeDurationMs = Math.max(performance.now() - writeStart, 0);

  const readStart = performance.now();
  let streamedRows = 0;
  for await (const _row of datasetService.streamDatasetRows(
    executionId,
    manifest.datasetId,
  )) {
    streamedRows += 1;
    if (streamedRows % 1000 === 0) {
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
    }
  }
  const readDurationMs = Math.max(performance.now() - readStart, 0);

  const cpuUsage = process.cpuUsage(cpuStart);
  const cpuTimeMs = Math.max((cpuUsage.user + cpuUsage.system) / 1000, 0);
  const diskIOMs = Math.max(
    writeDurationMs + readDurationMs - cpuTimeMs - gcPauseMs,
    0,
  );

  await rm(join(DATASET_STORAGE.ROOT_DIRECTORY, executionId), {
    recursive: true,
    force: true,
  });

  return {
    targetSizeMb,
    generatedRows,
    generatedBytes,
    writeDurationMs,
    readDurationMs,
    cpuTimeMs,
    gcPauseMs,
    diskIOMs,
    peakRssBytes: peakRss,
    chunkCount: manifest.chunkCount,
  };
};

const main = async () => {
  const startedAt = new Date().toISOString();
  const results: BenchResult[] = [];

  for (const size of TARGET_SIZES_MB) {
    console.log(`\n[benchmark] running ${size} MB profile...`);
    const result = await runBenchmark(size);
    results.push(result);

    console.log(
      JSON.stringify(
        {
          targetSizeMb: result.targetSizeMb,
          generatedRows: result.generatedRows,
          generatedBytes: result.generatedBytes,
          chunkCount: result.chunkCount,
          writeDurationMs: Number(result.writeDurationMs.toFixed(2)),
          readDurationMs: Number(result.readDurationMs.toFixed(2)),
          cpuTimeMs: Number(result.cpuTimeMs.toFixed(2)),
          gcPauseMs: Number(result.gcPauseMs.toFixed(2)),
          diskIOMs: Number(result.diskIOMs.toFixed(2)),
          peakRssMb: Number((result.peakRssBytes / (1024 * 1024)).toFixed(2)),
        },
        null,
        2,
      ),
    );
  }

  const endedAt = new Date().toISOString();
  const summary = {
    startedAt,
    endedAt,
    results,
  };

  console.log("\n[benchmark] summary");
  console.log(JSON.stringify(summary, null, 2));
};

main().catch((error) => {
  console.error("[benchmark] failed", error);
  process.exitCode = 1;
});
