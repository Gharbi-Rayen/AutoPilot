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

    // Single pass through OPFS chunks in original order — no sorting
    post({ kind: "progress", jobId, progress: 5, message: "Analyzing sequences..." });

    type RunState = { start: number; end: number; length: number; prevVal: number };
    const runMap = new Map<string, RunState>();
    const summaryRows: DatasetRow[] = [];

    const flushRun = (gk: string) => {
      const run = runMap.get(gk);
      if (!run) return;
      runMap.delete(gk);
      if (run.length < minSeqLen) return;
      const row: DatasetRow = {
        sequence_start: run.start,
        sequence_end: run.end,
        sequence_length: run.length,
      };
      if (groupFields.length > 0 && gk !== "__all__") row.group = gk;
      summaryRows.push(row);
    };

    for (let c = 0; c < inputRef.chunkCount; c++) {
      const chunk = await readChunkFromOPFS(inputRef.executionId, inputRef.datasetId, c);
      for (let r = 0; r < chunk.length; r++) {
        const row = chunk[r];
        const gk =
          groupFields.length > 0
            ? groupFields.map((f) => String(row[f] ?? "")).join("|")
            : "__all__";
        const val = toVal(row);
        if (Number.isNaN(val)) continue;

        const run = runMap.get(gk);
        if (run && Math.abs(val - (run.prevVal + step)) < 1e-9) {
          run.end = val;
          run.length++;
          run.prevVal = val;
        } else {
          if (run) flushRun(gk);
          runMap.set(gk, { start: val, end: val, length: 1, prevVal: val });
        }
      }
      const pct = Math.round(5 + ((c + 1) / inputRef.chunkCount) * 85);
      post({ kind: "progress", jobId, progress: pct, message: `Analyzed ${c + 1} / ${inputRef.chunkCount} chunks...` });
    }

    // Flush all active runs
    for (const gk of [...runMap.keys()]) {
      flushRun(gk);
    }

    post({ kind: "progress", jobId, progress: 92, message: "Writing results..." });

    const datasetId = createId();
    const { chunks, totalBytes } = await writeToOPFS(executionId, datasetId, summaryRows, chunkSize);

    const createdAt = new Date().toISOString();
    const manifest = {
      version: DATASET_MANIFEST_VERSION,
      datasetId,
      executionId,
      variableName,
      createdAt,
      updatedAt: createdAt,
      rowCount: summaryRows.length,
      chunkCount: chunks.length,
      byteSize: totalBytes,
      chunks,
    };
    const datasetRef: DatasetRef = {
      kind: "dataset",
      datasetId,
      executionId,
      variableName,
      rowCount: summaryRows.length,
      chunkCount: chunks.length,
      byteSize: totalBytes,
    };

    post({ kind: "result", jobId, output: { manifest, datasetRef, totalRows: summaryRows.length } });
  } catch (err) {
    post({ kind: "error", jobId, error: String(err) });
  }
};
