# Node Data Flow Benchmarks

## Command

Run the benchmark harness:

```bash
npm run bench:execution
```

The script executes three profiles:

- 100 MB
- 250 MB
- 400 MB

## Reported Metrics

Each profile reports:

- `generatedRows`
- `generatedBytes`
- `chunkCount`
- `writeDurationMs`
- `readDurationMs`
- `cpuTimeMs`
- `gcPauseMs`
- `diskIOMs`
- `peakRssMb`

## Limits

The benchmark and runtime limits are controlled by:

- `MAX_IN_MEMORY_ROWS`
- `DEFAULT_BATCH_SIZE`
- `MAX_EXECUTION_OUTPUT_BYTES`

These map to `EXECUTION_LIMITS` in [src/config/constants.ts](../src/config/constants.ts).

## Notes

- Temporary benchmark datasets are removed after each profile run.
- `diskIOMs` is an approximation derived from wall time minus CPU and GC pause time.
- If your machine has lower disk throughput, expect higher write/read durations for the 400 MB profile.
