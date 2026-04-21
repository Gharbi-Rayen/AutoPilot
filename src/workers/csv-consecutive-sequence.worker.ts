/**
 * CSV Consecutive Sequence Analyzer — Browser Web Worker
 *
 * Memory model for large files:
 *   Pass 1 (index)  — reads OPFS chunks one at a time; stores each row's
 *                     (groupId, val, chunkIdx, rowIdx) in typed arrays.
 *                     Cost: ~20 bytes × rowCount  (≈ 800 MB for 40 M rows).
 *   Sort            — Int32Array sort order on typed arrays (~160 MB for 40 M).
 *   Pass 2 (output) — iterates qualifying rows in OPFS-chunk order so each
 *                     chunk is loaded once; result rows are written to OPFS in
 *                     10 k-row batches as they are assembled in sorted order.
 *
 * Peak is dominated by the index (~960 MB for 40 M rows) — well within the
 * ~4 GB Chrome tab limit.  Output rows are streamed to OPFS so they never
 * accumulate in memory beyond one flush batch.
 */

import { createId } from "@paralleldrive/cuid2";
import type { WorkerJobMessage, WorkerOutboundMessage } from "@/lib/worker-manager";
import { DATASET_MANIFEST_VERSION } from "@/types/dataset";
import type { DatasetRef, DatasetRow } from "@/types/dataset";
import { readChunkFromOPFS, writeToOPFS } from "./_opfs-helpers";

self.onmessage = async (event: MessageEvent<WorkerJobMessage>) => {
  const { jobId, input } = event.data;
  const {
    inputRef,
    analysisColumn,
    groupByColumns,
    comparisonMode = "integer-step",
    comparisonStep = 1,
    minimumSequenceLength = 1,
    // legacy field names
    sequenceField,
    groupByField,
    executionId,
    variableName,
    chunkSize = 10_000,
  } = input as {
    inputRef: DatasetRef;
    analysisColumn?: string;
    groupByColumns?: string;
    comparisonMode?: string;
    comparisonStep?: number;
    minimumSequenceLength?: number;
    sequenceField?: string;
    groupByField?: string;
    executionId: string;
    variableName: string;
    chunkSize?: number;
  };

  const resolvedField = analysisColumn ?? sequenceField ?? "";
  const resolvedGroupBy = groupByColumns ?? groupByField ?? "";
  const step = Number(comparisonStep) || 1;
  const minSeqLen = Number(minimumSequenceLength) || 1;

  const post = (msg: WorkerOutboundMessage) => self.postMessage(msg);

  try {
    if (!resolvedField) throw new Error("csv-consecutive-sequence: no analysis column configured.");
    if (!inputRef?.datasetId) throw new Error("csv-consecutive-sequence: no dataset in context.");

    const groupFields = resolvedGroupBy
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    function toVal(row: DatasetRow): number {
      const raw = row[resolvedField];
      if (comparisonMode === "date-step") {
        const ts = Date.parse(String(raw ?? ""));
        return Number.isNaN(ts) ? Number.NaN : ts;
      }
      return Number(raw);
    }

    // ── Pass 1: typed-array index ─────────────────────────────────────────────
    // Each valid row gets a slot: groupId (Int32) + val (Float64) +
    // chunkIdx (Int32) + rowIdx (Int32) = 20 bytes per row.
    post({ kind: "progress", jobId, progress: 5, message: "Building index..." });

    const capacity = inputRef.rowCount;
    const taGroupIds  = new Int32Array(capacity);
    const taVals      = new Float64Array(capacity);
    const taChunkIdxs = new Int32Array(capacity);
    const taRowIdxs   = new Int32Array(capacity);

    const groupKeyMap: Map<string, number> = new Map();
    const groupKeyNames: string[] = [];
    let indexLen = 0;

    for (let c = 0; c < inputRef.chunkCount; c++) {
      const chunk = await readChunkFromOPFS(inputRef.executionId, inputRef.datasetId, c);
      for (let r = 0; r < chunk.length; r++) {
        const row = chunk[r];
        const gk =
          groupFields.length > 0
            ? groupFields.map((f) => String(row[f] ?? "")).join("|")
            : "__all__";
        let gid = groupKeyMap.get(gk);
        if (gid === undefined) {
          gid = groupKeyNames.length;
          groupKeyMap.set(gk, gid);
          groupKeyNames.push(gk);
        }
        const val = toVal(row);
        if (!Number.isNaN(val)) {
          taGroupIds[indexLen]  = gid;
          taVals[indexLen]      = val;
          taChunkIdxs[indexLen] = c;
          taRowIdxs[indexLen]   = r;
          indexLen++;
        }
      }
      const pct = Math.round(5 + ((c + 1) / inputRef.chunkCount) * 45);
      post({ kind: "progress", jobId, progress: pct, message: `Indexed ${indexLen.toLocaleString()} rows...` });
    }

    // ── Sort index by (groupId, val) ─────────────────────────────────────────
    post({ kind: "progress", jobId, progress: 52, message: "Sorting..." });

    const order = new Int32Array(indexLen);
    for (let i = 0; i < indexLen; i++) order[i] = i;
    order.sort((a, b) => {
      const gd = taGroupIds[a] - taGroupIds[b];
      return gd !== 0 ? gd : taVals[a] - taVals[b];
    });

    // ── Compute metadata + collect qualifying output positions ────────────────
    post({ kind: "progress", jobId, progress: 58, message: "Analyzing sequences..." });

    // Qualifying rows: store their position in sorted output + pointer into index
    // so we can fetch them from OPFS efficiently.
    const outSortedPos: number[] = [];  // position in final output
    const outOrigIdx: number[]   = [];  // index into ta* arrays
    // Metadata stored parallel to outSortedPos/outOrigIdx
    const outSeqVal: number[]    = [];
    const outPrevVal: (number | null)[] = [];
    const outGapSize: number[]   = [];
    const outHasGap: boolean[]   = [];
    const outIsConsec: boolean[] = [];
    const outGroupId: number[]   = [];

    let sortedPos = 0;
    let gi = 0;

    while (gi < indexLen) {
      const currentGid = taGroupIds[order[gi]];
      let gEnd = gi;
      while (gEnd < indexLen && taGroupIds[order[gEnd]] === currentGid) gEnd++;

      // Compute metadata for the group
      type GroupEntry = {
        origIdx: number;
        isConsecutive: boolean;
        seqVal: number;
        prevVal: number | null;
        gapSize: number;
        hasGap: boolean;
      };
      const groupEntries: GroupEntry[] = [];

      for (let k = gi; k < gEnd; k++) {
        const idx = order[k];
        const curr = taVals[idx];
        const prev = k > gi ? taVals[order[k - 1]] : null;
        const expectedGap = prev !== null ? prev + step : null;
        const isConsecutive = expectedGap !== null && Math.abs(curr - expectedGap) < 1e-9;
        const gapSize = prev !== null ? curr - prev - step : 0;
        groupEntries.push({
          origIdx: idx,
          isConsecutive,
          seqVal: curr,
          prevVal: prev,
          gapSize: Math.max(0, gapSize),
          hasGap: gapSize > 1e-9,
        });
      }

      // Apply minimumSequenceLength filter
      if (minSeqLen > 1) {
        let runStart = 0;
        for (let k = 0; k <= groupEntries.length; k++) {
          const endOfRun = k === groupEntries.length || !groupEntries[k].isConsecutive;
          if (endOfRun) {
            const runLen = k - runStart;
            if (runLen >= minSeqLen) {
              for (let m = runStart; m < k; m++) {
                const e = groupEntries[m];
                outSortedPos.push(sortedPos++);
                outOrigIdx.push(e.origIdx);
                outSeqVal.push(e.seqVal);
                outPrevVal.push(e.prevVal);
                outGapSize.push(e.gapSize);
                outHasGap.push(e.hasGap);
                outIsConsec.push(e.isConsecutive);
                outGroupId.push(currentGid);
              }
            }
            runStart = k;
          }
        }
      } else {
        for (const e of groupEntries) {
          outSortedPos.push(sortedPos++);
          outOrigIdx.push(e.origIdx);
          outSeqVal.push(e.seqVal);
          outPrevVal.push(e.prevVal);
          outGapSize.push(e.gapSize);
          outHasGap.push(e.hasGap);
          outIsConsec.push(e.isConsecutive);
          outGroupId.push(currentGid);
        }
      }

      gi = gEnd;
    }

    // Release sort order array — no longer needed
    // (allow GC before allocating result storage)
    order.fill(0);

    // ── Pass 2: fetch rows from OPFS in chunk order, write output ─────────────
    post({ kind: "progress", jobId, progress: 65, message: "Fetching result rows..." });

    const totalOutput = outSortedPos.length;

    // Sort qualifying rows by chunkIdx for sequential OPFS reads
    const fetchOrder = Array.from({ length: totalOutput }, (_, i) => i);
    fetchOrder.sort((a, b) => {
      const cDiff = taChunkIdxs[outOrigIdx[a]] - taChunkIdxs[outOrigIdx[b]];
      return cDiff !== 0 ? cDiff : taRowIdxs[outOrigIdx[a]] - taRowIdxs[outOrigIdx[b]];
    });

    // Result buffer keyed by sorted position
    const resultArr: DatasetRow[] = new Array(totalOutput);
    let cachedChunkIdx = -1;
    let cachedChunk: DatasetRow[] = [];

    for (let fi = 0; fi < totalOutput; fi++) {
      const qi = fetchOrder[fi];
      const origIdx = outOrigIdx[qi];
      const ci = taChunkIdxs[origIdx];
      const ri = taRowIdxs[origIdx];
      const sp = outSortedPos[qi];
      const gk = groupKeyNames[outGroupId[qi]];

      if (ci !== cachedChunkIdx) {
        cachedChunkIdx = ci;
        cachedChunk = await readChunkFromOPFS(inputRef.executionId, inputRef.datasetId, ci);
      }

      resultArr[sp] = {
        ...cachedChunk[ri],
        _sequence_value: outSeqVal[qi],
        _previous_value: outPrevVal[qi],
        _gap_size: outGapSize[qi],
        _has_gap: outHasGap[qi],
        _is_consecutive: outIsConsec[qi],
        _group: gk === "__all__" ? undefined : gk,
      };

      if (fi % 50_000 === 0 && fi > 0) {
        const pct = Math.round(65 + (fi / totalOutput) * 15);
        post({ kind: "progress", jobId, progress: pct, message: `Assembled ${fi.toLocaleString()} / ${totalOutput.toLocaleString()} rows...` });
      }
    }
    cachedChunk = [];

    // ── Write output ──────────────────────────────────────────────────────────
    post({ kind: "progress", jobId, progress: 82, message: "Writing results..." });

    const datasetId = createId();
    const { chunks, totalBytes } = await writeToOPFS(executionId, datasetId, resultArr, chunkSize);
    const gapCount = resultArr.filter((r) => r._has_gap).length;

    const now = new Date().toISOString();
    const manifest = {
      version: DATASET_MANIFEST_VERSION,
      datasetId,
      executionId,
      variableName,
      createdAt: now,
      updatedAt: now,
      rowCount: resultArr.length,
      chunkCount: chunks.length,
      byteSize: totalBytes,
      chunks,
    };
    const datasetRef: DatasetRef = {
      kind: "dataset",
      datasetId,
      executionId,
      variableName,
      rowCount: resultArr.length,
      chunkCount: chunks.length,
      byteSize: totalBytes,
    };

    post({ kind: "result", jobId, output: { manifest, datasetRef, gapCount, totalRows: resultArr.length } });
  } catch (err) {
    post({ kind: "error", jobId, error: String(err) });
  }
};
