# Context Accumulation Fix Report

## Root Cause Discovery

The investigation into the failure of `Node 6 (CSV Aggregate)` revealed a critical logic error in the workflow execution engine (`src/inngest/functions.ts`).

### The Scenario

1. **Node 4 (Code)** executes and outputs `{ "telecomAnalysis": [...] }`.
   - Context at end of step: `{ "telecomAnalysis": ... }`
2. **Node 5 (Aggregate)** executes.
   - It reads `telecomAnalysis` from the context (which exists).
   - It calculates revenue and returns `{ "telecomWeeklyRevenue": ... }`.
   - **THE BUG:** The engine correctly receives the output, but **overwrites** the entire context with just this new output.
   - Context at end of step: `{ "telecomWeeklyRevenue": ... }` (Original `telecomAnalysis` is lost!)
3. **Node 6 (Aggregate)** executes.
   - It attempts to read `telecomAnalysis`.
   - The context only contains `telecomWeeklyRevenue`.
   - **Result:** `NonRetriableError: Source variable 'telecomAnalysis' not found... Available keys: telecomWeeklyRevenue`.

### Why this explains all symptoms

- **Node 5 worked:** It ran _before_ the context was cleared (or was the first to run after Node 4).
- **Node 6 failed:** It ran _after_ Node 5 had wiped the context.
- **Available keys message:** The error explicitly listed `telecomWeeklyRevenue` as the _only_ available key, confirming that `telecomAnalysis` had been removed.
- **Variable confusion:** The user noted Node 5 output as valid, but Node 6 failed even though they share the same parent. This is the classic signature of a "destructive read" or context-clobbering bug in a sequential execution engine.

## The Fix

We modified `src/inngest/functions.ts`:

**Before:**

```typescript
context = await executor({ ... }); // Replaces context with new output
```

**After:**

```typescript
const output = await executor({ ... });
context = { ...context, ...output }; // Merges new output into existing context
```

## Solution Verification

- **Logic:** The fix ensures that variables created by upstream nodes (like Node 4) persist for _all_ downstream nodes (Nodes 5, 6, 7...), not just the immediate next one.
- **Safety:** This change is purely additive. It ensures workflows behave as DAGs (Directed Acyclic Graphs) where all upstream outputs are available to all downstream nodes.

## Next Steps

Please re-run your workflow. Both Node 5 and Node 6 should now successfully execute, as they will both have access to `telecomAnalysis`.
