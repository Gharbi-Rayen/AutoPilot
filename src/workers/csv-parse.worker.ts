import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { type Job, UnrecoverableError, Worker } from "bullmq";
import { parse } from "csv-parse";
import {
  clearCsvParseCancellation,
  isCsvParseCancellationRequested,
} from "@/features/executions/server/csv-parse-cancel";
import { inferDatasetSchema } from "@/features/executions/server/datasets/schema-inference";
import type { DatasetSchema } from "@/features/executions/server/datasets/schema-types";
import { inngest } from "@/inngest/client";

// ─── constants ───────────────────────────────────────────────────────────────
const CSV_SCHEMA_SAMPLE_ROWS = 100;
const CSV_WRITE_BATCH_SIZE = 25_000;
const HEAVY_CONCURRENCY = 2;
const QUEUE_NAME = "csv-parse";
const PARSE_PROGRESS_EVENT_NAME = "csv/parse.progress";

export interface CsvParseJobData {
  fileBlobPath: string;
  executionId: string;
  datasetId: string;
  variableName: string;
  ownerUserId?: string;
  delimiter?: string;
  hasHeader?: boolean;
  mode?: "full" | "metadata";
}

export interface CsvParseJobResult {
  rowCount: number;
  chunkCount: number;
  schema: DatasetSchema;
  headers?: string[];
  columnCount?: number;
  delimiter?: string;
  storage?: string;
  version?: number;
  manifestVersion?: number;
  byteSize?: number;
  datasetId?: string;
}

import Redis from "ioredis";

const workerConnection = new Redis(
  process.env.REDIS_URL ?? "redis://localhost:6379",
  { maxRetriesPerRequest: null },
);

interface ParseProgress {
  phase: "probing" | "parsing" | "flushing" | "done";
  rowsParsed: number;
  rowsFlushed: number;
  chunkCount: number;
  bytesRead: number;
  totalBytes: number;
  pct: number;
}

const emitParseStageProgress = async (
  job: Job<CsvParseJobData, CsvParseJobResult>,
  stage: string,
  details: Record<string, unknown>,
) => {
  try {
    await inngest.send({
      name: PARSE_PROGRESS_EVENT_NAME,
      data: {
        executionId: job.data.executionId,
        datasetId: job.data.datasetId,
        variableName: job.data.variableName,
        stage,
        ...details,
      },
    });
  } catch {
    // Best effort only.
  }
};

async function parseCsvJob(
  job: Job<CsvParseJobData, CsvParseJobResult>,
): Promise<CsvParseJobResult> {
  const { fileBlobPath, executionId, variableName } = job.data;
  const hasHeader = job.data.hasHeader ?? true;
  const parseMode = job.data.mode ?? "full";
  const jobId = String(job.id ?? "");

  let cancellationRequested = false;
  const cancellationPoller =
    jobId.length > 0
      ? setInterval(() => {
          void isCsvParseCancellationRequested(workerConnection, jobId)
            .then((isRequested) => {
              if (isRequested) {
                cancellationRequested = true;
              }
            })
            .catch(() => undefined);
        }, 350)
      : null;

  const cancellationError = () =>
    new UnrecoverableError("[csv-parse] Parse canceled by user.");

  const throwIfCanceled = () => {
    if (cancellationRequested) {
      throw cancellationError();
    }
  };

  const maybeDestroyForCancel = (
    parser: { destroy: (error?: Error) => void },
    stream?: { destroy: (error?: Error) => void },
  ) => {
    if (!cancellationRequested) {
      return false;
    }

    const err = cancellationError();
    parser.destroy(err);
    stream?.destroy(err);
    return true;
  };

  try {
    let totalBytes = 0;
    try {
      const fileStat = await stat(fileBlobPath);
      totalBytes = fileStat.size;
    } catch {
      throw new UnrecoverableError(
        `[csv-parse] File not found: ${fileBlobPath}`,
      );
    }

    const progress: ParseProgress = {
      phase: "probing",
      rowsParsed: 0,
      rowsFlushed: 0,
      chunkCount: 0,
      bytesRead: 0,
      totalBytes,
      pct: 0,
    };
    const report = async (patch: Partial<ParseProgress>) => {
      Object.assign(progress, patch);
      progress.pct =
        typeof patch.pct === "number"
          ? patch.pct
          : totalBytes > 0
            ? Math.min(99, Math.round((progress.bytesRead / totalBytes) * 100))
            : 0;
      await job.updateProgress(progress);
    };

    throwIfCanceled();
    await report({ phase: "probing" });

    const probeStartedAt = Date.now();
    const delimiter =
      job.data.delimiter || (await detectDelimiter(fileBlobPath));

    await emitParseStageProgress(job, "probe_done", {
      delimiter,
      elapsedMs: Date.now() - probeStartedAt,
    });

    if (parseMode === "full") {
      const parseStartedAt = Date.now();

      const { datasetService: ds } = await import(
        "@/features/executions/server/datasets/dataset-service"
      );
      const { coerceValueBySchema } = await import(
        "@/features/executions/server/datasets/schema-inference"
      );

      await report({ phase: "parsing", bytesRead: 0 });

      const fileStream = createReadStream(fileBlobPath, {
        highWaterMark: 64 * 1024,
      });
      const csvParser = parse({
        delimiter,
        relax_column_count: true,
        skip_empty_lines: true,
      });

      fileStream.on("data", (chunk: Buffer | string) => {
        progress.bytesRead += chunk.length;
        maybeDestroyForCancel(csvParser, fileStream);
      });

      fileStream.pipe(csvParser);

      let headers: string[] | null = null;
      let columnCount = 0;
      let schema: DatasetSchema | null = null;
      let session: Awaited<ReturnType<typeof ds.beginWrite>> | null = null;

      let rowCount = 0;
      let flushPromise = Promise.resolve();
      const pendingRows: Record<string, unknown>[] = [];
      const bufferedRecords: Array<Record<string, string>> = [];

      const appendTypedRecord = (record: Record<string, string>) => {
        if (!schema || !session) {
          return;
        }

        const typedRecord: Record<string, unknown> = {};
        for (const [column, value] of Object.entries(record)) {
          const fieldSchema = schema[column];
          typedRecord[column] = fieldSchema
            ? coerceValueBySchema(value, fieldSchema)
            : value;
        }

        pendingRows.push(typedRecord);
        rowCount += 1;

        if (pendingRows.length >= CSV_WRITE_BATCH_SIZE) {
          const batch = pendingRows.splice(0, CSV_WRITE_BATCH_SIZE);
          const activeSession = session;
          flushPromise = flushPromise.then(() =>
            ds.appendRows(activeSession, batch),
          );
          progress.rowsFlushed += batch.length;
          progress.chunkCount += 1;
        }

        if (rowCount % 1000 === 0) {
          void report({ rowsParsed: rowCount });
        }
      };

      const flushBufferedRecords = () => {
        for (const record of bufferedRecords) {
          appendTypedRecord(record);
        }
        bufferedRecords.length = 0;
      };

      try {
        for await (const rawRow of csvParser) {
          throwIfCanceled();

          if (!Array.isArray(rawRow)) {
            continue;
          }

          const row = rawRow.map((value) => String(value ?? ""));
          if (headers === null) {
            if (hasHeader) {
              headers = row.map((header, index) => {
                const trimmed = header.trim();
                return trimmed.length > 0 ? trimmed : `column_${index + 1}`;
              });
              columnCount = headers.length;
              continue;
            }

            headers = row.map((_, index) => `column_${index + 1}`);
            columnCount = headers.length;
          }

          const record: Record<string, string> = {};
          for (let index = 0; index < headers.length; index += 1) {
            record[headers[index]] = row[index] ?? "";
          }

          if (!schema) {
            bufferedRecords.push(record);

            if (bufferedRecords.length >= CSV_SCHEMA_SAMPLE_ROWS) {
              schema = inferDatasetSchema(bufferedRecords);
              session = await ds.beginWrite({
                executionId,
                variableName,
                chunkSize: CSV_WRITE_BATCH_SIZE,
                schema,
              });
              flushBufferedRecords();
            }

            continue;
          }

          appendTypedRecord(record);
        }

        throwIfCanceled();

        if (!headers || headers.length === 0) {
          throw new UnrecoverableError("[csv-parse] File appears to be empty.");
        }

        if (!schema) {
          schema = inferDatasetSchema(bufferedRecords);
          session = await ds.beginWrite({
            executionId,
            variableName,
            chunkSize: CSV_WRITE_BATCH_SIZE,
            schema,
          });
          flushBufferedRecords();
        }

        if (!session) {
          throw new UnrecoverableError(
            "[csv-parse] Failed to initialize dataset write session.",
          );
        }

        await flushPromise;
        throwIfCanceled();

        await report({
          phase: "flushing",
          rowsParsed: rowCount,
          rowsFlushed: progress.rowsFlushed,
          chunkCount: progress.chunkCount,
        });

        if (pendingRows.length > 0) {
          await ds.appendRows(session, pendingRows);
          progress.rowsFlushed += pendingRows.length;
          progress.chunkCount += 1;
          pendingRows.length = 0;
        }

        await emitParseStageProgress(job, "parse_done", {
          rowCount,
          columnCount,
          elapsedMs: Date.now() - parseStartedAt,
        });

        const manifest = await ds.commitWrite(session);
        await report({
          phase: "done",
          pct: 100,
          rowsParsed: rowCount,
          rowsFlushed: progress.rowsFlushed,
          chunkCount: progress.chunkCount,
        });

        await emitParseStageProgress(job, "persist_done", {
          rowCount,
          chunkCount: manifest.chunkCount,
          elapsedMs: Date.now() - parseStartedAt,
        });

        return {
          ...(manifest as unknown as CsvParseJobResult),
          headers,
          columnCount,
          delimiter,
        };
      } catch (error) {
        if (session) {
          await ds.abortWrite(session).catch(() => undefined);
        }

        throw error;
      }
    }

    const probeRows: string[][] = [];

    await new Promise<void>((resolve, reject) => {
      const probeStream = createReadStream(fileBlobPath, {
        highWaterMark: 64 * 1024,
      });
      const probeParser = parse({
        delimiter,
        relax_column_count: true,
        skip_empty_lines: true,
      });

      let settled = false;
      const safeResolve = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      const safeReject = (error: unknown) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      };

      probeStream.on("data", (chunk: Buffer | string) => {
        progress.bytesRead += chunk.length;
        maybeDestroyForCancel(probeParser, probeStream);
      });

      probeParser.on("readable", () => {
        let row = probeParser.read();
        while (row !== null) {
          if (maybeDestroyForCancel(probeParser, probeStream)) {
            return;
          }

          probeRows.push(row);
          if (
            probeRows.length >=
            CSV_SCHEMA_SAMPLE_ROWS + (hasHeader ? 1 : 0)
          ) {
            probeStream.destroy();
            probeParser.end();
            safeResolve();
            break;
          }
          row = probeParser.read();
        }
      });

      probeParser.on("end", safeResolve);
      probeParser.on("close", safeResolve);
      probeParser.on("error", safeReject);
      probeStream.on("error", safeReject);

      probeStream.pipe(probeParser);
    });

    throwIfCanceled();

    if (probeRows.length === 0)
      throw new UnrecoverableError("[csv-parse] File appears to be empty.");

    const headers = hasHeader
      ? probeRows[0]
      : probeRows[0].map((_, i) => `column_${i + 1}`);
    const dataRows = hasHeader ? probeRows.slice(1) : probeRows;

    const rawRecords = dataRows.map((row) => {
      const rec: Record<string, string> = {};
      for (let i = 0; i < headers.length; i++) rec[headers[i]] = row[i] || "";
      return rec;
    });

    const schema = inferDatasetSchema(rawRecords);
    const columnCount = headers.length;

    const { coerceValueBySchema } = await import(
      "@/features/executions/server/datasets/schema-inference"
    );

    await report({ phase: "parsing", bytesRead: 0 });
    const parseStartedAt = Date.now();

    if (parseMode === "metadata") {
      let rowCount = dataRows.length;

      await new Promise<void>((resolve, reject) => {
        const fileStream = createReadStream(fileBlobPath, {
          highWaterMark: 64 * 1024,
        });

        const csvParser = parse({
          delimiter,
          columns: hasHeader,
          ...(hasHeader ? {} : { columns: headers }),
          relax_column_count: true,
          skip_empty_lines: true,
          from_line: probeRows.length + 1,
          cast: (value, context) => {
            if (context.header) return value;
            const col =
              typeof context.column === "number"
                ? headers[context.column]
                : context.column;
            const fieldSchema = schema[col as string];
            return fieldSchema
              ? coerceValueBySchema(value, fieldSchema)
              : value;
          },
        });

        let settled = false;
        const safeResolve = () => {
          if (!settled) {
            settled = true;
            resolve();
          }
        };
        const safeReject = (error: unknown) => {
          if (!settled) {
            settled = true;
            reject(error);
          }
        };

        fileStream.on("data", (chunk: Buffer | string) => {
          progress.bytesRead += chunk.length;
          maybeDestroyForCancel(csvParser, fileStream);
        });

        csvParser.on("readable", () => {
          let row = csvParser.read();
          while (row !== null) {
            if (maybeDestroyForCancel(csvParser, fileStream)) {
              return;
            }

            rowCount += 1;
            if (rowCount % 1000 === 0) {
              void report({ rowsParsed: rowCount });
            }

            row = csvParser.read();
          }
        });

        csvParser.on("end", safeResolve);
        csvParser.on("error", safeReject);
        fileStream.on("error", safeReject);
        fileStream.pipe(csvParser);
      });

      throwIfCanceled();
      await report({ phase: "done", pct: 100, rowsParsed: rowCount });

      await emitParseStageProgress(job, "parse_done", {
        mode: "metadata",
        rowCount,
        columnCount,
        elapsedMs: Date.now() - parseStartedAt,
      });

      return {
        rowCount,
        chunkCount: 0,
        schema,
        headers,
        columnCount,
        delimiter,
      };
    }

    throw new UnrecoverableError(
      `[csv-parse] Unsupported parse mode: ${parseMode}`,
    );
  } finally {
    if (cancellationPoller) {
      clearInterval(cancellationPoller);
    }
  }
}

async function detectDelimiter(filePath: string): Promise<string> {
  const CANDIDATES = [",", "|"];
  const sample = await readFirstNLines(filePath, 25);
  let best = ",";
  let bestCount = 0;
  for (const delim of CANDIDATES) {
    const count = sample.split(delim).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = delim;
    }
  }
  return best;
}

async function readFirstNLines(filePath: string, n: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let lines = 0;
    const stream = createReadStream(filePath, {
      encoding: "utf8",
      highWaterMark: 4096,
    });
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

const worker = new Worker<CsvParseJobData, CsvParseJobResult>(
  QUEUE_NAME,
  async (job) => {
    console.log(
      `[csv-parse] ▶ job ${job.id} started — executionId=${job.data.executionId}`,
    );
    return parseCsvJob(job);
  },
  {
    connection: workerConnection,
    concurrency: HEAVY_CONCURRENCY,
    settings: {
      backoffStrategy: (attemptsMade) =>
        Math.min(1000 * 2 ** attemptsMade, 30_000),
    },
  },
);

worker.on("completed", async (job, result) => {
  const jobId = String(job.id ?? "");

  if (jobId.length > 0) {
    await clearCsvParseCancellation(workerConnection, jobId).catch(
      () => undefined,
    );
  }

  console.log(
    `[csv-parse] ✓ job ${job.id} complete — ${result.rowCount.toLocaleString()} rows`,
  );

  if (job.data.mode === "metadata") {
    return;
  }

  try {
    const manifest = result as unknown as Record<string, unknown>;
    const { chunks: _, ...manifestWithoutChunks } = manifest;
    await inngest.send({
      name: "csv/parse.complete",
      data: {
        executionId: job.data.executionId,
        datasetId: job.data.datasetId,
        variableName: job.data.variableName,
        result: manifestWithoutChunks,
      },
    });
  } catch (err) {
    console.error("Failed to signal inngest", err);
  }
});

worker.on("failed", async (job, err) => {
  const jobId = String(job?.id ?? "");

  if (jobId.length > 0) {
    await clearCsvParseCancellation(workerConnection, jobId).catch(
      () => undefined,
    );
  }

  const isUnrecoverable = err instanceof UnrecoverableError;
  console.error(`[csv-parse] ✗ job ${job?.id} failed:`, err.message);

  if (job?.data.mode === "metadata") {
    return;
  }

  if (
    isUnrecoverable ||
    (job && job.attemptsMade >= (job.opts.attempts ?? 3))
  ) {
    const failurePayload = {
      executionId: job?.data.executionId,
      datasetId: job?.data.datasetId,
      variableName: job?.data.variableName,
      error: err.message,
      reason: err.message,
      status: "failed" as const,
    };

    try {
      await inngest.send({
        name: "csv/parse.failed",
        data: failurePayload,
      });

      await inngest.send({
        name: "csv/parse.complete",
        data: failurePayload,
      });
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
process.on("SIGINT", () => shutdown("SIGINT"));
console.log(
  `[csv-parse] Worker online — queue="${QUEUE_NAME}" concurrency=${HEAVY_CONCURRENCY}`,
);
