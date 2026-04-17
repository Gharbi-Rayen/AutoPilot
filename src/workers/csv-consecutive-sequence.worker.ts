/**
 * CSV Consecutive Sequence Analyzer — Browser Web Worker
 * Detects gaps and consecutive runs in a numeric/date field.
 */

import { createId } from "@paralleldrive/cuid2";
import type { WorkerJobMessage, WorkerOutboundMessage } from "@/lib/worker-manager";
import type { DatasetRow, DatasetRef } from "@/types/dataset";
import { DATASET_MANIFEST_VERSION } from "@/types/dataset";
import { readFromOPFS, writeToOPFS } from "./_opfs-helpers";

self.onmessage = async (event: MessageEvent<WorkerJobMessage>) => {
  const { jobId, input } = event.data;
  const {
    inputRef,
    // dialog field names (primary)
    analysisColumn,
    groupByColumns,
    comparisonMode = "integer-step",
    comparisonStep = 1,
    minimumSequenceLength = 1,
    // legacy field names (fallback)
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

    post({ kind: "progress", jobId, progress: 10, message: "Reading..." });
    const rows = await readFromOPFS(inputRef.executionId, inputRef.datasetId, inputRef.chunkCount);
    post({ kind: "progress", jobId, progress: 50, message: "Analyzing sequences..." });

    // Build group keys — support comma-separated groupByColumns
    const groupFields = resolvedGroupBy
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const groups = new Map<string, DatasetRow[]>();
    for (const row of rows) {
      const key = groupFields.length > 0
        ? groupFields.map((f) => String(row[f] ?? "")).join("|")
        : "__all__";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)?.push(row);
    }

    const result: DatasetRow[] = [];
    for (const [groupKey, groupRows] of groups) {
      // Parse numeric value — for date-step, convert to timestamp
      const toVal = (r: DatasetRow): number => {
        const raw = r[resolvedField];
        if (comparisonMode === "date-step") {
          const ts = Date.parse(String(raw ?? ""));
          return Number.isNaN(ts) ? Number.NaN : ts;
        }
        return Number(raw);
      };

      const nums = groupRows
        .map((r) => ({ row: r, val: toVal(r) }))
        .filter((x) => !Number.isNaN(x.val))
        .sort((a, b) => a.val - b.val);

      // Track consecutive run lengths to apply minimumSequenceLength filter
      const withMeta: DatasetRow[] = [];
      for (let i = 0; i < nums.length; i++) {
        const prev = i > 0 ? nums[i - 1].val : null;
        const curr = nums[i].val;
        const expectedGap = prev !== null ? prev + step : null;
        const isConsecutive = expectedGap !== null && Math.abs(curr - expectedGap) < 1e-9;
        const gapSize = prev !== null ? curr - prev - step : 0;
        withMeta.push({
          ...nums[i].row,
          _sequence_value: curr,
          _previous_value: prev,
          _gap_size: Math.max(0, gapSize),
          _has_gap: gapSize > 1e-9,
          _is_consecutive: isConsecutive,
          _group: groupKey === "__all__" ? undefined : groupKey,
        });
      }

      // Apply minimumSequenceLength: only keep rows that are part of a run >= minSeqLen
      if (minSeqLen > 1) {
        // Tag each row with its run length
        let runStart = 0;
        for (let i = 0; i <= withMeta.length; i++) {
          const endOfRun = i === withMeta.length || !withMeta[i]._is_consecutive;
          if (endOfRun) {
            const runLen = i - runStart;
            if (runLen >= minSeqLen) {
              for (let j = runStart; j < i; j++) result.push(withMeta[j]);
            }
            runStart = i;
          }
        }
      } else {
        for (const row of withMeta) result.push(row);
      }
    }

    post({ kind: "progress", jobId, progress: 75, message: "Writing..." });
    const datasetId = createId();
    const { chunks, totalBytes } = await writeToOPFS(executionId, datasetId, result, chunkSize);
    const gapCount = result.filter((r) => r._has_gap).length;
    const now = new Date().toISOString();
    const manifest = { version: DATASET_MANIFEST_VERSION, datasetId, executionId, variableName, createdAt: now, updatedAt: now, rowCount: result.length, chunkCount: chunks.length, byteSize: totalBytes, chunks };
    const datasetRef: DatasetRef = { kind: "dataset", datasetId, executionId, variableName, rowCount: result.length, chunkCount: chunks.length, byteSize: totalBytes };
    post({ kind: "result", jobId, output: { manifest, datasetRef, gapCount, totalRows: result.length } });
  } catch (err) { post({ kind: "error", jobId, error: String(err) }); }
};
export {};
