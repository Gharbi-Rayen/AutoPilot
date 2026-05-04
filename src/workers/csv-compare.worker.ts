/**
 * FILE: src/workers/csv-compare.worker.ts
 *
 * PURPOSE:
 *   Compares two datasets (BASE and COMPARE) and produces a diff — similar to
 *   running `git diff` on two CSV files but at the row level.
 *   Produces FIVE output datasets, each stored in OPFS.
 *
 * WHAT IS A DATASET DIFF?
 *   Given a base dataset (the "before" state) and a compare dataset (the "after" state),
 *   a diff identifies:
 *     Added   — rows in COMPARE that are not in BASE  (new rows)
 *     Removed — rows in BASE that are not in COMPARE  (deleted rows)
 *     Changed — rows that exist in both but have different values
 *     Common  — rows that exist in both and are identical
 *     Schema Diff — which columns exist in BASE vs COMPARE
 *
 * HOW ROW IDENTITY WORKS:
 *   By default (no keyField): each row is serialised with JSON.stringify (sorted keys)
 *   and that string is the row's identity.  Two rows are the same if all their values match.
 *   With keyField(s): identity is determined by the value(s) in the specified column(s).
 *   This is more reliable for real datasets where row ORDER may differ between files.
 *
 * WHAT IS SCHEMA NORMALISATION?
 *   The compare dataset may have different column names or column order than the base.
 *   For example, the base CSV had header row but the compare CSV was parsed without headers
 *   (so columns are named "col_0", "col_1", …).
 *   normalizeSchemas() detects this and builds a mapping: compareKey → baseKey.
 *   All compare rows are then re-keyed to base column names before comparison.
 *   The header mismatch is flagged in the output so the UI can show a warning.
 *
 * FIVE OUTPUT DATASETS:
 *   _added       — rows in COMPARE not found in BASE (new rows)
 *   _removed     — rows in BASE not found in COMPARE (deleted rows)
 *   _changed     — side-by-side diff rows with _before_<field> and _after_<field> columns
 *   _common      — rows identical in both
 *   _schema_diff — one row per column: present in base? present in compare? mapped from?
 *
 * MEMORY MODEL:
 *   Same adaptive strategy as csv-join.worker.ts:
 *   - Small datasets (both ≤ PARTITION_THRESHOLD): base loaded as a single Map.
 *   - Large datasets: grace hash — partition into K buckets, process one pair at a time.
 *
 * INPUT (from WorkerJobMessage.input):
 *   baseRef       — DatasetRef for the BASE (before) dataset
 *   compareRef    — DatasetRef for the COMPARE (after) dataset
 *   keyField      — comma-separated column(s) used as row identity (empty = full-row)
 *   compareFields — comma-separated columns to compare for changes (empty = all shared columns)
 *   executionId   — current execution's ID
 *   variableName  — base name for the five output variable names
 *   chunkSize     — rows per output chunk
 *
 * OUTPUT:
 *   compareResult — summary object with counts, flags, column stats
 *   addedRef / removedRef / changedRef / commonRef / schemaDiffRef — DatasetRefs
 *   addedManifest / … / schemaDiffManifest — DatasetManifests
 *
 * USED IN:
 *   src/features/executions/components/csv-compare/executor.ts
 */

import { createId } from "@paralleldrive/cuid2";
import type { WorkerJobMessage, WorkerOutboundMessage } from "@/lib/worker-manager";
import { DATASET_MANIFEST_VERSION, type DatasetRef, type DatasetRow } from "@/types/dataset";
import { ChunkedOPFSWriter, readChunkFromOPFS, readFromOPFS } from "./_opfs-helpers";

/**
 * PARTITION_THRESHOLD
 *
 * WHY THIS EXISTS:
 *   Same role as in csv-join.worker.ts — the row count above which we switch
 *   from a single in-memory Map to a grace hash partitioned approach.
 *   K = ceil(max(baseRowCount, compareRowCount) / PARTITION_THRESHOLD).
 */
const PARTITION_THRESHOLD = 500_000;

// ─── schema normalization ─────────────────────────────────────────────────────

/**
 * isNumericKeys()
 *
 * WHY THIS EXISTS:
 *   Detects whether all column names in an array are purely numeric (e.g. "0", "1", "2").
 *   This is the pattern produced when a CSV is parsed WITHOUT a header row — columns
 *   are auto-named col_0, col_1, etc. (or sometimes just "0", "1", …).
 *   Used in normalizeSchemas() to detect header/no-header mismatches between datasets.
 *
 * CALLED FROM:
 *   normalizeSchemas() — to detect the mismatch case
 */
function isNumericKeys(keys: string[]): boolean {
  return keys.length > 0 && keys.every((k) => /^\d+$/.test(k));
}

/**
 * normalizeSchemas()
 *
 * WHY THIS EXISTS:
 *   When the two datasets have different column names (e.g. one has headers, one doesn't),
 *   we try to align them by position: compare column 0 maps to base column 0, etc.
 *   Returns a mapping object so compare rows can be re-keyed to base column names.
 *
 * RETURNS:
 *   mapping               — null if schemas already match; otherwise compareKey → baseKey
 *   headerMismatchDetected — true if one set is numeric keys and the other is not
 *   schemaAligned         — true if columns already match exactly
 *
 * CALLED FROM:
 *   self.onmessage — called once after reading the first chunks of both datasets
 */
function normalizeSchemas(baseKeys: string[], compareFirstRow: DatasetRow): {
  mapping: Record<string, string> | null;
  headerMismatchDetected: boolean;
  schemaAligned: boolean;
} {
  const keysB = Object.keys(compareFirstRow);
  const aligned = baseKeys.length === keysB.length && baseKeys.every((k, i) => k === keysB[i]);
  if (aligned) return { mapping: null, headerMismatchDetected: false, schemaAligned: true };

  const bNumeric = isNumericKeys(keysB);
  const aNumeric = isNumericKeys(baseKeys);
  const mapping: Record<string, string> = {};
  const len = Math.min(baseKeys.length, keysB.length);
  for (let i = 0; i < len; i++) mapping[keysB[i]] = baseKeys[i];
  for (let i = len; i < keysB.length; i++) mapping[keysB[i]] = keysB[i];

  return {
    mapping,
    headerMismatchDetected: bNumeric !== aNumeric,
    schemaAligned: false,
  };
}

/**
 * applyMapping()
 *
 * WHY THIS EXISTS:
 *   Re-keys a compare row using the column name mapping produced by normalizeSchemas().
 *   If mapping is null (schemas already match), returns the row unchanged.
 *   Otherwise, creates a new row object with keys translated to base column names.
 *
 * CALLED FROM:
 *   self.onmessage — applied to every compare row before building its rowKey
 */
function applyMapping(row: DatasetRow, mapping: Record<string, string> | null): DatasetRow {
  if (!mapping) return row;
  const out: DatasetRow = {};
  for (const [bKey, aKey] of Object.entries(mapping)) {
    if (bKey in row) out[aKey] = row[bKey];
  }
  return out;
}

// ─── hashing ──────────────────────────────────────────────────────────────────

/**
 * djb2() and partIdx()
 *
 * WHY THESE EXIST:
 *   Same purpose as in csv-join.worker.ts — used to route rows to partitions
 *   during the grace hash compare algorithm.
 *   See csv-join.worker.ts for full explanation.
 */
function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h;
}

function partIdx(key: string, K: number): number {
  return Math.abs(djb2(key)) % K;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * makeRef() and makeManifest()
 *
 * WHY THESE EXIST:
 *   Factory helpers to build DatasetRef and DatasetManifest objects.
 *   This worker produces FIVE datasets — without these helpers, the result-sending
 *   code would repeat the same object construction five times.
 *   DRY (Don't Repeat Yourself) principle: factor out the repeated pattern.
 *
 * CALLED FROM:
 *   self.onmessage — when sending the result, to build all five refs and manifests
 */
function makeRef(datasetId: string, executionId: string, variableName: string,
  rowCount: number, chunkCount: number, byteSize: number): DatasetRef {
  return { kind: "dataset", datasetId, executionId, variableName, rowCount, chunkCount, byteSize };
}

function makeManifest(datasetId: string, executionId: string, variableName: string,
  rowCount: number, byteSize: number, chunks: unknown[]) {
  const now = new Date().toISOString();
  return {
    version: DATASET_MANIFEST_VERSION, datasetId, executionId, variableName,
    createdAt: now, updatedAt: now, rowCount, chunkCount: chunks.length, byteSize, chunks,
  };
}

// ─── worker ───────────────────────────────────────────────────────────────────

self.onmessage = async (event: MessageEvent<WorkerJobMessage>) => {
  const { jobId, input } = event.data;
  const { baseRef, compareRef, keyField = "", compareFields = "",
    executionId, variableName = "diffData", chunkSize = 10_000 } = input as {
    baseRef: DatasetRef;
    compareRef: DatasetRef;
    keyField?: string;
    compareFields?: string;
    executionId: string;
    variableName: string;
    chunkSize?: number;
  };

  const post = (msg: WorkerOutboundMessage) => self.postMessage(msg);

  try {
    const keyFields = String(keyField || "").split(",").map((s) => s.trim()).filter(Boolean);
    const cmpFields = String(compareFields || "").split(",").map((s) => s.trim()).filter(Boolean);

    const rowKey = (r: DatasetRow): string => {
      if (keyFields.length > 0) return keyFields.map((f) => String(r[f] ?? "")).join("|");
      const sorted = Object.fromEntries(Object.keys(r).sort().map((k) => [k, r[k]]));
      return JSON.stringify(sorted);
    };

    // ── Schema detection from first chunks ──────────────────────────────────
    post({ kind: "progress", jobId, progress: 3, message: "Detecting schema..." });

    const baseChunk0 = baseRef.chunkCount > 0
      ? await readChunkFromOPFS(baseRef.executionId, baseRef.datasetId, 0)
      : [];
    const allBaseFields = baseChunk0.length > 0 ? Object.keys(baseChunk0[0]) : [];

    const cmpChunk0 = compareRef.chunkCount > 0
      ? await readChunkFromOPFS(compareRef.executionId, compareRef.datasetId, 0)
      : [];

    let mapping: Record<string, string> | null = null;
    let headerMismatchDetected = false;
    let schemaAligned = true;
    let allCmpFields: string[] = [];
    let mappedCmpFields: string[] = [];
    let fieldsToCompare: string[] = [];

    if (cmpChunk0.length > 0) {
      allCmpFields = Object.keys(cmpChunk0[0]);
      const norm = normalizeSchemas(allBaseFields, cmpChunk0[0]);
      mapping = norm.mapping;
      headerMismatchDetected = norm.headerMismatchDetected;
      schemaAligned = norm.schemaAligned;
      mappedCmpFields = mapping ? allCmpFields.map((k) => (mapping as Record<string, string>)[k] ?? k) : allCmpFields;
      const mappedSet = new Set(mappedCmpFields);
      const shared = allBaseFields.filter((f) => mappedSet.has(f));
      fieldsToCompare = cmpFields.length > 0 ? cmpFields.filter((f) => shared.includes(f)) : shared;
    }

    const totalBaseRows = baseRef.rowCount;
    let totalCompareRows = 0;

    // ── Output writers ───────────────────────────────────────────────────────
    const addedId = createId(); const removedId = createId();
    const changedId = createId(); const commonId = createId();

    const addedWriter  = new ChunkedOPFSWriter(executionId, addedId,  chunkSize);
    const removedWriter = new ChunkedOPFSWriter(executionId, removedId, chunkSize);
    const changedWriter = new ChunkedOPFSWriter(executionId, changedId, chunkSize);
    const commonWriter  = new ChunkedOPFSWriter(executionId, commonId,  chunkSize);
    await Promise.all([addedWriter.init(), removedWriter.init(), changedWriter.init(), commonWriter.init()]);

    // ── Inline diff helper ───────────────────────────────────────────────────
    async function processPair(baseRow: DatasetRow, cmpRow: DatasetRow): Promise<void> {
      const changedFieldsList = fieldsToCompare.filter(
        (f) => String(cmpRow[f] ?? "") !== String(baseRow[f] ?? ""),
      );
      if (changedFieldsList.length > 0) {
        const diffRow: DatasetRow = {};
        if (keyFields.length > 0) diffRow._diff_key = keyFields.map((f) => String(baseRow[f] ?? "")).join("|");
        diffRow._diff_changed = changedFieldsList.join(",");
        for (const f of fieldsToCompare) {
          diffRow[`_before_${f}`] = baseRow[f];
          diffRow[`_after_${f}`] = cmpRow[f];
        }
        await changedWriter.write([diffRow]);
      } else {
        await commonWriter.write([baseRow]);
      }
    }

    const K = Math.max(1, Math.ceil(Math.max(baseRef.rowCount, compareRef.rowCount) / PARTITION_THRESHOLD));

    if (K === 1) {
      // ── Small datasets: load base into Map, stream compare ───────────────
      post({ kind: "progress", jobId, progress: 5, message: "Loading base dataset..." });
      const base = await readFromOPFS(baseRef.executionId, baseRef.datasetId, baseRef.chunkCount);
      const baseMap = new Map<string, DatasetRow>();
      for (const r of base) baseMap.set(rowKey(r), r);

      const matchedBaseKeys = new Set<string>();

      post({ kind: "progress", jobId, progress: 20, message: "Comparing datasets..." });
      for (let c = 0; c < compareRef.chunkCount; c++) {
        const rawChunk = await readChunkFromOPFS(compareRef.executionId, compareRef.datasetId, c);
        totalCompareRows += rawChunk.length;
        for (const rawRow of rawChunk) {
          const cmpRow = applyMapping(rawRow, mapping);
          const key = rowKey(cmpRow);
          if (!baseMap.has(key)) {
            await addedWriter.write([cmpRow]);
          } else {
            matchedBaseKeys.add(key);
            await processPair(baseMap.get(key) as DatasetRow, cmpRow);
          }
        }
        const pct = Math.round(20 + ((c + 1) / compareRef.chunkCount) * 55);
        post({ kind: "progress", jobId, progress: pct, message: `Compared ${totalCompareRows.toLocaleString()} rows...` });
      }

      post({ kind: "progress", jobId, progress: 77, message: "Finding removed rows..." });
      for (const [key, baseRow] of baseMap) {
        if (!matchedBaseKeys.has(key)) await removedWriter.write([baseRow]);
      }

    } else {
      // ── Large datasets: grace hash compare ───────────────────────────────
      post({ kind: "progress", jobId, progress: 5, message: `Partitioning into ${K} buckets...` });

      // Phase 1: partition base
      const basePartIds = Array.from({ length: K }, () => createId());
      const basePartWriters = basePartIds.map((id) => new ChunkedOPFSWriter(executionId, id, chunkSize));
      await Promise.all(basePartWriters.map((w) => w.init()));

      for (let c = 0; c < baseRef.chunkCount; c++) {
        const chunk = await readChunkFromOPFS(baseRef.executionId, baseRef.datasetId, c);
        const buckets: DatasetRow[][] = Array.from({ length: K }, () => []);
        for (const row of chunk) buckets[partIdx(rowKey(row), K)].push(row);
        for (let i = 0; i < K; i++) {
          if (buckets[i].length) await basePartWriters[i].write(buckets[i]);
        }
        const pct = Math.round(5 + ((c + 1) / baseRef.chunkCount) * 15);
        post({ kind: "progress", jobId, progress: pct, message: `Partitioning base... ${(c + 1).toLocaleString()} / ${baseRef.chunkCount} chunks` });
      }
      const basePartMeta = await Promise.all(basePartWriters.map((w) => w.finish()));

      // Phase 2: partition compare
      const cmpPartIds = Array.from({ length: K }, () => createId());
      const cmpPartWriters = cmpPartIds.map((id) => new ChunkedOPFSWriter(executionId, id, chunkSize));
      await Promise.all(cmpPartWriters.map((w) => w.init()));

      for (let c = 0; c < compareRef.chunkCount; c++) {
        const rawChunk = await readChunkFromOPFS(compareRef.executionId, compareRef.datasetId, c);
        totalCompareRows += rawChunk.length;
        const buckets: DatasetRow[][] = Array.from({ length: K }, () => []);
        for (const rawRow of rawChunk) {
          const cmpRow = applyMapping(rawRow, mapping);
          buckets[partIdx(rowKey(cmpRow), K)].push(rawRow);
        }
        for (let i = 0; i < K; i++) {
          if (buckets[i].length) await cmpPartWriters[i].write(buckets[i]);
        }
        const pct = Math.round(20 + ((c + 1) / compareRef.chunkCount) * 20);
        post({ kind: "progress", jobId, progress: pct, message: `Partitioning compare... ${(c + 1).toLocaleString()} / ${compareRef.chunkCount} chunks` });
      }
      const cmpPartMeta = await Promise.all(cmpPartWriters.map((w) => w.finish()));

      // Phase 3: compare each partition pair
      for (let i = 0; i < K; i++) {
        const basePartChunks = basePartMeta[i].chunks.length;
        const basePartMap = new Map<string, DatasetRow>();
        for (let ci = 0; ci < basePartChunks; ci++) {
          const chunk = await readChunkFromOPFS(executionId, basePartIds[i], ci);
          for (const row of chunk) basePartMap.set(rowKey(row), row);
        }
        const matchedBaseKeys = new Set<string>();

        const cmpPartChunks = cmpPartMeta[i].chunks.length;
        for (let ci = 0; ci < cmpPartChunks; ci++) {
          const rawChunk = await readChunkFromOPFS(executionId, cmpPartIds[i], ci);
          for (const rawRow of rawChunk) {
            const cmpRow = applyMapping(rawRow, mapping);
            const key = rowKey(cmpRow);
            if (!basePartMap.has(key)) {
              await addedWriter.write([cmpRow]);
            } else {
              matchedBaseKeys.add(key);
              await processPair(basePartMap.get(key) as DatasetRow, cmpRow);
            }
          }
        }

        for (const [key, baseRow] of basePartMap) {
          if (!matchedBaseKeys.has(key)) await removedWriter.write([baseRow]);
        }

        const pct = Math.round(40 + ((i + 1) / K) * 45);
        post({ kind: "progress", jobId, progress: pct, message: `Comparing partition ${i + 1} / ${K}...` });
      }
    }

    post({ kind: "progress", jobId, progress: 87, message: "Writing results..." });

    const [addedResult, removedResult, changedResult, commonResult] = await Promise.all([
      addedWriter.finish(),
      removedWriter.finish(),
      changedWriter.finish(),
      commonWriter.finish(),
    ]);

    // Schema diff dataset
    const schemaDiffId = createId();
    const allColumns = new Set([...allBaseFields, ...mappedCmpFields]);
    const schemaDiff: DatasetRow[] = Array.from(allColumns).map((col) => ({
      column: col,
      in_base: allBaseFields.includes(col) ? "yes" : "no",
      in_compare: mappedCmpFields.includes(col) ? "yes" : "no",
      mapped_from: mapping
        ? (Object.entries(mapping).find(([, v]) => v === col)?.[0] ?? col)
        : col,
    }));
    const schemaDiffWriter = new ChunkedOPFSWriter(executionId, schemaDiffId, chunkSize);
    await schemaDiffWriter.init();
    await schemaDiffWriter.write(schemaDiff);
    const schemaDiffResult = await schemaDiffWriter.finish();

    const addedVar   = `${variableName}_added`;
    const removedVar = `${variableName}_removed`;
    const changedVar = `${variableName}_changed`;
    const commonVar  = `${variableName}_common`;
    const schemaDiffVar = `${variableName}_schema_diff`;

    const isIdentical = addedResult.totalRows === 0 && removedResult.totalRows === 0 && changedResult.totalRows === 0;

    const compareResult = {
      _compareResult: true as const,
      isIdentical, schemaAligned, headerMismatchDetected,
      columnMapping: mapping ?? null,
      keyField: keyFields.length > 0 ? keyFields.join(", ") : null,
      compareFields: cmpFields.length > 0 ? cmpFields : allBaseFields.filter((f) => allCmpFields.includes(f)),
      totalBaseRows, totalCompareRows,
      addedCount: addedResult.totalRows, removedCount: removedResult.totalRows,
      changedCount: changedResult.totalRows, commonCount: commonResult.totalRows,
      unchangedCount: commonResult.totalRows,
      columnsInBase: allBaseFields.length, columnsInCompare: mappedCmpFields.length,
      columnsInBoth: allBaseFields.filter((f) => mappedCmpFields.includes(f)).length,
      columnsOnlyInBase: allBaseFields.filter((f) => !mappedCmpFields.includes(f)).length,
      columnsOnlyInCompare: mappedCmpFields.filter((f) => !allBaseFields.includes(f)).length,
      addedVarName: addedResult.totalRows > 0 ? addedVar : null,
      removedVarName: removedResult.totalRows > 0 ? removedVar : null,
      changedVarName: changedResult.totalRows > 0 ? changedVar : null,
      commonVarName: commonResult.totalRows > 0 ? commonVar : null,
      schemaDiffVarName: schemaDiff.length > 0 ? schemaDiffVar : null,
      summary: isIdentical
        ? `${totalBaseRows} matching rows — datasets are identical`
        : `${addedResult.totalRows} added, ${removedResult.totalRows} removed, ${changedResult.totalRows} changed, ${commonResult.totalRows} common`,
      changedDiffRowCount: changedResult.totalRows,
    };

    post({
      kind: "result", jobId,
      output: {
        compareResult,
        addedRef:     makeRef(addedId,     executionId, addedVar,     addedResult.totalRows,     addedResult.chunks.length,     addedResult.totalBytes),
        removedRef:   makeRef(removedId,   executionId, removedVar,   removedResult.totalRows,   removedResult.chunks.length,   removedResult.totalBytes),
        changedRef:   makeRef(changedId,   executionId, changedVar,   changedResult.totalRows,   changedResult.chunks.length,   changedResult.totalBytes),
        commonRef:    makeRef(commonId,    executionId, commonVar,    commonResult.totalRows,    commonResult.chunks.length,    commonResult.totalBytes),
        schemaDiffRef: makeRef(schemaDiffId, executionId, schemaDiffVar, schemaDiff.length,     schemaDiffResult.chunks.length, schemaDiffResult.totalBytes),
        addedManifest:      makeManifest(addedId,     executionId, addedVar,     addedResult.totalRows,     addedResult.totalBytes,     addedResult.chunks),
        removedManifest:    makeManifest(removedId,   executionId, removedVar,   removedResult.totalRows,   removedResult.totalBytes,   removedResult.chunks),
        changedManifest:    makeManifest(changedId,   executionId, changedVar,   changedResult.totalRows,   changedResult.totalBytes,   changedResult.chunks),
        commonManifest:     makeManifest(commonId,    executionId, commonVar,    commonResult.totalRows,    commonResult.totalBytes,    commonResult.chunks),
        schemaDiffManifest: makeManifest(schemaDiffId, executionId, schemaDiffVar, schemaDiff.length,      schemaDiffResult.totalBytes, schemaDiffResult.chunks),
      },
    });
  } catch (err) {
    post({ kind: "error", jobId, error: String(err) });
  }
};
