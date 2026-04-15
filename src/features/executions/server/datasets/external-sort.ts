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
  // Cached JSON string for `row`. Carried through merge so we never
  // re-serialize a row that was already serialised during ingestion.
  _json: string;
  // Precomputed sort key. When set, merge passes use key comparison instead
  // of re-running the full row comparator on parsed JSON objects.
  _key?: number | string | null;
  // Raw encoded key string as it appears in the run file (e.g. "n123.456").
  // Carried through merge so we skip encodeKey() on every write — the string
  // is already in the right format and just needs to be spliced back in.
  _rawEncodedKey?: string;
};

interface ExternalSortOptions<T> {
  source: AsyncOrSyncIterable<T>;
  compareRows: (left: T, right: T) => number;
  tempManager: TempFileManager;
  runTargetBytes: number;
  mergeFanIn: number;
  signal?: AbortSignal;
  /**
   * Optional key extractor — computed once per row during ingestion.
   * When paired with `compareKeys`, run sorts and k-way merges operate on
   * the precomputed key instead of calling `compareRows` on full row objects,
   * which avoids repeated type coercion and object allocation.
   */
  extractKey?: (row: T) => number | string | null;
  /**
   * Fast comparator for precomputed keys. Must handle `null` keys (nulls
   * positioning) and apply direction. Receives both keys and their original
   * sequence numbers (for stability tiebreaking).
   */
  compareKeys?: (
    aKey: number | string | null,
    bKey: number | string | null,
    aSeq: number,
    bSeq: number,
  ) => number;
}

interface ExternalSortResult<T> {
  runCount: number;
  rows: AsyncGenerator<T, void, void>;
}

// 4 MB write buffer – batches many rows into one write() call instead of
// one syscall per row.  Larger buffer = fewer syscalls on large datasets.
const WRITE_BUFFER_SIZE = 4 * 1024 * 1024;
// 4 MB readline input buffer – reduces the number of read() syscalls.
const READ_HIGH_WATER_MARK = 4 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Key encoding for run files.
// When a precomputed key is stored, the run line format is:
//   <seq>\t<encodedKey>\t<json>\n
// Without a key the legacy format is:
//   <seq>\t<json>\n
//
// Encoding:
//   null  → "_"
//   number → "n" + String(n)   (handles Infinity / -Infinity / NaN round-trips)
//   string → "s" + encodeURIComponent(s)  (safe against tab / newline)
// ---------------------------------------------------------------------------

const encodeKey = (key: number | string | null): string => {
  if (key === null) return "_";
  if (typeof key === "number") return `n${key}`;
  return `s${encodeURIComponent(key)}`;
};

const decodeKey = (encoded: string): number | string | null => {
  if (encoded === "_") return null;
  if (encoded.charCodeAt(0) === 110 /* 'n' */) return Number(encoded.slice(1));
  return decodeURIComponent(encoded.slice(1));
};

// ---------------------------------------------------------------------------
// Min-heap for k-way merge.  O(log k) per extracted element vs. O(k) linear
// scan. The benefit is modest at fan-in = 8 but pays off at larger fan-ins.
// ---------------------------------------------------------------------------
type HeapItem<T> = { entry: SortableEntry<T>; streamIndex: number };

class MinHeap<T> {
  private readonly items: HeapItem<T>[] = [];
  private readonly cmp: (a: HeapItem<T>, b: HeapItem<T>) => number;

  constructor(cmp: (a: HeapItem<T>, b: HeapItem<T>) => number) {
    this.cmp = cmp;
  }

  get size(): number {
    return this.items.length;
  }

  push(item: HeapItem<T>): void {
    this.items.push(item);
    this.siftUp(this.items.length - 1);
  }

  pop(): HeapItem<T> | undefined {
    const { items } = this;
    if (items.length === 0) return undefined;
    // Both accesses are safe: length was confirmed > 0 above.
    const top = items[0] as HeapItem<T>;
    const last = items.pop() as HeapItem<T>;
    if (items.length > 0) {
      items[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  private siftUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      // i and parent are always valid indices inside the while condition.
      const itemI = this.items[i] as HeapItem<T>;
      const itemParent = this.items[parent] as HeapItem<T>;
      if (this.cmp(itemI, itemParent) < 0) {
        this.items[i] = itemParent;
        this.items[parent] = itemI;
        i = parent;
      } else {
        break;
      }
    }
  }

  private siftDown(i: number): void {
    const n = this.items.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      // Bounds are checked before use.
      if (
        left < n &&
        this.cmp(
          this.items[left] as HeapItem<T>,
          this.items[smallest] as HeapItem<T>,
        ) < 0
      )
        smallest = left;
      if (
        right < n &&
        this.cmp(
          this.items[right] as HeapItem<T>,
          this.items[smallest] as HeapItem<T>,
        ) < 0
      )
        smallest = right;
      if (smallest === i) break;
      const tmp = this.items[i] as HeapItem<T>;
      this.items[i] = this.items[smallest] as HeapItem<T>;
      this.items[smallest] = tmp;
      i = smallest;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/** Write `data` to `stream`, waiting for drain only when the buffer is full. */
const writeChunk = async (
  stream: ReturnType<typeof createWriteStream>,
  data: string,
): Promise<void> => {
  if (!stream.write(data)) {
    await once(stream, "drain");
  }
};

// ---------------------------------------------------------------------------
// Run I/O
// ---------------------------------------------------------------------------

/**
 * Write sorted entries to a run file.  Uses `entry._json` directly — no
 * extra JSON.stringify call.  Batches output into WRITE_BUFFER_SIZE chunks.
 *
 * Format with precomputed key: `<seq>\t<encodedKey>\t<json>\n`
 * Format without key (legacy):  `<seq>\t<json>\n`
 */
const writeRunEntries = async <T>(
  filePath: string,
  entries: SortableEntry<T>[],
): Promise<void> => {
  const stream = createWriteStream(filePath, {
    encoding: "utf-8",
    highWaterMark: WRITE_BUFFER_SIZE,
  });

  let buf = "";

  try {
    for (const entry of entries) {
      // Prefer the cached raw-encoded key — avoids a re-encode call per row.
      const keyPart =
        entry._rawEncodedKey ??
        (entry._key !== undefined ? encodeKey(entry._key) : null);
      buf += keyPart
        ? `${entry.seq}\t${keyPart}\t${entry._json}\n`
        : `${entry.seq}\t${entry._json}\n`;
      if (buf.length >= WRITE_BUFFER_SIZE) {
        await writeChunk(stream, buf);
        buf = "";
      }
    }
    if (buf.length > 0) {
      await writeChunk(stream, buf);
    }
  } finally {
    stream.end();
    await once(stream, "close");
  }
};

/**
 * Stream entries from a run file.  Stores the raw JSON fragment as `_json` so
 * the merge phase can write it back without a round-trip through JSON.stringify.
 *
 * @param hasKey      - When true, expects `<seq>\t<encodedKey>\t<json>` format.
 *                      Restores `entry._key` (decoded) and `entry._rawEncodedKey`
 *                      (the raw string, for zero-cost re-writing during merge).
 * @param parseRow    - When false, `entry.row` is left as an empty object to skip
 *                      JSON.parse cost. Safe during intermediate merge passes.
 * @param shouldDecodeKey - When false (final output pass), skip key decoding
 *                          entirely — the key is not needed once we are just
 *                          yielding rows.
 */
const readRunEntries = async function* <T>(
  filePath: string,
  hasKey = false,
  parseRow = true,
  shouldDecodeKey = true,
): AsyncGenerator<SortableEntry<T>, void, void> {
  const stream = createReadStream(filePath, {
    encoding: "utf-8",
    highWaterMark: READ_HIGH_WATER_MARK,
  });
  const lineReader = createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  for await (const line of lineReader) {
    if (!line.trim()) {
      continue;
    }

    const firstTab = line.indexOf("\t");
    if (firstTab <= 0) {
      throw new Error(
        "Malformed external-sort run line: missing tab separator",
      );
    }

    const seq = Number(line.slice(0, firstTab));
    if (!Number.isFinite(seq)) {
      throw new Error(
        "Malformed external-sort run line: invalid sequence number",
      );
    }

    let _json: string;
    let _key: number | string | null | undefined;
    let _rawEncodedKey: string | undefined;

    if (hasKey) {
      const secondTab = line.indexOf("\t", firstTab + 1);
      if (secondTab < 0) {
        throw new Error(
          "Malformed external-sort run line: missing second tab separator for key",
        );
      }
      // Always keep the raw encoded string — merge passes reuse it for writes
      // without having to re-encode the decoded value.
      _rawEncodedKey = line.slice(firstTab + 1, secondTab);
      // Skip decoding on the final output pass — _key is not used there.
      _key = shouldDecodeKey ? decodeKey(_rawEncodedKey) : undefined;
      _json = line.slice(secondTab + 1);
    } else {
      _json = line.slice(firstTab + 1);
    }

    const row = parseRow ? (JSON.parse(_json) as T) : ({} as T);
    yield { seq, row, _json, _key, _rawEncodedKey };
  }
};

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

const mergeRunGroup = async <T>({
  runPaths,
  outputPath,
  compareRows,
  compareKeys,
  hasKey,
  signal,
}: {
  runPaths: string[];
  outputPath: string;
  compareRows: (left: T, right: T) => number;
  compareKeys?: (
    aKey: number | string | null,
    bKey: number | string | null,
    aSeq: number,
    bSeq: number,
  ) => number;
  hasKey: boolean;
  signal?: AbortSignal;
}) => {
  // When key comparison is available we skip JSON.parse during merge —
  // `row` is not accessed, only `_key` and `_json` are used.
  const parseRow = !hasKey || !compareKeys;

  const iterators = runPaths.map((p) =>
    readRunEntries<T>(p, hasKey, parseRow)[Symbol.asyncIterator](),
  );

  const heap = new MinHeap<T>((a, b) => {
    if (
      compareKeys &&
      a.entry._key !== undefined &&
      b.entry._key !== undefined
    ) {
      return compareKeys(a.entry._key, b.entry._key, a.entry.seq, b.entry.seq);
    }
    return compareEntries(a.entry, b.entry, compareRows);
  });

  // Seed heap with first entry from each run.
  const initialHeads = await Promise.all(iterators.map((it) => it.next()));
  for (let i = 0; i < initialHeads.length; i++) {
    const head = initialHeads[i];
    if (head && !head.done && head.value) {
      heap.push({ entry: head.value, streamIndex: i });
    }
  }

  const outputStream = createWriteStream(outputPath, {
    encoding: "utf-8",
    highWaterMark: WRITE_BUFFER_SIZE,
  });

  let buf = "";

  try {
    while (heap.size > 0) {
      throwIfAborted(signal);

      const item = heap.pop() as HeapItem<T>; // safe: heap.size > 0 in loop guard
      const { entry, streamIndex } = item;

      // Re-use cached _json and _rawEncodedKey — no JSON.stringify or
      // re-encode needed.  Fall back to encodeKey only if cache is missing.
      const keyPart =
        entry._rawEncodedKey ??
        (entry._key !== undefined ? encodeKey(entry._key) : null);
      buf += keyPart
        ? `${entry.seq}\t${keyPart}\t${entry._json}\n`
        : `${entry.seq}\t${entry._json}\n`;
      if (buf.length >= WRITE_BUFFER_SIZE) {
        await writeChunk(outputStream, buf);
        buf = "";
      }

      const iterator = iterators[streamIndex] as AsyncIterator<
        SortableEntry<T>
      >;
      const next = await iterator.next();
      if (!next.done && next.value) {
        heap.push({ entry: next.value, streamIndex });
      }
    }

    if (buf.length > 0) {
      await writeChunk(outputStream, buf);
    }
  } finally {
    outputStream.end();
    await once(outputStream, "close");
  }
};

// ---------------------------------------------------------------------------
// Run building
// ---------------------------------------------------------------------------

const buildInitialRuns = async <T>({
  source,
  compareRows,
  extractKey,
  compareKeys,
  tempManager,
  runTargetBytes,
  signal,
}: {
  source: AsyncOrSyncIterable<T>;
  compareRows: (left: T, right: T) => number;
  extractKey?: (row: T) => number | string | null;
  compareKeys?: (
    aKey: number | string | null,
    bKey: number | string | null,
    aSeq: number,
    bSeq: number,
  ) => number;
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

    if (compareKeys) {
      // Fast path: sort on precomputed keys — avoids re-running the full
      // row comparator (type coercion + object allocation) per comparison.
      currentRun.sort((a, b) =>
        compareKeys(
          a._key as number | string | null,
          b._key as number | string | null,
          a.seq,
          b.seq,
        ),
      );
    } else {
      currentRun.sort((left, right) =>
        compareEntries(left, right, compareRows),
      );
    }

    const runPath = await tempManager.createTempFilePath("sort-run");
    await writeRunEntries(runPath, currentRun);

    runPaths.push(runPath);
    currentRun = [];
    currentRunBytes = 0;
  };

  for await (const row of toAsyncIterable(source, signal)) {
    throwIfAborted(signal);

    // Serialise once here; reuse _json for byte accounting and all writes.
    const _json = JSON.stringify(row);
    // Precompute sort key once per row — reused for all comparisons.
    const _key = extractKey ? extractKey(row) : undefined;
    // When key comparison is available, `row` is never accessed after this
    // point (compareKeys uses _key; writeRunEntries uses _json).  Dropping
    // the reference lets GC reclaim source row objects while the run buffer
    // fills, cutting peak heap usage by ~N_run × sizeof(row).
    const entryRow = compareKeys ? (null as unknown as T) : row;
    const entry: SortableEntry<T> = {
      seq: sequence,
      row: entryRow,
      _json,
      _key,
    };

    sequence += 1;
    currentRun.push(entry);
    // +20 accounts for the seq digits, tab, newline, and a small margin.
    currentRunBytes += _json.length + 20;

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

// ---------------------------------------------------------------------------
// Multi-pass merge
// ---------------------------------------------------------------------------

const mergeRuns = async <T>({
  runPaths,
  compareRows,
  compareKeys,
  hasKey,
  mergeFanIn,
  tempManager,
  signal,
}: {
  runPaths: string[];
  compareRows: (left: T, right: T) => number;
  compareKeys?: (
    aKey: number | string | null,
    bKey: number | string | null,
    aSeq: number,
    bSeq: number,
  ) => number;
  hasKey: boolean;
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
        mergedRuns.push(group[0] as string); // safe: length === 1
        continue;
      }

      const mergedRunPath = await tempManager.createTempFilePath("sort-merge");
      await mergeRunGroup({
        runPaths: group,
        outputPath: mergedRunPath,
        compareRows,
        compareKeys,
        hasKey,
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const externalSortRows = async <T>(
  options: ExternalSortOptions<T>,
): Promise<ExternalSortResult<T>> => {
  const hasKey = options.extractKey !== undefined;

  const runPaths = await buildInitialRuns({
    source: options.source,
    compareRows: options.compareRows,
    extractKey: options.extractKey,
    compareKeys: options.compareKeys,
    tempManager: options.tempManager,
    runTargetBytes: options.runTargetBytes,
    signal: options.signal,
  });

  const runCount = runPaths.length;

  try {
    const finalRunPath = await mergeRuns({
      runPaths,
      compareRows: options.compareRows,
      compareKeys: options.compareKeys,
      hasKey,
      mergeFanIn: options.mergeFanIn,
      tempManager: options.tempManager,
      signal: options.signal,
    });

    return {
      runCount,
      // Final read: parse rows (only pass that needs them), but skip key
      // decoding — _key is not needed when we are just yielding row objects.
      rows: (async function* () {
        try {
          for await (const entry of readRunEntries<T>(
            finalRunPath,
            hasKey,
            true,
            false, // shouldDecodeKey = false — key unused in final output
          )) {
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
