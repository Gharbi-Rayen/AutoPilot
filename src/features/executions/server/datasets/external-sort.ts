import { once } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { AsyncOrSyncIterable } from "./async-batch-iterator";
import { throwIfAborted, toAsyncIterable } from "./async-batch-iterator";
import type { TempFileManager } from "./temp-file-manager";

type SortableEntry<T> = {
  seq: number;
  row: T;
};

interface ExternalSortOptions<T> {
  source: AsyncOrSyncIterable<T>;
  compareRows: (left: T, right: T) => number;
  tempManager: TempFileManager;
  runTargetBytes: number;
  mergeFanIn: number;
  signal?: AbortSignal;
}

interface ExternalSortResult<T> {
  runCount: number;
  rows: AsyncGenerator<T, void, void>;
}

const writeLine = async (
  stream: ReturnType<typeof createWriteStream>,
  line: string,
) => {
  if (!stream.write(line)) {
    await once(stream, "drain");
  }
};

const compareEntries = <T>(
  left: SortableEntry<T>,
  right: SortableEntry<T>,
  compareRows: (left: T, right: T) => number,
) => {
  const rawComparison = compareRows(left.row, right.row);
  const rowComparison = Number.isFinite(rawComparison)
    ? rawComparison > 0
      ? 1
      : rawComparison < 0
        ? -1
        : 0
    : 0;

  if (rowComparison !== 0) {
    return rowComparison;
  }

  return left.seq - right.seq;
};

const writeRunEntries = async <T>(
  filePath: string,
  entries: SortableEntry<T>[],
): Promise<void> => {
  const stream = createWriteStream(filePath, {
    encoding: "utf-8",
  });

  try {
    for (const entry of entries) {
      await writeLine(stream, `${entry.seq}\t${JSON.stringify(entry.row)}\n`);
    }
  } finally {
    stream.end();
    await once(stream, "close");
  }
};

const readRunEntries = async function* <T>(
  filePath: string,
): AsyncGenerator<SortableEntry<T>, void, void> {
  const stream = createReadStream(filePath, {
    encoding: "utf-8",
  });
  const lineReader = createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  for await (const line of lineReader) {
    if (!line.trim()) {
      continue;
    }

    const separatorIndex = line.indexOf("\t");
    if (separatorIndex <= 0) {
      throw new Error("Malformed external-sort run line: missing tab separator");
    }

    const seq = Number(line.slice(0, separatorIndex));
    if (!Number.isFinite(seq)) {
      throw new Error("Malformed external-sort run line: invalid sequence number");
    }

    const row = JSON.parse(line.slice(separatorIndex + 1)) as T;
    yield {
      seq,
      row,
    };
  }
};

const mergeRunGroup = async <T>({
  runPaths,
  outputPath,
  compareRows,
  signal,
}: {
  runPaths: string[];
  outputPath: string;
  compareRows: (left: T, right: T) => number;
  signal?: AbortSignal;
}) => {
  const iterators = runPaths.map((runPath) =>
    readRunEntries<T>(runPath)[Symbol.asyncIterator](),
  );
  const heads = await Promise.all(iterators.map((iterator) => iterator.next()));

  const outputStream = createWriteStream(outputPath, {
    encoding: "utf-8",
  });

  try {
    while (true) {
      throwIfAborted(signal);

      let selectedIndex = -1;
      let selectedEntry: SortableEntry<T> | null = null;

      for (let index = 0; index < heads.length; index += 1) {
        const current = heads[index];
        if (current?.done || !current.value) {
          continue;
        }

        if (
          selectedEntry === null ||
          compareEntries(current.value, selectedEntry, compareRows) < 0
        ) {
          selectedEntry = current.value;
          selectedIndex = index;
        }
      }

      if (selectedIndex === -1 || selectedEntry === null) {
        break;
      }

      await writeLine(
        outputStream,
        `${selectedEntry.seq}\t${JSON.stringify(selectedEntry.row)}\n`,
      );
      heads[selectedIndex] = await iterators[selectedIndex].next();
    }
  } finally {
    outputStream.end();
    await once(outputStream, "close");
  }
};

const buildInitialRuns = async <T>({
  source,
  compareRows,
  tempManager,
  runTargetBytes,
  signal,
}: {
  source: AsyncOrSyncIterable<T>;
  compareRows: (left: T, right: T) => number;
  tempManager: TempFileManager;
  runTargetBytes: number;
  signal?: AbortSignal;
}): Promise<string[]> => {
  const safeRunTargetBytes = Math.max(runTargetBytes, 1024 * 1024);

  const runPaths: string[] = [];
  let currentRun: SortableEntry<T>[] = [];
  let currentRunBytes = 0;
  let sequence = 0;

  const flushRun = async () => {
    if (currentRun.length === 0) {
      return;
    }

    currentRun.sort((left, right) => compareEntries(left, right, compareRows));

    const runPath = await tempManager.createTempFilePath("sort-run");
    await writeRunEntries(runPath, currentRun);

    runPaths.push(runPath);
    currentRun = [];
    currentRunBytes = 0;
  };

  for await (const row of toAsyncIterable(source, signal)) {
    throwIfAborted(signal);

    const entry: SortableEntry<T> = {
      seq: sequence,
      row,
    };

    sequence += 1;
    currentRun.push(entry);
    currentRunBytes += Buffer.byteLength(JSON.stringify(entry));

    if (currentRunBytes >= safeRunTargetBytes) {
      await flushRun();
    }
  }

  await flushRun();

  if (runPaths.length === 0) {
    const emptyRunPath = await tempManager.createTempFilePath("sort-empty");
    await writeRunEntries(emptyRunPath, []);
    runPaths.push(emptyRunPath);
  }

  return runPaths;
};

const mergeRuns = async <T>({
  runPaths,
  compareRows,
  mergeFanIn,
  tempManager,
  signal,
}: {
  runPaths: string[];
  compareRows: (left: T, right: T) => number;
  mergeFanIn: number;
  tempManager: TempFileManager;
  signal?: AbortSignal;
}): Promise<string> => {
  const safeFanIn = Math.max(2, mergeFanIn);
  let activeRuns = [...runPaths];

  while (activeRuns.length > 1) {
    const mergedRuns: string[] = [];

    for (let index = 0; index < activeRuns.length; index += safeFanIn) {
      throwIfAborted(signal);

      const group = activeRuns.slice(index, index + safeFanIn);
      if (group.length === 1) {
        mergedRuns.push(group[0]);
        continue;
      }

      const mergedRunPath = await tempManager.createTempFilePath("sort-merge");
      await mergeRunGroup({
        runPaths: group,
        outputPath: mergedRunPath,
        compareRows,
        signal,
      });

      for (const consumedRunPath of group) {
        await tempManager.removeFile(consumedRunPath);
      }

      mergedRuns.push(mergedRunPath);
    }

    activeRuns = mergedRuns;
  }

  const [finalRunPath] = activeRuns;
  if (!finalRunPath) {
    throw new Error("External sort failed to produce a final run");
  }

  return finalRunPath;
};

export const externalSortRows = async <T>(
  options: ExternalSortOptions<T>,
): Promise<ExternalSortResult<T>> => {
  const runPaths = await buildInitialRuns({
    source: options.source,
    compareRows: options.compareRows,
    tempManager: options.tempManager,
    runTargetBytes: options.runTargetBytes,
    signal: options.signal,
  });

  const runCount = runPaths.length;

  try {
    const finalRunPath = await mergeRuns({
      runPaths,
      compareRows: options.compareRows,
      mergeFanIn: options.mergeFanIn,
      tempManager: options.tempManager,
      signal: options.signal,
    });

    return {
      runCount,
      rows: (async function* () {
        try {
          for await (const entry of readRunEntries<T>(finalRunPath)) {
            throwIfAborted(options.signal);
            yield entry.row;
          }
        } finally {
          await options.tempManager.cleanup();
        }
      })(),
    };
  } catch (error) {
    await options.tempManager.cleanup();
    throw error;
  }
};

export const readSortedRunRowCount = async (
  runPath: string,
): Promise<number> => {
  const content = await readFile(runPath, "utf-8");
  if (!content.trim()) {
    return 0;
  }

  return content.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
};
