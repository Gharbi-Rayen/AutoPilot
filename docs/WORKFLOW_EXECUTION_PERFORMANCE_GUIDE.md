# Workflow Execution Performance Guide

This guide explains why manual workflow triggers feel slow and how to optimize them.

It includes before/after code examples based on your current implementation.

## Why execution feels slow

In your current flow, one click does all of this:

1. Save the entire workflow graph.
2. Create execution record.
3. Register queue state.
4. Send event to Inngest.
5. Wait for heavy queue slot when needed.

For workflows with large node data (especially file uploads), the save step is often the biggest delay.

---

## 1) Skip save-on-run when graph is unchanged

### Before (always saves before execute)

```tsx
// src/features/editor/components/execute-workflow-button.tsx
await saveWorkflow.mutateAsync({
  id: workflowId,
  nodes,
  edges,
});

const workflowExecution = await executeWorkflow.mutateAsync({
  id: workflowId,
});
```

### After (save only when changed)

```tsx
import stableStringify from "fast-json-stable-stringify";
import { useRef } from "react";

const lastSavedSignatureRef = useRef<string>("");

const snapshot = { nodes, edges };
const signature = stableStringify(snapshot);

if (signature !== lastSavedSignatureRef.current) {
  await saveWorkflow.mutateAsync({
    id: workflowId,
    nodes,
    edges,
  });
  lastSavedSignatureRef.current = signature;
}

const workflowExecution = await executeWorkflow.mutateAsync({
  id: workflowId,
});
```

### Why this helps

If the user runs the same workflow repeatedly, trigger latency drops because the heavy save call is skipped.

---

## 2) Do not store file bytes in workflow node data

### Before (stores full base64 in node data)

```tsx
// src/features/executions/components/upload-file/dialog.tsx
const filePayload = selectedFile
  ? {
      name: selectedFile.name,
      mimeType: selectedFile.type || "application/octet-stream",
      size: selectedFile.size,
      lastModified: selectedFile.lastModified,
      contentBase64: await fileToBase64(selectedFile),
    }
  : hasPersistedFile
    ? defaultValues.file
    : undefined;
```

### After (store only reference)

```tsx
// 1) Upload file once to an API endpoint and receive a reference
const uploaded = await uploadFileToStorage(selectedFile);

// 2) Persist only metadata + reference in workflow node data
const filePayload = uploaded
  ? {
      fileRef: uploaded.fileRef,
      name: uploaded.name,
      mimeType: uploaded.mimeType,
      size: uploaded.size,
    }
  : hasPersistedFile
    ? defaultValues.file
    : undefined;
```

### Why this helps

Workflow save payload becomes tiny. This removes the largest delay in manual trigger for file-heavy workflows.

---

## 3) Replace full graph rewrite with patch updates

### Before (delete all, recreate all)

```ts
// src/features/workflows/server/routers.ts
await tsx.node.deleteMany({ where: { workflowId: id } });

await tsx.node.createMany({
  data: nodes.map((node) => ({
    id: node.id,
    workflowId: id,
    name: node.type,
    type: node.type,
    position: node.position,
    data: node.data || {},
  })),
});

await tsx.connection.createMany({
  data: edges.map((edge) => ({
    workflowId: id,
    fromNodeId: edge.source,
    toNodeId: edge.target,
    fromOutput: edge.sourceHandle || "main",
    toInput: edge.targetHandle || "main",
  })),
});
```

### After (diff + patch)

```ts
// Pseudocode inside transaction
const existingNodes = await tsx.node.findMany({
  where: { workflowId: id },
  select: { id: true },
});

const existingNodeIds = new Set(existingNodes.map((n) => n.id));
const incomingNodeIds = new Set(nodes.map((n) => n.id));

// Delete removed nodes only
await tsx.node.deleteMany({
  where: {
    workflowId: id,
    id: { notIn: [...incomingNodeIds] },
  },
});

// Upsert changed/new nodes
for (const node of nodes) {
  await tsx.node.upsert({
    where: { id: node.id },
    update: {
      name: node.type,
      type: node.type,
      position: node.position,
      data: node.data || {},
    },
    create: {
      id: node.id,
      workflowId: id,
      name: node.type,
      type: node.type,
      position: node.position,
      data: node.data || {},
    },
  });
}
```

### Why this helps

Large workflows no longer pay full rewrite cost on every small edit.

---

## 4) Increase heavy execution throughput

### Before

```ts
// src/config/constants.ts
MAX_CONCURRENT_HEAVY_EXECUTIONS: toPositiveInteger(
  process.env.DATASET_MAX_CONCURRENT_HEAVY_EXECUTIONS,
  1,
),
EXECUTION_QUEUE_POLL_INTERVAL_MS: toPositiveInteger(
  process.env.DATASET_EXECUTION_QUEUE_POLL_INTERVAL_MS,
  500,
),
```

### After (recommended starting point)

```env
# .env.local
DATASET_MAX_CONCURRENT_HEAVY_EXECUTIONS=2
DATASET_EXECUTION_QUEUE_POLL_INTERVAL_MS=150
```

### Why this helps

Heavy workflows stop waiting in a single-file queue as often.

---

## 5) Replace file-based queue state with a real queue backend

### Before (disk read/write each mutation)

```ts
const raw = await readFile(getQueueStatePath(), "utf-8");
await writeFile(getQueueStatePath(), JSON.stringify(state, null, 2), "utf-8");
```

### After (BullMQ example)

```ts
import { Queue, Worker } from "bullmq";

const heavyQueue = new Queue("heavy-executions", {
  connection: { host: process.env.REDIS_HOST, port: 6379 },
});

await heavyQueue.add(
  "execute",
  { executionId, workflowId },
  {
    jobId: executionId,
    removeOnComplete: true,
    attempts: 1,
  },
);

new Worker(
  "heavy-executions",
  async (job) => runExecution(job.data.executionId),
  {
    connection: { host: process.env.REDIS_HOST, port: 6379 },
    concurrency: 2,
  },
);
```

### Why this helps

You remove file lock contention and polling overhead while getting robust concurrency controls.

---

## 6) Move dataset cleanup out of hot path

### Before

```ts
// DatasetService.beginWrite()
await this.ensureStartupCleanup();
```

### After

```ts
// Keep beginWrite fast
// Run cleanup from scheduled background task instead

// scripts/cleanup-datasets.ts
await cleanupExecutionDatasets({ dryRun: false });
```

Use a scheduler (cron, Inngest scheduled job, or platform scheduler) to run cleanup periodically.

### Why this helps

First execution after server startup no longer pays cleanup scanning cost.

---

## Recommended dependencies

Based on queue and data processing options:

- `bullmq` + `ioredis`: high-throughput Redis queue with concurrency controls.
- `pg-boss`: Postgres-native queue if you prefer one datastore.
- `fast-csv`: stream-first CSV parser for large inputs.
- `apache-arrow`: columnar in-memory processing for heavy analytics pipelines.
- `@duckdb/node-api`: local analytical SQL engine for larger dataset transforms.

Install examples:

```bash
npm i bullmq ioredis
npm i pg-boss
npm i fast-csv
npm i apache-arrow
npm i @duckdb/node-api
```

---

## Rollout order (highest impact first)

1. Remove base64 from workflow node storage.
2. Skip save on execute when unchanged.
3. Patch-based workflow updates instead of full rewrite.
4. Raise heavy concurrency to 2 and reduce poll interval.
5. Move queue state to BullMQ or pg-boss.
6. Move dataset cleanup to background schedule.

---

## Validation checklist

Track these metrics before and after:

- Manual trigger latency (button click to executionId response).
- Queue wait time for heavy workflows.
- Total execution duration.
- Save workflow API duration.
- Database write size for workflow updates.
- Memory usage during CSV parse.

A good first target is reducing manual trigger latency by at least 50% on repeated runs of unchanged workflows.
