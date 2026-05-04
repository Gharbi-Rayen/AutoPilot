/**
 * FILE: src/lib/db.ts
 *
 * PURPOSE:
 *   Defines the application's IndexedDB database schema and exports a single,
 *   shared database instance (`db`) used everywhere in the codebase.
 *
 * WHAT IS IndexedDB?
 *   IndexedDB is a database built into every modern browser.  It lets web pages
 *   store structured data (JavaScript objects) persistently on the user's device.
 *   Data survives page refreshes, browser restarts, and even being offline.
 *
 *   Think of it like a small SQLite database that lives inside the browser tab.
 *   Unlike localStorage (which only stores strings), IndexedDB can store
 *   complex objects, arrays, dates, and even ArrayBuffers.
 *
 * WHAT IS DEXIE?
 *   Dexie is a JavaScript library that wraps the raw IndexedDB API in a much
 *   cleaner, Promise-based interface.  The raw IndexedDB API is famously hard
 *   to use — it requires callbacks, transactions, and error handling at every step.
 *   Dexie makes the same operations look like simple async function calls.
 *
 *   Raw IndexedDB:
 *     const req = db.transaction("workflows").objectStore("workflows").get("abc");
 *     req.onsuccess = (e) => console.log(e.target.result);
 *
 *   Dexie:
 *     const workflow = await db.workflows.get("abc");
 *
 * WHAT IS STORED IN IndexedDB vs OPFS?
 *   IndexedDB stores METADATA — small, structured records:
 *     workflows, nodes, edges, execution status, dataset manifests.
 *   OPFS stores ROW DATA — large, sequential files:
 *     the actual CSV rows in chunk-000000.json, chunk-000001.json, etc.
 *
 *   This split keeps IndexedDB fast (only small records) and uses OPFS for
 *   the heavy lifting (large binary data reads/writes).
 *
 * USED IN:
 *   src/lib/execution-engine.ts — writes execution records, node outputs, datasets.
 *   src/lib/opfs.ts             — reads dataset records to validate orphan cleanup.
 *   src/features/workflows/hooks/use-workflows.ts — CRUD for workflow records.
 *   src/features/executions/hooks/use-executions.ts — queries execution records.
 */

import Dexie, { type Table } from "dexie";
import type { NodeType } from "@/types/node-type";
import type { DatasetManifest } from "@/types/dataset";

// ─── Record type definitions ──────────────────────────────────────────────────

/**
 * WorkflowRecord
 *
 * WHY THIS EXISTS:
 *   Represents a saved workflow in the database.  A workflow is a named
 *   collection of nodes and edges.  Only the top-level metadata (id, name,
 *   timestamps) lives here; the nodes and edges have their own tables.
 *
 * USED IN:
 *   AutoPilotDB.workflows table.
 *   src/features/workflows/hooks/use-workflows.ts — create/read/update/delete.
 *
 * FIELD MEANINGS:
 *   id        — unique identifier (cuid2 string), used as the primary key.
 *   name      — user-given name (e.g. "Monthly Sales Report Pipeline").
 *   createdAt — ISO 8601 timestamp when the workflow was first created.
 *   updatedAt — ISO 8601 timestamp of the last modification (auto-saved by editor).
 */
export interface WorkflowRecord {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * WorkflowNodeRecord
 *
 * WHY THIS EXISTS:
 *   Stores one node from a workflow.  A workflow can have many nodes, so
 *   instead of embedding them inside WorkflowRecord (which would make the
 *   workflow record huge), they each get their own row in this table.
 *
 * USED IN:
 *   AutoPilotDB.workflowNodes table.
 *   src/features/workflows/hooks/use-workflows.ts — bulk add/delete on auto-save.
 *   src/features/editor/components/editor.tsx — loaded to reconstruct the canvas.
 *
 * FIELD MEANINGS:
 *   id         — unique node identifier (cuid2); also used by ReactFlow as node.id.
 *   workflowId — foreign key linking this node to its parent WorkflowRecord.
 *   type       — NodeType enum value (e.g. "CSV_SORT") — which kind of node this is.
 *   position   — {x, y} pixel coordinates on the ReactFlow canvas.
 *   data       — arbitrary JSON config set by the node's dialog form (e.g. sort columns,
 *                filter conditions, output variable name).
 *
 * WHAT IS A "FOREIGN KEY"?
 *   A foreign key is a field whose value matches the primary key of another table.
 *   workflowId = WorkflowRecord.id means "this node belongs to that workflow".
 *   When you delete a workflow, you also delete all workflowNodes where
 *   workflowId === the deleted workflow's id.
 */
export interface WorkflowNodeRecord {
  /** cuid2 */
  id: string;
  workflowId: string;
  type: NodeType;
  position: { x: number; y: number };
  /** arbitrary node config (filter field, sort column, etc.) */
  data: Record<string, unknown>;
}

/**
 * WorkflowConnectionRecord
 *
 * WHY THIS EXISTS:
 *   Stores one edge (connection) between two nodes in a workflow.
 *   An edge says "the output of node A feeds into the input of node B".
 *   Edges are stored separately from nodes so they can be queried by either
 *   endpoint (find all edges coming FROM nodeX, or all edges going TO nodeY).
 *
 * USED IN:
 *   AutoPilotDB.workflowConnections table.
 *   src/features/workflows/hooks/use-workflows.ts — bulk add/delete on auto-save.
 *   src/lib/execution-engine.ts — sortNodes() reads edges to build the graph.
 *
 * FIELD MEANINGS:
 *   id         — unique edge identifier.
 *   workflowId — which workflow this edge belongs to.
 *   fromNodeId — the id of the source node (where the connection starts).
 *   toNodeId   — the id of the target node (where the connection ends).
 *   fromOutput — the handle id on the source node (default: "default").
 *   toInput    — the handle id on the target node (default: "default").
 *
 * WHAT IS A "HANDLE"?
 *   In ReactFlow, handles are the small dots on nodes that you drag to create
 *   connections.  Most nodes have a single input and single output handle.
 *   The fromOutput/toInput fields store which handle was connected.
 */
export interface WorkflowConnectionRecord {
  id: string;
  workflowId: string;
  fromNodeId: string;
  toNodeId: string;
  fromOutput: string;
  toInput: string;
}

/**
 * ExecutionStatus
 *
 * WHY THIS EXISTS:
 *   Every execution run goes through a lifecycle.  This union type tracks
 *   where in that lifecycle the execution currently is.
 *
 * VALUES:
 *   "RUNNING"  — execution is currently in progress (nodes are running).
 *   "SUCCESS"  — all nodes completed without errors.
 *   "FAILED"   — one or more nodes threw an error, or the user cancelled.
 *   "CANCELED" — reserved for explicit cancellation (currently mapped to FAILED).
 *
 * USED IN:
 *   ExecutionRecord.status — stored in the database.
 *   src/features/executions/components/executions.tsx — shown as status badge.
 *   src/lib/execution-engine.ts — written at start and updated at end.
 */
export type ExecutionStatus =
  | "RUNNING"
  | "SUCCESS"
  | "FAILED"
  | "CANCELED";

/**
 * ExecutionRecord
 *
 * WHY THIS EXISTS:
 *   Every time the user clicks "Run", a new ExecutionRecord is created.
 *   It tracks the overall status and timing of one workflow run.
 *   Even if the run fails, the record is kept so the user can inspect what
 *   went wrong in the execution detail page.
 *
 * USED IN:
 *   AutoPilotDB.executions table.
 *   src/lib/execution-engine.ts — created at start, updated at end.
 *   src/features/executions/hooks/use-executions.ts — listed and queried.
 *   src/features/executions/components/execution-detail.tsx — displayed.
 *
 * FIELD MEANINGS:
 *   id          — unique execution identifier (cuid2).
 *   workflowId  — which workflow was run.
 *   status      — current lifecycle state (see ExecutionStatus).
 *   startedAt   — ISO timestamp when runWorkflow() was called.
 *   completedAt — ISO timestamp when all nodes finished (or failed); optional.
 *   error       — error message if status is "FAILED"; optional.
 */
export interface ExecutionRecord {
  id: string;
  workflowId: string;
  status: ExecutionStatus;
  startedAt: string;
  completedAt?: string;
  error?: string;
}

/**
 * NodeExecutionStatus
 *
 * WHY THIS EXISTS:
 *   Tracks the status of a single node within an execution run.
 *   While ExecutionStatus tracks the whole workflow, NodeExecutionStatus
 *   tracks each individual node.
 *
 * VALUES:
 *   "PENDING" — node has not started yet (waiting for earlier nodes).
 *   "RUNNING" — node's executor is currently running.
 *   "SUCCESS" — node completed successfully.
 *   "FAILED"  — node threw an error.
 *
 * USED IN:
 *   ExecutionNodeOutputRecord.status.
 *   src/lib/execution-engine.ts — written at node start and updated at end.
 */
export type NodeExecutionStatus = "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";

/**
 * ExecutionNodeOutputRecord
 *
 * WHY THIS EXISTS:
 *   When a node finishes executing, its output metadata is stored here.
 *   This includes: which variable was produced, where the dataset is in OPFS,
 *   how long the node took, and any error message.
 *
 *   This record lets the execution detail page show per-node timing breakdowns
 *   and lets the dataset viewer know which dataset to load.
 *
 * USED IN:
 *   AutoPilotDB.executionNodeOutputs table.
 *   src/lib/execution-engine.ts — created when node starts, updated when it ends.
 *   src/features/executions/components/execution-detail.tsx — timing display.
 *   src/features/executions/components/execution-dataset-viewer.tsx — dataset viewer.
 *
 * FIELD MEANINGS:
 *   id           — unique record identifier.
 *   executionId  — which execution this belongs to.
 *   nodeId       — which node in the workflow produced this output.
 *   nodeType     — the NodeType of the node (e.g. "CSV_SORT").
 *   status       — current lifecycle state (see NodeExecutionStatus).
 *   variableName — e.g. "sortedData" — the context variable produced by this node.
 *   datasetId    — if the output is a large dataset, its OPFS dataset ID.
 *   inlineOutput — if the output is small (e.g. CompareResult JSON), stored here
 *                  directly in IndexedDB instead of OPFS.
 *   error        — error message if the node failed.
 *   startedAt    — when the node started executing.
 *   finishedAt   — when the node finished.
 *   durationMs   — execution time in milliseconds (finishedAt - startedAt).
 *
 * WHY TWO OUTPUT FIELDS (datasetId vs inlineOutput)?
 *   Large datasets (millions of rows) → stored in OPFS, referenced by datasetId.
 *   Small outputs (e.g. compare summary statistics) → stored inline in IndexedDB.
 *   Storing large data directly in IndexedDB would be slow and hit size limits.
 */
export interface ExecutionNodeOutputRecord {
  id: string;
  executionId: string;
  nodeId: string;
  nodeType: NodeType;
  status: NodeExecutionStatus;
  /** name of the output variable bound to this node's result */
  variableName?: string;
  /** id of the dataset in OPFS (if the output is a large dataset) */
  datasetId?: string;
  /** small inline output (if the result fits in memory) */
  inlineOutput?: unknown;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
}

/**
 * DatasetRecord
 *
 * WHY THIS EXISTS:
 *   Links a dataset ID (an OPFS directory) to its full manifest metadata.
 *   This is what the `cleanupOrphanedOPFSData()` function in opfs.ts uses
 *   to know which OPFS directories are legitimate (registered here) vs orphaned
 *   (no record here = can be deleted).
 *
 * USED IN:
 *   AutoPilotDB.datasets table.
 *   src/lib/execution-engine.ts — adds a record for every DatasetRef emitted by a node.
 *   src/lib/opfs.ts — reads all records to find valid dataset paths.
 *   src/features/executions/hooks/use-executions.ts — loads manifests for dataset viewer.
 *
 * FIELD MEANINGS:
 *   id           — matches the datasetId inside the manifest AND the OPFS directory name.
 *   executionId  — which execution produced this dataset.
 *   variableName — the variable name under which it is known in the execution context.
 *   manifest     — the full DatasetManifest (chunk list, row count, schema, etc.).
 */
export interface DatasetRecord {
  id: string;
  executionId: string;
  variableName: string;
  manifest: DatasetManifest;
}

// ─── Database class ───────────────────────────────────────────────────────────

/**
 * AutoPilotDB
 *
 * WHY THIS EXISTS:
 *   This is the application's database class.  It extends Dexie (the IndexedDB
 *   wrapper library) and declares the schema for all six tables.
 *
 * HOW DEXIE VERSIONING WORKS:
 *   Dexie uses a version number to manage schema changes.  When you first open
 *   the database in a user's browser, `version(1)` creates the tables.  If in a
 *   future release you add a new table or index, you add `version(2)` without
 *   touching version 1 — Dexie runs the migration automatically.
 *
 * HOW THE SCHEMA STRING WORKS:
 *   "id, name, createdAt, updatedAt"
 *    ↑    ↑     ↑          ↑
 *    PK   indexed fields (can query by these)
 *
 *   The first field is ALWAYS the primary key.  Subsequent comma-separated
 *   fields are secondary indexes.  Fields not listed here are stored but cannot
 *   be efficiently queried.
 *
 * CALLED IN:
 *   The `db` constant below — instantiated ONCE and exported for the whole app.
 */
export class AutoPilotDB extends Dexie {
  /**
   * workflows
   * The table of all saved workflow definitions.
   * Table<WorkflowRecord, string> = each row is a WorkflowRecord, primary key is a string.
   */
  workflows!: Table<WorkflowRecord, string>;

  /**
   * workflowNodes
   * One row per node per workflow.  Queried by workflowId to load a workflow's canvas.
   */
  workflowNodes!: Table<WorkflowNodeRecord, string>;

  /**
   * workflowConnections
   * One row per edge per workflow.  Queried by workflowId to load a workflow's edges.
   */
  workflowConnections!: Table<WorkflowConnectionRecord, string>;

  /**
   * executions
   * One row per workflow run.  Queried by workflowId, status, or startedAt.
   */
  executions!: Table<ExecutionRecord, string>;

  /**
   * executionNodeOutputs
   * One row per node per execution.  Queried by executionId to get all node outputs.
   */
  executionNodeOutputs!: Table<ExecutionNodeOutputRecord, string>;

  /**
   * datasets
   * One row per dataset produced by any execution.
   * Stores the manifest (chunk list, row count, schema) for every OPFS dataset.
   */
  datasets!: Table<DatasetRecord, string>;

  /**
   * constructor
   *
   * WHY THIS EXISTS:
   *   Calling `super("autopilot")` tells Dexie to open (or create) an IndexedDB
   *   database named "autopilot" in the browser.  The schema defined in
   *   `version(1).stores(...)` will be applied the first time a user opens the app,
   *   or after a schema version upgrade.
   *
   * WHAT ! MEANS ON PROPERTIES:
   *   The `!` (definite assignment assertion) tells TypeScript "I know this will
   *   be assigned by Dexie — don't warn me that it might be undefined."
   *   Without it, TypeScript would complain that `workflows` is declared but
   *   never initialised.  Dexie initialises these properties dynamically.
   */
  constructor() {
    super("autopilot"); // ← database name; visible in browser DevTools → Application → IndexedDB

    this.version(1).stores({
      // Primary key = id; secondary indexes = name, createdAt, updatedAt
      workflows: "id, name, createdAt, updatedAt",

      // Primary key = id; indexed by workflowId (to find all nodes of a workflow)
      workflowNodes: "id, workflowId, type",

      // Primary key = id; indexed by workflowId and both endpoints
      workflowConnections: "id, workflowId, fromNodeId, toNodeId",

      // Primary key = id; indexed by workflowId, status (to filter by RUNNING), startedAt
      executions: "id, workflowId, status, startedAt",

      // Primary key = id; indexed by executionId and nodeId
      executionNodeOutputs: "id, executionId, nodeId, status",

      // Primary key = id; indexed by executionId and variableName
      datasets: "id, executionId, variableName",
    });
  }
}

// ─── Singleton export ─────────────────────────────────────────────────────────

/**
 * db
 *
 * WHY THIS EXISTS:
 *   The entire application shares ONE database connection.  Creating a new
 *   AutoPilotDB() on every query would be wasteful and could cause race
 *   conditions.  This singleton is created once when the module is first
 *   imported, and then every file that does `import { db } from "@/lib/db"`
 *   gets the same instance.
 *
 * WHAT IS A SINGLETON?
 *   A singleton is a design pattern where only ONE instance of something exists.
 *   Here, there is only one `db` object for the entire running application.
 *
 * CALLED FROM:
 *   src/lib/execution-engine.ts — writes execution records.
 *   src/lib/opfs.ts             — reads dataset records for orphan detection.
 *   src/features/workflows/hooks/use-workflows.ts — CRUD for workflows.
 *   src/features/executions/hooks/use-executions.ts — queries for execution history.
 */
export const db = new AutoPilotDB();
