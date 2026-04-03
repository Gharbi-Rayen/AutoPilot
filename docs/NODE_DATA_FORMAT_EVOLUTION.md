# Node Data Format Evolution

Date: 2026-04-02

## Goal

Define a reversible path from JSONL chunk storage to a future columnar format without changing node-level contracts.

## Current State

- Storage interface now exposes adapter capabilities.
- Format selection is negotiated in dataset service.
- Columnar adapter is available behind feature flags and currently runs in prototype mode.

## Feature Flags

- `DATASET_STORAGE_FORMAT=jsonl|columnar`
- `DATASET_ENABLE_COLUMNAR_ADAPTER=true|false`
- `DATASET_COLUMNAR_PROTOTYPE_MODE=true|false`

Recommended defaults:

- Production: `jsonl`, columnar disabled.
- Benchmark environment: `columnar` with prototype mode enabled.

## Migration Plan

1. Expand:

- Keep JSONL as default.
- Add columnar adapter path behind flag.
- Keep API payload and `DatasetRef` contracts unchanged.

2. Shadow Benchmark:

- Run representative workflows once with JSONL, once with columnar flag.
- Capture latency, temp file count, disk growth, and peak pipeline memory.

3. Validate:

- Compare dataset chunk/page API behavior and output equivalence.
- Verify sort/join/compare determinism and schema-typed value parity.

4. Contract:

- Move columnar adapter from prototype mode to strict mode.
- Keep rollback available by switching format flag back to JSONL.

## Benchmark Matrix

Run each workflow with both adapters:

- Parse -> Filter -> Aggregate
- Parse -> Sort (external)
- Parse -> Join -> Compare
- Mixed light and heavy chains

Track:

- End-to-end duration
- `__resourceBudget.diskUsageBytes`
- `__resourceBudget.peakPipelineMemoryBytes`
- Temp file count
- Result row counts and checksums

## Rollback

Rollback requires only config changes:

- Set `DATASET_STORAGE_FORMAT=jsonl`
- Set `DATASET_ENABLE_COLUMNAR_ADAPTER=false`

No node-level contract or API schema changes are required.
