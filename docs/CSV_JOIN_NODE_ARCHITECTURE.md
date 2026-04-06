# CSV Join Node System Architecture & Logic

This document details the complete architecture, data flow, and underlying algorithms powering the "Join CSV Datasets" workflow node. This node merges two distinct datasets (Left and Right variables) generated in preceding workflow steps.

---

## 1. High-Level Execution Flow

When a workflow execution hits the `csv-join` node, the backend transitions through the following distinct phases:

1. **Context Resolution**: Retrieves the literal data or `DatasetRef` (pointers to persisted dataset chunks) for both Left and Right variables.
2. **Cardinality Estimation**: Samples both datasets to estimate uniqueness, skewness, and overall memory risk.
3. **Query Planning**: Uses the estimation to build an execution strategy (e.g., which dataset goes into memory, whether to partition, which algorithmic strategy to use).
4. **Algorithmic Execution (Yielding)**: Merges the rows using the chosen algorithm (`Hash Join` or `Cross Join / Nested Loop`).
5. **Persistence**: Streams the merged results via the `datasetService.persistRowsFromStream()` in memory-safe chunks back to the datastore.

---

## 2. Frontend / UI Layer (`csv-join/dialog.tsx`)

The UI is built with React Hook Form and Zod for strict validation.

- **Dynamic Validations ([Zod `superRefine`])**: 
  Standard joins (Inner, Left, Right, Full, etc.) require exact key mapping. Therefore, Zod throws an error if `leftKey` or `rightKey` are missing. However, if the user selects a **Cross Join**, this validation is bypassed dynamically.
- **Dynamic Rendering**: Using `form.watch("joinType")`, the UI hides the `Left Key` and `Right Key` inputs entirely when "Cross Join" is selected to avoid user confusion.
- **Output Variable**: Dictates the dictionary key under which the newly merged dataset will be saved in the workflow context.

---

## 3. Supported Join Types

| Join Type | Description | Algorithm |
| :--- | :--- | :--- |
| **Inner Join** | Returns only rows where the keys match in both datasets. | Hash Join |
| **Left Join** | Returns all rows from the Left dataset, and matched rows from the Right (with `null` padding for missing rights). | Hash Join |
| **Right Join** | Returns all rows from the Right dataset, and matched rows from the Left. | Hash Join |
| **Full Outer** | Returns all rows from both datasets, patching with `null`s where matches aren't found. | Hash Join |
| **Left Exclusive** | Returns rows from the Left dataset that *do not* have a match in the Right dataset. | Hash Join |
| **Right Exclusive** | Returns rows from the Right dataset that *do not* have a match in the Left dataset. | Hash Join |
| **Cross Join** | Cartesian product. Every row on the Left is matched with every row on the Right. No keys required. | Nested Loop |

---

## 4. Cardinality Estimator (`cardinality-estimator.ts`)

Before any heavy lifting occurs, the node runs an estimation step (`csv-join-estimate`) to prevent accidental Out-Of-Memory (OOM) crashes on the server.

1. **Sampling**: Reads up to 100 rows (or `JOIN_CARDINALITY_SAMPLE_ROWS`) from the start of both datasets.
2. **Metrics Calculated**:
   - `distinctRatio`: Uniqueness of the join keys. A ratio of `1.0` means every key is completely unique.
   - `skewRatio`: The size of the largest key bucket vs. the total sample size. Detects "hot keys" (e.g., joining on a boolean where 99% of rows are `true`).
   - `estimatedFanout`: (Total Left / Estimated Left Distinct) * (Total Right / Estimated Right Distinct). Predicts the combinatorial explosion of the join.
3. **Risk Assignment**:
   - `High Risk`: Triggered if the fanout is massive, or if the data exhibits both high skew and low cardinality (creating massive cartesian products internally). Execution reverts to a `reject` strategy.
   - `Low/Medium Risk`: Allows the join to proceed, outputting memory warnings if skew is detected.
4. **Cross Join Bypass**: Cross joins are mathematically deterministic (`Left Rows * Right Rows`). If the user configures a Cross Join, the estimator bypasses sampling entirely and maps the fanout directly.

---

## 5. Join Planner (`join-planner.ts`)

The Query Planner takes the estimator's results and formulates a `JoinPlan`.

- **Build vs. Probe Side**: For Hash Joins, one dataset must be loaded into a Hash Map (the "Build Side"), while the other streams through it one-by-one (the "Probe Side"). 
- **Optimization**: The planner evaluates row counts to select the *smaller* dataset as the Build Side to optimize V8 heap memory.
- **Large-Large Rejection**: If both sides exceed `JOIN_SMALL_SIDE_MAX_ROWS`, the planner will block execution unless `allowPartitionedLargeJoin` is explicitly flagged.
- **Strategy Output**: Instructs the executor to use either `"hash"` (standard) or `"nested_loop"` (cross joins).

---

## 6. Execution Algorithms

The node relies on asynchronous generators (`async function*`) to stream data without loading massive Arrays into RAM.

### Strategy A: Hash Join (`hash-join.ts`)
Used for all conditional joins mapping an X key to a Y key.
1. **Materialization**: Streams the selected "Build Side" into memory and builds a `Map<string, IndexedRow[]>`. 
2. **Probing**: Iterates asynchronously over the "Probe Side". For each row, it queries the Map using the Probe Key.
3. **Yielding Matches**: If matches are found, it uses a custom `mergeRows` function to concatenate the dictionaries. If field names collide, the Right side field is prefixed (e.g., `right_id`).
4. **Null Padding**: Evaluates the `requiresProbeUnmatchedOutput` and `requiresBuildUnmatchedOutput` rules. (e.g., If it's a Left Join, and a Left probe row yields 0 matches, it uses `withRightNulls()` to emit the row padded with `null`s for the missing Right columns).

### Strategy B: Nested Loop Cross Join (`cross-join.ts`)
Used exclusively when `joinType === "cross"`. No keys are processed.
1. **Materialization**: Pulls the entire Right dataset into an array in memory.
2. **Nested Iteration**: Uses an async stream over the Left dataset. Inside that loop, it synchronously iterates over the entire materialized Right array.
3. **Merging**: Unconditionally merges `LeftRow + RightRow` and yields the execution block. 

---

## 7. Storage / Finalization

1. Outputs from the Generator functions (`yield row`) are piped into `datasetService.persistRowsFromStream()`.
2. This service aggregates rows up to `DEFAULT_CHUNK_SIZE_ROWS`.
3. Once a chunk hits the capacity limit, it writes to the underlying storage (e.g., S3/Blob storage or database byte storage), minimizing inline memory requirements.
4. Returns a `DatasetRef` (a manifest array of pointers referencing those chunks) packaged into the workflow context under the user's defined output variable name.