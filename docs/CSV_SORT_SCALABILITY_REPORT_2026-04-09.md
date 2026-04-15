# CSV Sort Scalability Report and Critique

Date: 2026-04-09
Author: Copilot analysis

## 1) Executive Summary

Short answer: the current external sort strategy is the correct class of algorithm for very large datasets, but your current implementation and runtime settings are not yet optimized for speed at 20M+ rows.

The logs you shared confirm the worker is actively processing rows, not stuck.

For your current run size (~21,839,999 rows), expected sort duration is typically in the tens of minutes on the current stack, depending on row width and compare mode.

## 2) What Your Current Logs Mean

Example log:

- [csv-sort] job 22 external scan progress ... {"rowsScanned":21600000,"sourceRows":21839999}

Interpretation:

1. The worker is in external-sort source scan stage.
2. rowsScanned increments once per streamed source row.
3. At 21.6M out of 21.84M rows, scan stage is ~99% complete.
4. The sort then continues with run generation completion, merge/write stages, and final output persist.

So this confirms active progress through the sort pipeline.

## 3) Current Sort Architecture (What Is Happening Internally)

Relevant code:

- src/workers/csv-sort.worker.ts
- src/features/executions/server/datasets/external-sort.ts
- src/features/executions/server/datasets/comparator.ts
- src/config/constants.ts

Pipeline for large datasets:

1. Stream source rows from DatasetRef.
2. Build sorted run files (bounded by run target size).
3. Multi-pass k-way merge of run files.
4. Stream final sorted rows into dataset persistence.

Default tuning values currently used:

- EXTERNAL_SORT_RUN_TARGET_BYTES = 50 MB
- EXTERNAL_SORT_MAX_FAN_IN = 8
- DEFAULT_CHUNK_SIZE_ROWS = 25,000

## 4) Is This "Best" for Large Files?

### 4.1 Algorithm choice

Yes, external merge sort is the right family of algorithm for datasets that do not fit in memory.

### 4.2 Implementation quality

Good and production-viable, but not peak performance yet.

Main reasons:

1. Multiple full data passes are required (expected for external sort).
2. JSON parse/stringify overhead is still substantial across passes.
3. Comparator coercion can be expensive at very high compare counts.
4. Small run target (50 MB) increases number of runs and merge work.

## 5) Performance Model

Let:

- N = number of rows
- B = average serialized bytes per row
- D = N \* B (dataset bytes)
- R = ceil(D / runTargetBytes) (run count)
- P = ceil(log_fanIn(R)) merge passes, for R > 1

Approx IO amplification in this implementation:

- Total IO bytes ~= D \* (4 + 2P)

Why:

1. Source read + initial run write = 2D
2. Each merge pass read+write = 2D per pass
3. Final run read + output persist write = 2D

## 6) Quantified Estimates For Your Current Magnitude

Using your current sourceRows = 21,839,999 and defaults (50 MB run target, fan-in 8):

### 6.1 Estimated IO amplification

- If average row is 120 B: D ~= 2.44 GB, R ~= 50, P = 2, IO ~= 19.53 GB
- If average row is 200 B: D ~= 4.07 GB, R ~= 84, P = 3, IO ~= 40.68 GB

### 6.2 IO-only lower bound (theoretical, excludes comparator CPU)

For 120 B average row case (19.53 GB IO):

- 20 MB/s effective IO => ~16.7 min
- 40 MB/s effective IO => ~8.3 min
- 80 MB/s effective IO => ~4.2 min

Real total runtime is above this due to CPU/comparator/serialization costs.

## 7) Calibration With Your Machine Benchmark

Measured on this workspace via npm run bench:execution:

- 100 MB: write 13.1s, read 3.5s
- 250 MB: write 34.9s, read 7.2s
- 400 MB: write 62.6s, read 11.6s

Observed effective throughput (rough):

- write path: ~6-8 MB/s
- read path: ~20-35 MB/s

Given external sort uses repeated read/write + compare + parse/serialize, practical end-to-end time for ~21.84M rows is expected to be roughly:

- numeric/string compare: ~25 to 50 minutes
- date compare (heavier coercion): ~40 to 90 minutes

These are practical ranges, not hard guarantees.

## 8) Scaling Outlook For Larger Datasets (120 B/row assumption)

Defaults: runTarget 50 MB, fanIn 8.

1. 50,000,000 rows
   - data ~= 5.59 GB
   - runCount ~= 115
   - mergePasses = 3
   - IO ~= 55.88 GB
   - IO-only lower bound @40 MB/s: ~23.8 min
   - practical total: ~60 to 150 min

2. 100,000,000 rows
   - data ~= 11.18 GB
   - runCount ~= 229
   - mergePasses = 3
   - IO ~= 111.76 GB
   - IO-only lower bound @40 MB/s: ~47.7 min
   - practical total: ~2 to 5 hours

3. 200,000,000 rows
   - data ~= 22.35 GB
   - runCount ~= 458
   - mergePasses = 3
   - IO ~= 223.52 GB
   - IO-only lower bound @40 MB/s: ~95.4 min
   - practical total: ~4 to 10+ hours

## 9) Detailed Critique

### 9.1 Strengths

1. Correct out-of-core algorithm for large data.
2. Bounded memory characteristics for external path.
3. Stable ordering behavior preserved.
4. Worker-based architecture isolates heavy sort from request path.
5. Recent logging improvements make progress visible.

### 9.2 Weaknesses

1. High JSON serialization/deserialization overhead in run and merge phases.
2. Comparator coercion cost is paid repeatedly per comparison.
3. Run target (50 MB) is conservative and can increase merge work.
4. Fan-in (8) can force extra merge passes for large run counts.
5. Disk path sensitivity is high; synced folders can heavily degrade throughput.
6. External path still incurs substantial write amplification.

### 9.3 Risk area: compareAs=date

Date comparison currently parses timestamps during comparisons. At scale, this can become one of the largest CPU costs.

## 10) Priority Recommendations

### P0 (highest impact, low risk)

1. Move dataset root to non-synced local SSD path (outside cloud-sync folders).
2. Keep only one heavy sort at a time on constrained disks (avoid IO contention).
3. Add stage duration logging fields: scan_ms, run_build_ms, merge_ms, persist_ms.

Expected gain: large reduction in wall-clock variance and tail latency.

### P1 (high impact)

1. Increase DATASET_EXTERNAL_SORT_RUN_TARGET_BYTES from 50 MB to 128-256 MB (if memory permits).
2. Increase DATASET_EXTERNAL_SORT_MAX_FAN_IN from 8 to 16 (validate fd limits).
3. Precompute sort keys per row during run build to reduce repeated coercion in comparator.

Expected gain: fewer runs, fewer merge operations, lower compare overhead.

### P2 (advanced)

1. Replace JSON line run format with a more compact/binary run format.
2. Use typed key channels for merge compare (avoid repeated object parsing for key compare).
3. Consider DuckDB-backed ORDER BY for very large cases if acceptable in architecture.

Expected gain: significant CPU + IO reduction for 50M+ rows.

## 11) Recommended Immediate Plan

1. Keep current logging and add stage-duration logs.
2. Tune runTargetBytes to 128 MB and fanIn to 16 in staging.
3. Run 3 benchmark tiers with your real schema widths (not synthetic only):
   - 20M rows
   - 50M rows
   - 100M rows
4. Record p50 and p95 durations per stage and compare before/after.

## 12) Bottom Line

- The current approach is architecturally correct for large datasets.
- It is not yet the fastest implementation for your current magnitude.
- Based on your workload size and current measured throughput, your observed slowness is expected and explainable.
- With storage placement + tuning + comparator/key optimization, substantial speedups are realistic.
