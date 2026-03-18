# CSV Aggregate Investigation Report

## Intro: Testing Scenario Executed

We ran the CSV node test flow using the following chain:

1. Manual Trigger
2. Upload File (`telecomFile`)
3. CSV Parse (`telecomParsed`)
4. Code (`telecomAnalysis`)
5. CSV Aggregate Node 5 (group by `week_start`)
6. CSV Aggregate Node 6 (group by `week_start`)

Both aggregate nodes were visually configured to read from `telecomAnalysis`.

## Observed Runtime Outputs

### Code node output

- `rowCount = 30`
- Rows contain `date`, `revenue`, `active_users`, `week_start`
- Rows contain `new_users = null` and `churned_users = null`

### Aggregate Node 5 output

- `rowCount = 6`
- Grouping by `week_start` worked
- `value = null` for every week

### Aggregate Node 6 output

- Error:
  - `NonRetriableError: Source variable must contain CSV records`

## Root-Cause Analysis

### Cause A: Null target fields in Node 5

Node 5 used `sum` over fields (`new_users` / `churned_users`) that are null in the code output rows. This results in aggregate `value = null`.

This is expected behavior given the observed payload.

### Cause B: Misleading error for Node 6 source lookup

The previous executor behavior returned the same generic error when:

- source variable was missing from context, or
- source existed but had no `records` array.

This can hide configuration issues such as:

- hidden whitespace in source variable name,
- stale saved data in node configuration,
- runtime mismatch between expected and actual context key.

## Code Investigation and Changes Applied

To make this diagnosable and reduce false negatives, we updated executors:

- Trimmed key config values before use (`variableName`, `sourceVariable`, `groupBy`, `targetField`, join keys/variables).
- Added explicit context-key existence checks before resolving records.
- Improved error messages to include missing variable name and available context keys.
- Kept existing record-shape validation (`array` or object with `records` array).

### Updated file

- `src/features/executions/components/stubs/executors.ts`

## Why This Likely Fixes the Reported Failure

If Node 6 had a subtle mismatch in source variable key, the runtime now throws a precise "source variable not found" error with available keys instead of the previous generic "must contain CSV records" message.

That makes it clear whether this is:

- a data-shape issue, or
- a context-key/config issue.

## Recommended Retest Matrix

### Retest A: Revenue/Active dataset branch

Use existing code output and aggregate fields that are present:

- Node 5: `sum(revenue)` by `week_start`
- Node 6: `avg(active_users)` by `week_start`

Expected:

- both aggregates succeed,
- both return numeric `value`.

### Retest B: Churn/New Users branch

Use usage dataset branch where those fields exist:

- Node 5: `sum(new_users)` by `week_start`
- Node 6: `sum(churned_users)` by `week_start`

Expected:

- both aggregates succeed,
- both return numeric `value`.

## Additional Notes

- If a field is null in the input records, `sum`/`avg` for that field will produce null.
- For this scenario, Node 5 null values are data-content related, not an aggregate-engine failure.
- Node 6 failure signature strongly suggested source-context resolution ambiguity, now addressed with explicit checks and diagnostics.
