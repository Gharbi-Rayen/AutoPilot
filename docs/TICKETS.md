# Engineering Tickets

> See also:
> - [WORKER_BUILDER_GUIDE.md](WORKER_BUILDER_GUIDE.md) — how to create or modify a BullMQ-backed worker node (template, checklists, output formats)
> - [DEPLOYMENT.md](DEPLOYMENT.md) — Railway, Docker, and local dev setup

---

## Track A — Immediate Bug Fixes

### A-001 · Fix csv-join worker: missing completion event on failure

**Priority:** Critical | **Effort:** 30 min | **Status:** Done

**File:** `src/workers/csv-join.worker.ts`

The join worker's `failed` handler now sends `csv/join.complete` with `failed: true` so the executor's `waitForEvent` resolves in seconds instead of hanging 60 minutes.

---

### A-002 · Add explicit timeouts to all BullMQ job additions

**Priority:** Critical | **Effort:** 2 h | **Status:** Done

**Files:** All 5 executor files + `src/lib/worker-queue.ts`

All `queue.add()` calls now pass a `timeout` option set 5 minutes less than the Inngest `waitForEvent` timeout. Zombie jobs are killed and their failure event is sent automatically.

| Executor | Inngest wait | Job timeout |
|---|---|---|
| csv-parse | 30 m | 25 m |
| csv-sort | 60 m | 55 m |
| csv-filter | 60 m | 55 m |
| csv-join | 60 m | 55 m |
| csv-consecutive-sequence | 60 m | 55 m |

---

### A-003 · Fix mprocs.yaml — add all five workers

**Priority:** Critical | **Effort:** 15 min | **Status:** Done

**File:** `mprocs.yaml`

All five workers are now present: parse, sort, filter, join, sequence. Previously only filter was listed, causing silent 60-minute timeouts for every other operation in the default dev environment.

---

## Track B — Performance Hardening

### B-001 · Replace per-call Queue instantiation with module-level singletons

**Priority:** Critical | **Effort:** 3 h | **Status:** Done

**Files:** `src/lib/worker-queue.ts`, all 5 executor files

Created `src/lib/worker-queue.ts` with one singleton `Queue` per operation type. All executors now call `getCsvSortQueue()` etc. instead of `new Queue()` inside `step.run()`. Eliminates per-invocation Redis TCP connection creation.

---

### B-002 · Configure BullMQ stall detection on all workers

**Priority:** High | **Effort:** 1 h | **Status:** Open

**Files:** All 5 worker files

Add to every `Worker` constructor:
```typescript
stalledInterval: 30_000,
maxStalledCount: 1,
lockDuration: 60_000,
```

Currently missing. Without these, a crashed worker leaves a job in "active" state indefinitely and BullMQ's default recovery behaviour is unpredictable.

---

### B-003 · Move resource budget tracking from process memory to Redis

**Priority:** High | **Effort:** 4 h | **Status:** Open

**File:** `src/features/executions/server/resource-budget.ts`

The disk/memory budgets live in a process-level `Map`. Any process restart resets all budgets to zero, allowing a 3.8 GB execution to immediately allocate another 4 GB after a restart.

Replace the `Map` with Redis `INCRBY` / `DECRBY` operations keyed by `exec:budget:{executionId}:{field}`. Add a 48-hour TTL so orphaned executions self-clean.

Note: `reserveDiskUsage` becomes async — all callers in the JSONL adapter must be awaited.

---

### B-004 · Add per-worker memory ceiling flags

**Priority:** High | **Effort:** 2 h | **Status:** Done

**Files:** `package.json`, `ecosystem.config.js`

`ecosystem.config.js` now sets `node_args: "--max-old-space-size=N"` per worker:
- parse: 512 MB, filter: 512 MB, sort: 2048 MB, join: 1024 MB, sequence: 1024 MB

---

### B-005 · Cap the sequence analyzer's in-memory group state Map

**Priority:** High | **Effort:** 1 d | **Status:** Open

**File:** `src/workers/csv-consecutive-sequence.worker.ts`

The `groupStates` Map grows proportionally to unique group keys. 5 million unique groups → OOM crash. Add a configurable ceiling (default 500k groups) via `SEQUENCE_MAX_GROUPS`. When exceeded, throw `UnrecoverableError` with an actionable message telling the user to add a pre-filter.

---

### B-006 · Add Bull Board dashboard for queue visibility

**Priority:** Medium | **Effort:** 4 h | **Status:** Open

**Files:** `src/app/api/queues/route.ts` (new), `src/app/queues/[[...slug]]/page.tsx` (new)

Install `@bull-board/api` and `@bull-board/next`. Register all 5 queues. Protect with an auth check. Expose at `/queues`. This is the only way to inspect failed jobs without `redis-cli`.

---

### B-007 · Replace the home-built execution slot semaphore with BullMQ concurrency

**Priority:** Medium | **Effort:** 2 d | **Status:** Open

**Files:** `src/features/executions/server/redis-queue.ts`, `src/inngest/functions.ts`

Remove `acquireExecutionSlot` / `releaseExecutionSlot` from `functions.ts`. Set `concurrency` on each Worker constructor directly. The 150ms polling loop at 100 concurrent requests generates 666 redundant Redis ops/second.

---

## Track C — Deployment & Infrastructure

### C-001 · Worker deployment

**Priority:** Critical | **Effort:** 1 d | **Status:** Done (see DEPLOYMENT.md)

Workers cannot run on Vercel. Deploy to Railway using the `Dockerfile` + `ecosystem.config.js` + `railway.toml` added in this repo. See [DEPLOYMENT.md](DEPLOYMENT.md) for the full guide.

---

### C-002 · Storage layer abstraction (prerequisite for multi-host)

**Priority:** High | **Effort:** 1 w | **Status:** Open

**Files:** `src/features/executions/server/datasets/storage-provider.ts` (new), all callers of `jsonl-storage-adapter.ts`

`DatasetStorageAdapter` interface already exists. Create a `getStorageAdapter()` provider that selects based on `DATASET_STORAGE_FORMAT`. This is the prerequisite for running workers on a different host from the Next.js server (currently they must share a filesystem).

---

## Quick reference

| Ticket | Status | Priority | Effort |
|---|---|---|---|
| A-001 csv-join fix | Done | Critical | 30 min |
| A-002 BullMQ timeouts | Done | Critical | 2 h |
| A-003 mprocs.yaml | Done | Critical | 15 min |
| B-001 Queue singletons | Done | Critical | 3 h |
| B-002 Stall detection | Open | High | 1 h |
| B-003 Budget in Redis | Open | High | 4 h |
| B-004 Memory ceilings | Done | High | 2 h |
| B-005 Cap group Map | Open | High | 1 d |
| B-006 Bull Board | Open | Medium | 4 h |
| B-007 Remove semaphore | Open | Medium | 2 d |
| C-001 Worker deployment | Done | Critical | 1 d |
| C-002 Storage abstraction | Open | High | 1 w |
