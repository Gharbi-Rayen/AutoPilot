# BullMQ Worker Architecture Assessment — Revised Analysis

> **Original date:** 2026-04-12  
> **Revised:** 2026-04-13  
> **Scope:** All five BullMQ workers (csv-parse, csv-sort, csv-filter, csv-join, csv-consecutive-sequence), their executors, Inngest integration, Redis configuration, and the shared dataset/storage layer.  
> **Revision reason:** Original critique contained a fundamental error about the necessity of the BullMQ layer given Vercel's serverless timeout constraints.

---

## Executive Summary

The system uses a **two-layer queue architecture**: BullMQ for job execution backed by Redis, orchestrated by Inngest acting as a workflow engine. This structure exists for a specific and valid reason: Vercel serverless functions have a maximum invocation time (60 seconds on most plans). CSV operations on large files take 5–30 minutes. The BullMQ worker layer runs *outside Vercel* on persistent compute, and is the only architecturally correct way to escape that timeout ceiling.

However, while the structural choice is sound, the **operational implementation** has compounding problems across connection management, failure semantics, memory safety, and observability that become worse as more workers are added. Several of these issues are dangerous in production today. Additionally, the architecture has a **critical unresolved question**: where do workers run in production?

---

## The Core Constraint: Why BullMQ Is Not Redundant

When an Inngest step runs via `step.run()`, that code executes **inside a Vercel serverless function invocation**. The invocation cannot last more than 60 seconds. A CSV sort of a 400MB file takes 5–30 minutes. You cannot run that inside `step.run()`.

The executor pattern solves this correctly:

```
step.run("enqueue-csv-sort")
  → enqueues BullMQ job        ← returns in ~50ms, Vercel is satisfied
  → Inngest records step completion

step.waitForEvent("wait-for-csv-sort-complete", timeout: "60m")
  → Inngest parks workflow state on its own servers
  → NO Vercel function is running during this wait
  → BullMQ worker (separate persistent process, not Vercel) does the actual work
  → worker sends completion event
  → Inngest wakes the workflow, next step begins
```

**The long-term suggestion to "collapse BullMQ into Inngest `step.run()`" would restore the original 60-second timeout bug.** Do not do this while the app is hosted on Vercel. It is only safe if the application moves to a platform with long-running compute (VPS, Railway, Fly.io running everything in a single server).

---

## Critical Gap: Worker Deployment Is Undefined

This is the most important issue not addressed in the original critique.

The BullMQ workers are long-running Node.js processes. **Vercel does not support long-running processes.** Currently:

- `mprocs.yaml` runs workers locally alongside `next dev` — dev only
- `package.json` scripts all use `tsx watch` — dev only
- There is no Dockerfile, no Railway/Fly.io service definition, no cloud-run spec, no PM2 ecosystem file, nothing

**If the app is deployed to Vercel without workers deployed elsewhere, every CSV sort/parse/filter/join/sequence operation hangs silently for 30–60 minutes then fails.** The workers are the entire compute backend.

The local filesystem dependency (`DATASET_STORAGE_ROOT=C:/autopilotdata`) adds a further constraint: workers must share the same filesystem as the storage root. This means they must run on the same machine as the storage volume, or that volume must be a network mount accessible to both the worker host and the app server.

**Required decision before any production deployment:** choose a worker host (VPS with PM2, Railway background service, Fly.io machine, etc.) and add the corresponding deployment configuration.

---

## 1. Redis Connection Proliferation — Active Danger

Every time an executor fires, it runs this inside `step.run()`:

```typescript
// Inside executor, inside step.run(), called per-job
const connection = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue("csv-sort", { connection });
await queue.add("sort", { ... });
await queue.close();
```

A `new Queue()` opens a dedicated ioredis connection. This is wrong at scale:

- Each call opens a TCP connection, negotiates, authenticates, then tears down. Under real traffic this thrashes Redis's connection table.
- ioredis does not pool connections. Every `new Queue()` is a cold connection.
- If `queue.close()` is never reached (exception before it, Inngest step retry, process kill), the connection leaks for the lifetime of Redis's idle timeout.
- The five workers each hold **two permanent ioredis connections** internally. Running all five means **10 permanent connections** plus N transient connections from in-flight executor steps.

**Fix:** a module-level singleton Queue and Redis connection per executor file, created once at module load and reused across all calls.

---

## 2. The Inngest–BullMQ Timeout Incoherence

BullMQ jobs have **no configured timeout**. Inngest waits 30m (parse) or 60m (sort/filter/join/sequence). Two failure modes:

**Scenario A — Worker gets stuck:** A sort job enters a loop. BullMQ never marks it failed. Inngest timeout fires. The workflow aborts, but the BullMQ job keeps running indefinitely. Redis has a stale "active" entry. When the BullMQ lock expires, the job is re-queued. A second copy runs concurrently with the zombie first copy. Both write to the same dataset. One corrupts the other's output.

**Scenario B — Queue backup:** Two sort jobs are processing. Three more arrive and queue. Inngest's 60-minute clock starts when the job is **enqueued**, not when it **starts processing**. If queue wait time + processing time exceeds 60 minutes, Inngest aborts a workflow whose job completed correctly. The completion event arrives after Inngest abandoned the executionId and is silently dropped. The user sees a failed workflow; the dataset was fully computed but never attached.

---

## 3. The Dual-Event Failure Signalling Pattern

When a job fails, workers send both events:

```typescript
worker.on("failed", async (job, error) => {
  await inngest.send({ name: "csv/sort.failed", ... }); // dead noise
  await inngest.send({ name: "csv/sort.complete", data: { ..., failed: true } }); // this one matters
});
```

The executor's `waitForEvent` only listens for `.complete`. The `.failed` event is **dead noise on the event bus** for every failure — registered, consuming capacity, never handled.

More critically: if Inngest replays a step during recovery, the step re-enqueues a fresh BullMQ job. Combined with failure retry logic, each Inngest step retry can enqueue a new BullMQ job before receiving a result, queuing the same operation multiple times.

---

## 4. csv-join Failure Asymmetry — Active Bug

All other workers send `csv/{op}.complete` with `failed: true` on failure. The join worker sends **only** `csv/join.failed`, never `csv/join.complete`:

```typescript
// csv-join worker — failure path
worker.on("failed", async (job, error) => {
  await inngest.send({ name: "csv/join.failed", data: { executionId, reason } });
  // No csv/join.complete sent — executor waitForEvent never resolves
});
```

When a join job fails, the executor hangs for the full 60-minute timeout before the user sees an error. This is a direct regression versus all other workers.

---

## 5. Memory Architecture — Unbounded Growth Scenarios

**Sequence analyzer group Map:**

```typescript
const groupStates = new Map<string, SequenceState>();
```

For a dataset with 5 million unique group keys, this Map holds 5 million SequenceState objects in heap. No eviction, no spill-to-disk, no size limit. V8 will OOM-kill the worker process around 4 GB, orphaning all in-flight jobs for that queue.

**Resource budget in process memory:**

```typescript
// src/features/executions/server/resource-budget.ts
const executionBudgets = new Map<string, ResourceBudgetState>();
```

This Map lives in the Next.js server process heap. Any process restart (serverless cold start, deployment, crash) resets all budget tracking to zero. An execution that consumed 3.8 GB of a 4 GB budget will have its budget reset, allowing another 4 GB allocation immediately — doubling consumption to 7.8 GB before any limit fires. On serverless deployments this is guaranteed to fail.

**Aggregate concurrent memory:**

All five workers share one Node.js process when run via `npm run dev:all`. A sort on 400 MB can spike to 1–2 GB of heap. Combined with a sequence analyzer on a heavily-grouped dataset, both compete for the same heap. V8's GC thrashes. Under peak load the worker process OOM crashes, killing all five queues simultaneously.

---

## 6. Scale Ceiling

**Local filesystem — hard blocker for multi-host:**

```
DATASET_STORAGE_ROOT=C:/autopilotdata
```

Dataset chunks are written to the local filesystem of whatever machine the worker runs on. Two workers on two machines cannot share this. Horizontal scaling of workers is architecturally impossible without replacing the storage layer.

**Home-built slot semaphore:**

`MAX_CONCURRENT_HEAVY_EXECUTIONS: 2` is enforced via a Redis FIFO queue with poll-based slot acquisition every 150 ms. Under 100 concurrent workflow requests: 666 Redis operations per second for slot management alone. BullMQ's own concurrency primitives (`concurrency` on the Worker constructor) solve this without polling.

**Progress event routing:**

Every sort/filter progress event travels Worker → Inngest event bus → relay function → FileChannel → SSE to client. Progress events use `.catch(() => {})` — under Inngest rate limiting they are silently dropped with no indication to the user.

---

## 7. Observability — Near Zero

- No BullMQ dashboard (Bull Board, Arena, or similar)
- No dead letter queue handling — failed jobs sit in BullMQ's `failed` set indefinitely
- No structured log correlation between Inngest execution ID and BullMQ job ID
- No queue depth or wait-time metrics
- No alert when a job has been `active` beyond a threshold
- `console.error` to stdout only — no aggregation in container environments

---

## 8. The `tsx watch` Problem

```json
"worker:sort": "cross-env DATASET_STORAGE_ROOT=... tsx watch src/workers/csv-sort.worker.ts"
```

`tsx watch` restarts the worker process on any source file change. When the worker restarts mid-job:

1. The BullMQ job lock expires (30-second default, unconfigured)
2. BullMQ marks the job stalled and re-queues it
3. The restarted worker picks it up and restarts from scratch
4. Any partial dataset writes are orphaned JSONL chunks with no manifest (cleanup is a separate manual API call)

In production this must be `tsx` without `--watch`, or compiled JavaScript with `node`.

---

## 9. mprocs.yaml Missing Four Workers

```yaml
# Current mprocs.yaml — only filter is present
procs:
  next:    cmd: ["npm", "run", "dev"]
  inngest: cmd: ["npm", "run", "inngest:dev"]
  filter:  cmd: ["npm", "run", "worker:filter"]
  redis:   cmd: ["docker", "run", ...]
```

Any developer starting the environment with mprocs will see silent 60-minute timeouts for parse, sort, join, and sequence operations with no error or explanation.

---

## 10. Revised Severity Matrix

| Issue | Severity | Description |
|---|---|---|
| Worker deployment undefined | **Critical** | Workers cannot run on Vercel. Nothing computes in production without a separate deployment. |
| New Queue connection per executor call | **Critical** | Redis connection exhaustion under moderate load |
| No BullMQ job timeout configured | **Critical** | Zombie jobs, double-execution, dataset corruption on stall recovery |
| Local filesystem — no horizontal scale | **Critical** | Architecturally impossible to run workers on more than one machine |
| Resource budget in process memory | **High** | Budget resets to zero on any process restart |
| Inngest / BullMQ timeout incoherence | **High** | Fully-computed datasets silently discarded on queue backup |
| All workers sharing single Node.js process | **High** | Single OOM event kills all five queues simultaneously |
| Sequence analyzer unbounded group Map | **High** | OOM on large grouped datasets |
| csv-join missing `.complete` on failure | **High** | 60-minute hang before user sees an error — active bug |
| mprocs.yaml missing 4 of 5 workers | **Medium** | Silent 60-minute timeouts in the default dev environment |
| Dual complete/failed event pattern | **Medium** | Potential retry storm on Inngest step replay |
| No dead letter queue or BullMQ dashboard | **Medium** | Completely blind to failures in production |
| Home-built semaphore for slot management | **Medium** | 666+ redundant Redis ops/sec under moderate load |
| Progress events fire-and-forget | **Low** | Silently dropped under Inngest rate limiting |
| `tsx watch` in worker scripts | **Low** | In-flight job orphaned on any file save during development |

---

## 11. Corrected Remediation Path

**Do NOT collapse BullMQ into `step.run()`** while the application is hosted on Vercel. The offload pattern is load-bearing.

1. **Immediate:** Fix csv-join worker to send `csv/join.complete` with `failed: true` on failure.

2. **Immediate:** Add explicit `timeout` to every `queue.add()` call (55 minutes for 60-minute Inngest waits; 25 minutes for 30-minute waits). Configure BullMQ stall detection (`stalledInterval`, `maxStalledCount`).

3. **Immediate:** Fix mprocs.yaml to include all five worker processes.

4. **Short-term:** Replace per-call `new Queue()` + `new Redis()` with module-level singleton instances in each executor file.

5. **Short-term:** Move the resource budget map from process memory into Redis, keyed by executionId.

6. **Short-term:** Add `--max-old-space-size` per worker type via separate npm scripts. Each worker type should have its own memory ceiling.

7. **Short-term:** Commit to a worker deployment host and add the deployment configuration (Dockerfile, Railway service, PM2 ecosystem file, etc.).

8. **Medium-term:** Add a BullMQ dashboard (Bull Board) behind auth. Instrument queue depth, job latency, and failure rate.

9. **Medium-term:** Cap the sequence analyzer's in-memory group Map. Spill group states to a temporary dataset on disk once a configurable group count threshold is reached.

10. **Medium-term:** Abstract the storage layer behind an interface with local-filesystem and S3-compatible implementations. This is the prerequisite for running workers on a separate host and for the desktop app offline track.

11. **Long-term (if moving off Vercel to a single persistent server):** At that point, collapsing BullMQ becomes viable. Each operation would use a dedicated `step.run()` that can run for as long as needed. The entire Redis/BullMQ/worker-process layer is removed. This is a large architectural change that only makes sense if the hosting constraint changes.
