import { Worker, Job, UnrecoverableError } from "bullmq";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { parse } from "csv-parse";

import { getRedisConnection } from "@/features/executions/server/redis-queue";
import { DatasetService } from "@/features/executions/server/datasets/dataset-service";
import { inferDatasetSchema } from "@/features/executions/server/datasets/schema-inference";
import { inngest } from "@/inngest/client";

// ─── constants ───────────────────────────────────────────────────────────────
const CSV_SCHEMA_SAMPLE_ROWS  = 100;
const CSV_WRITE_BATCH_SIZE    = 25_000;
const HEAVY_CONCURRENCY       = 2;
const QUEUE_NAME              = "csv-parse";

export interface CsvParseJobData {
  fileBlobPath: string;
  executionId:  string;
  datasetId:    string;
  variableName: string;
  delimiter?:   string;
  hasHeader?:   boolean;
}

export interface CsvParseJobResult {
  rowCount:   number;
  chunkCount: number;
  schema:     Record<string, { type: "string" | "number" | "boolean" | "date" }>;
}

interface ParseProgress {
  phase:       "probing" | "parsing" | "flushing" | "done";
  rowsParsed:  number;
  rowsFlushed: number;
  chunkCount:  number;
  bytesRead:   number;
  totalBytes:  number;
  pct:         number;
}

async function parseCsvJob(job: Job<CsvParseJobData, CsvParseJobResult>): Promise<CsvParseJobResult> {
  const { fileBlobPath, executionId, datasetId, variableName } = job.data;
  const hasHeader = job.data.hasHeader ?? true;

  let totalBytes = 0;
  try {
    const fileStat = await stat(fileBlobPath);
    totalBytes = fileStat.size;
  } catch {
    throw new UnrecoverableError(`[csv-parse] File not found: ${fileBlobPath}`);
  }

  const progress: ParseProgress = { phase: "probing", rowsParsed: 0, rowsFlushed: 0, chunkCount: 0, bytesRead: 0, totalBytes, pct: 0 };
  const report = async (patch: Partial<ParseProgress>) => {
    Object.assign(progress, patch);
    progress.pct = totalBytes > 0 ? Math.min(99, Math.round((progress.bytesRead / totalBytes) * 100)) : 0;
    await job.updateProgress(progress);
  };
  await report({ phase: "probing" });

  const delimiter = job.data.delimiter || await detectDelimiter(fileBlobPath);
  const probeRows: string[][] = [];

  await new Promise<void>((resolve, reject) => {
    const probeStream = createReadStream(fileBlobPath, { highWaterMark: 64 * 1024 });
    const probeParser = parse({ delimiter, relax_column_count: true, skip_empty_lines: true });
    
    probeStream.on("data", (chunk: Buffer | string) => { progress.bytesRead += chunk.length; });
    probeParser.on("readable", () => {
      let row;
      while ((row = probeParser.read()) !== null) {
        probeRows.push(row);
        if (probeRows.length >= CSV_SCHEMA_SAMPLE_ROWS + (hasHeader ? 1 : 0)) {
          probeParser.end(); // triggers 'close' implicitly if cleanly stopped, but 'resolve' needs explicit call
          resolve(); 
          break; 
        }
      }
    });

    probeParser.on("end", resolve);
    probeParser.on("close", resolve);
    probeParser.on("error", reject);
    probeStream.on("error", reject);

    probeStream.pipe(probeParser);
  });

  if (probeRows.length === 0) throw new UnrecoverableError("[csv-parse] File appears to be empty.");

  const headers = hasHeader ? probeRows[0] : probeRows[0].map((_, i) => `column_${i + 1}`);
  const dataRows = hasHeader ? probeRows.slice(1) : probeRows;

  // We need to shape this to what inferDatasetSchema expects: array of objects
  const rawRecords = dataRows.map(row => {
    const rec: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) rec[headers[i]] = row[i] || "";
    return rec;
  });

  const schema = inferDatasetSchema(rawRecords);
  await report({ phase: "parsing", bytesRead: 0 });

  // For the final DatasetService, we will bypass standard beginWrite in favor of using internal classes directly, 
  // or we can just use beginWrite. But datasetService requires variableName etc. Let's recreate logic:
  
  // Wait, datasetService.beginWrite does a bunch of persistence. We can just call the actual datasetService!
  const { datasetService: ds } = await import("@/features/executions/server/datasets/dataset-service");
  
  const session = await ds.beginWrite({
    executionId,
    variableName,
    chunkSize: CSV_WRITE_BATCH_SIZE,
    schema
  });

  let pendingRows: Record<string, unknown>[] = [];
  let rowCount = 0;
  let flushPromise = Promise.resolve();

  // Re-coerce probe rows
  const { coerceValueBySchema } = await import("@/features/executions/server/datasets/schema-inference");
  
  const coerceRow = (rowDict: Record<string, unknown>) => {
    const coerced: Record<string, unknown> = {};
    for (const [col, val] of Object.entries(rowDict)) {
      const fieldSchema = schema[col];
      coerced[col] = fieldSchema ? coerceValueBySchema(val, fieldSchema) : val;
    }
    return coerced;
  }

  const coercedProbeRows = rawRecords.map(coerceRow);
  pendingRows.push(...coercedProbeRows);
  rowCount += coercedProbeRows.length;

  await new Promise<void>((resolve, reject) => {
    const fileStream = createReadStream(fileBlobPath, { highWaterMark: 64 * 1024 });
    const csvParser = parse({
      delimiter,
      columns: hasHeader, // if no header, we need to map to headers later, but csv-parse handles columns: headersArray 
      // wait, if no headers, we can pass columns: headers
      ...(hasHeader ? {} : { columns: headers }),
      relax_column_count: true,
      skip_empty_lines: true,
      from_line: probeRows.length + 1, 
      cast: (value, context) => {
        if (context.header) return value;
        const col = typeof context.column === "number" ? headers[context.column] : context.column;
        const fieldSchema = schema[col as string];
        return fieldSchema ? coerceValueBySchema(value, fieldSchema) : value;
      }
    });

    fileStream.on("data", (chunk: Buffer | string) => { progress.bytesRead += chunk.length; });
    
    csvParser.on("readable", () => {
      let row;
      while ((row = csvParser.read()) !== null) {
        pendingRows.push(row);
        rowCount++;
        
        if (pendingRows.length >= CSV_WRITE_BATCH_SIZE) {
          const batch = pendingRows.splice(0, CSV_WRITE_BATCH_SIZE);
          flushPromise = flushPromise.then(() => ds.appendRows(session, batch));
          progress.rowsFlushed += batch.length;
          progress.chunkCount++;
          report({ rowsParsed: rowCount }); // fire and forget
        }
      }
    });

    csvParser.on("end", resolve);
    csvParser.on("error", reject);
    fileStream.on("error", reject);
    fileStream.pipe(csvParser);
  });

  await flushPromise;
  
  if (pendingRows.length > 0) {
    await ds.appendRows(session, pendingRows);
    progress.rowsFlushed += pendingRows.length;
    progress.chunkCount++;
  }

  const manifest = await ds.commitWrite(session);
  await report({ phase: "done", pct: 100, rowsParsed: rowCount });

  return manifest as any;
}

async function detectDelimiter(filePath: string): Promise<string> {
  const CANDIDATES = [",", ";", "\t", "|"];
  const sample = await readFirstNLines(filePath, 25);
  let best = ",";
  let bestCount = 0;
  for (const delim of CANDIDATES) {
    const count = sample.split(delim).length - 1;
    if (count > bestCount) { bestCount = count; best = delim; }
  }
  return best;
}

async function readFirstNLines(filePath: string, n: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let lines = 0;
    const stream = createReadStream(filePath, { encoding: "utf8", highWaterMark: 4096 });
    stream.on("data", (chunk: string | Buffer) => {
      chunks.push(Buffer.from(chunk));
      lines += (chunk.toString().match(/\n/g) || []).length;
      if (lines >= n) {
        stream.destroy();
        resolve(Buffer.concat(chunks).toString("utf8"));
      }
    });
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", reject);
  });
}

const connection = getRedisConnection();

const worker = new Worker<CsvParseJobData, CsvParseJobResult>(
  QUEUE_NAME,
  async (job) => {
    console.log(`[csv-parse] ▶ job ${job.id} started — executionId=${job.data.executionId}`);
    return parseCsvJob(job);
  },
  {
    connection,
    concurrency: HEAVY_CONCURRENCY,
    settings: { backoffStrategy: (attemptsMade) => Math.min(1000 * 2 ** attemptsMade, 30_000) },
  },
);

worker.on("completed", async (job, result) => {
  console.log(`[csv-parse] ✓ job ${job.id} complete — ${result.rowCount.toLocaleString()} rows`);
  try {
    const { chunks, ...manifestWithoutChunks } = result as any;
    await inngest.send({ name: "csv/parse.complete", data: { executionId: job.data.executionId, datasetId: job.data.datasetId, variableName: job.data.variableName, result: manifestWithoutChunks } });
  } catch (err) {
    console.error("Failed to signal inngest", err);
  }
});

worker.on("failed", async (job, err) => {
  const isUnrecoverable = err instanceof UnrecoverableError;
  console.error(`[csv-parse] ✗ job ${job?.id} failed:`, err.message);
  if (isUnrecoverable || (job && job.attemptsMade >= (job.opts.attempts ?? 3))) {
    try {
      await inngest.send({ name: "csv/parse.failed", data: { executionId: job?.data.executionId, error: err.message } });
    } catch {}
  }
});

const shutdown = async (signal: string) => {
  console.log(`[csv-parse] ${signal} received — draining worker...`);
  await worker.close();
  // await connection.quit();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
console.log(`[csv-parse] Worker online — queue="${QUEUE_NAME}" concurrency=${HEAVY_CONCURRENCY}`);
