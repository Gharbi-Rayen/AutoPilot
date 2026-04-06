# CSV Sort Node System Architecture & Logic

This document details the complete architecture, data flow, and underlying algorithms powering the "Sort CSV Dataset" workflow node. This node reorders rows within a dataset based on a specified field, with support for multiple comparison types and null handling strategies.

---

## 1. High-Level Execution Flow

When a workflow execution hits the `csv-sort` node, the backend transitions through the following distinct phases:

1. **Context Resolution**: Retrieves the literal data or `DatasetRef` (pointers to persisted dataset chunks) for the source variable.
2. **Strategy Selection**: Determines whether to use in-memory sorting (fast path) for small datasets or external merge sort for large datasets.
3. **Row Comparison Setup**: Builds a comparator function based on the sort field, direction (asc/desc), type coercion (string/number/date), and null placement.
4. **Execution**: Applies the sorting algorithm and streams results back to disk via chunked persistence.
5. **Output**: Returns a new `DatasetRef` containing the sorted rows, preserving schema and metadata.

---

## 2. Input Configuration

The Sort node accepts the following parameters via `CsvSortData`:

```typescript
type CsvSortData = {
  sourceVariable?: string; // Variable name containing the dataset to sort
  variableName?: string; // Output variable name for sorted results
  sortField?: string; // Field/column name to sort by
  direction?: "asc" | "desc"; // Sort order (default: "asc")
  compareAs?: "string" | "number" | "date"; // Type coercion (default: "string")
  nulls?: "first" | "last"; // Null placement (default: "last")
};
```

### Parameter Validation

- **Source Variable**: Must exist in the workflow context and contain either inline rows or a `DatasetRef`.
- **Variable Name**: Required; defines the output variable in the workflow context.
- **Sort Field**: Required; must be a valid column name in the dataset schema.
- **Direction**: Defaults to ascending order if not specified.
- **Compare As**: Determines type coercion during comparison. Mismatches are coerced to string comparison.
- **Nulls**: Controls whether `null` or `undefined` values appear first or last in the sorted output.

---

## 3. Row Comparison Strategy (`comparator.ts`)

The Sort node uses a **type-aware comparator** (`createRowComparator`) that handles heterogeneous data types and null values intelligently.

### Comparison Logic

```
1. Extract the sort field value from both rows
2. If either value is null/undefined:
   - Apply nulls placement rule ("first" or "last")
   - Return immediately with position indicator
3. Otherwise, coerce both values to the specified compareAs type:
   - "string": toString() on both values
   - "number": parseFloat() with validation
   - "date": parse ISO/timestamp formats, fallback to string compare
4. Apply directional comparison (asc/desc)
5. Return -1, 0, or 1 (three-way compare)
```

### Stability Guarantee

To ensure reproducible sorting, rows with identical sort field values maintain their original relative order (stable sort) by tracking the original index:

```typescript
.map((row, index) => ({ row, index }))
.sort((left, right) => {
  const rowComparison = compareRows(left.row, right.row);
  if (rowComparison !== 0) return rowComparison;
  return left.index - right.index;  // Tie-breaker preserves stability
})
```

---

## 4. Execution Strategy Selection

The Sort node chooses between two execution paths based on dataset size.

### Fast Path (In-Memory Sort)

**Conditions triggering fast path:**

- Source is NOT a `DatasetRef` (i.e., inline rows)
- Inline rows exist in the context
- Row count ≤ `DATASET_STORAGE.MAX_INLINE_DATASET_ROWS` (typically 5,000)

**Process:**

1. Load all rows into a JavaScript array
2. Apply JavaScript's native `.sort()` with the custom comparator
3. Infer or reuse schema via `inferDatasetSchema()`
4. Apply schema coercion to all rows via `applySchemaToRows()`
5. Persist the sorted rows via `datasetService.persistRowsFromStream()`
6. Return a `DatasetRef` with execution summary

**Memory Profile:** `O(n)` where `n` is the row count (max ~5,000 rows).

**Execution Summary Included:**

```typescript
{
  sourceRows: 5000,
  strategy: "in-memory",
  sortField: "amount",
  direction: "asc",
  compareAs: "number",
  nulls: "last"
}
```

### Slow Path (External Merge Sort)

**Conditions triggering slow path:**

- Source is a `DatasetRef` (chunked on disk)
- Row count exceeds in-memory threshold

**Process:**

1. Create a temporary file manager scoped to the execution and node ID
2. Stream rows from the `DatasetRef` via `streamContextRows(source)`
3. Apply multi-way **external merge sort** via `externalSortRows()`
4. Persist sorted runs to temporary files on disk
5. Merge temporary runs using a k-way heap merge algorithm
6. Stream the merged result back to `datasetService.persistRowsFromStream()`
7. Clean up temporary files
8. Return a `DatasetRef` with execution summary

**Memory Profile:** `O(k)` where `k` is the merge fan-in (typically 32), regardless of total dataset size.

**Key Parameters:**

- `runTargetBytes`: Target size per sort run before spilling to disk (default: 32MB)
- `mergeFanIn`: Maximum number of temporary files to merge simultaneously (default: 32)

---

## 5. External Sort Algorithm (`external-sort.ts`)

The external sort is critical for handling datasets larger than available RAM without crashing the Node.js process.

### Phase 1: Run Generation

1. Stream rows from the source in batches
2. Accumulate rows in memory until the batch reaches `runTargetBytes`
3. Sort the batch in memory
4. Serialize to a temporary file (`.run.jsonl`)
5. Repeat until source is exhausted
6. Result: Multiple sorted runs on disk (`run-0.jsonl`, `run-1.jsonl`, ..., `run-n.jsonl`)

### Phase 2: K-Way Merge

1. Open file handles to all generated runs
2. Initialize a min-heap of size `k` (the merge fan-in)
3. For each run file, read the first row and insert into the heap
4. **Main merge loop:**
   - Pop the smallest row from the heap
   - Yield it to the output stream
   - Read the next row from the same run file
   - Re-insert into the heap if available
   - Repeat until all runs are exhausted

### Complexity Analysis

- **Time**: `O(n log n)` overall (dominated by run generation sort + merge log k)
- **Disk I/O**: `O(n)` reads + `O(n)` writes (one pass through each run)
- **Memory**: `O(k)` (heap + file buffers), independent of `n`

---

## 6. Node-to-Node Data Transfer

Like all heavy CSV nodes, the Sort node adheres to the `DatasetRef` paradigm to avoid passing multi-gigabyte objects through workflow context.

### Output Structure

```typescript
{
  [variableName]: {
    kind: "dataset",
    datasetId: "UUID",
    executionId: "UUID",
    variableName: variableName,
    storage: "jsonl",
    manifestVersion: 1,
    rowCount: sourceRows,
    chunkCount: actualChunkCount,
    byteSize: totalBytes,
    schema: inferred or preserved schema,
    summary: {
      sourceRows,
      strategy: "in-memory" | "external-sort",
      sortField,
      direction,
      compareAs,
      nulls
    }
  }
}
```

### Persistence Flow

1. `datasetService.persistRowsFromStream()` is called with the sorted result generator
2. Rows are batched into chunks of `DEFAULT_CHUNK_SIZE_ROWS` (typically 1,000)
3. Each chunk is serialized to a `.jsonl` file in the execution dataset directory
4. A manifest is generated with chunk metadata (offsets, row counts, checksums)
5. The `DatasetRef` is returned for downstream consumption

---

## 7. Storage & Finalization

After sorting completes, the results follow the standard chunked persistence model:

1. **Chunk Files**: Sorted rows are written to `.jsonl` files in `.autopilot-data/execution-datasets/{executionId}/`
2. **Manifest**: A manifest file tracks chunk locations, row ranges, and checksums
3. **Schema Preservation**: The inferred or source schema is embedded in the manifest
4. **Context Injection**: The `DatasetRef` is merged into the workflow execution context under the specified `variableName`

---

## 8. Scalability & System Safeguards

### A. CPU Concurrency (Redis Heavy Queue)

Sorting is CPU-bound (row comparisons, heap operations). Like CSV Parse and Join, Sort is flagged as a `"heavy"` operation.

- **Queue Profile**: `CSV_SORT` is classified as `"heavy"` in `queue-policy.ts`
- **Concurrency Limit**: The `redis-queue.ts` engine enforces `maxConcurrentHeavyExecutions = 2`
- **Queuing**: Excess Sort requests wait in a Redis FIFO list (`executions:heavy:queue`)

### B. Disk Constraints

- **External Sort Spill**: Temporary runs are written to disk with reserved byte allocation
- **Global Budget**: `MAX_TOTAL_DISK_USAGE_BYTES` (default 4GB) limits total execution data
- **Cleanup**: Temporary files are garbage-collected after sort completion via `TempFileManager`

### C. Memory Safeguards

- **Fast Path Ceiling**: In-memory sorts are capped at 5,000 rows
- **Slow Path Bounded**: External merge sort maintains constant memory at `O(k)` regardless of dataset size
- **Large Array Rejection**: `assertNoLargeArrayOutput` ensures Sort never returns a `>5KB` inline array

---

## 9. UI Layer (`csv-sort/dialog.tsx`)

The Sort configuration dialog is built with React Hook Form and Zod.

### Key Features

- **Field Selection**: Text input for the sort field (no autocomplete currently; schema discovery not yet exposed to frontend)
- **Direction Toggle**: Radio buttons for ascending/descending
- **Type Coercion Selector**: Dropdown for "string", "number", "date"
- **Null Placement**: Dropdown for "first", "last"
- **Output Variable**: Text input for the result variable name
- **Validation**: Zod schema ensures all required fields are non-empty strings

### Form State

```typescript
const formSchema = z.object({
  sourceVariable: z.string().min(1, "Source variable is required"),
  variableName: z.string().min(1, "Variable name is required"),
  sortField: z.string().min(1, "Sort field is required"),
  direction: z.enum(["asc", "desc"]).default("asc"),
  compareAs: z.enum(["string", "number", "date"]).default("string"),
  nulls: z.enum(["first", "last"]).default("last"),
});
```

---

## 10. Execution Summary & Debugging

The Sort node attaches a `summary` object to the output for observability:

```typescript
{
  sourceRows: 65000,              // Total rows processed
  strategy: "external-sort",      // Which algorithm was used
  sortField: "amount",
  direction: "asc",
  compareAs: "number",
  nulls: "last"
}
```

This metadata helps developers understand:

- Whether the sort was memory-bound or disk-bound
- Which field was used and how it was compared
- Whether rows with nulls were prioritized correctly

---

## Conclusion for Production

The CSV Sort node implements enterprise-grade sorting for datasets exceeding RAM capacity, using proven external merge sort algorithms from systems like PostgreSQL and Apache Spark. By combining in-memory optimization for small datasets with disk-based streaming for large ones, it achieves:

- **Correctness**: Stable, type-aware sorting with configurable null handling
- **Safety**: Memory overhead bounded independently of dataset size
- **Performance**: Minimal disk I/O overhead through k-way merge strategies
- **Observability**: Execution summary for debugging and optimization
