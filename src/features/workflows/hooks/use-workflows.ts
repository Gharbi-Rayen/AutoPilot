"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { createId } from "@paralleldrive/cuid2";
import { toast } from "sonner";
import type { Edge, Node } from "@xyflow/react";
import { db } from "@/lib/db";
import { NodeType } from "@/types/node-type";
import { useWorkflowsParams } from "./use-workflows-params";

// ─── Query keys ───────────────────────────────────────────────────────────────

export const workflowKeys = {
  all: ["workflows"] as const,
  list: (params: object) => ["workflows", "list", params] as const,
  detail: (id: string) => ["workflows", "detail", id] as const,
};

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchWorkflows(params: {
  page?: number;
  pageSize?: number;
  search?: string;
}) {
  const { page = 1, pageSize = 10, search = "" } = params;
  let all = await db.workflows.orderBy("createdAt").reverse().toArray();
  if (search) {
    const lower = search.toLowerCase();
    all = all.filter((w) => w.name.toLowerCase().includes(lower));
  }
  const totalCount = all.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const items = all.slice((page - 1) * pageSize, page * pageSize);
  return {
    items,
    page,
    pageSize,
    totalCount,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}

async function fetchWorkflow(id: string) {
  const workflow = await db.workflows.get(id);
  if (!workflow) throw new Error(`Workflow ${id} not found`);

  const dbNodes = await db.workflowNodes.where("workflowId").equals(id).toArray();
  const dbConnections = await db.workflowConnections
    .where("workflowId")
    .equals(id)
    .toArray();

  const nodes: Node[] = dbNodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: n.position,
    data: n.data,
  }));

  const edges: Edge[] = dbConnections.map((c) => ({
    id: c.id,
    source: c.fromNodeId,
    target: c.toNodeId,
    sourceHandle: c.fromOutput,
    targetHandle: c.toInput,
  }));

  return { id: workflow.id, name: workflow.name, nodes, edges };
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

export const useSuspenseWorkflows = () => {
  const [params] = useWorkflowsParams();
  return useSuspenseQuery({
    queryKey: workflowKeys.list(params),
    queryFn: () => fetchWorkflows(params),
  });
};

export const useSuspenseWorkflow = (id: string) =>
  useSuspenseQuery({
    queryKey: workflowKeys.detail(id),
    queryFn: () => fetchWorkflow(id),
  });

export const useWorkflow = (id: string) =>
  useQuery({
    queryKey: workflowKeys.detail(id),
    queryFn: () => fetchWorkflow(id),
    enabled: Boolean(id),
  });

export const useCreateWorkflow = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const id = createId();
      const now = new Date().toISOString();
      await db.workflows.add({ id, name, createdAt: now, updatedAt: now });
      await db.workflowNodes.add({
        id: createId(),
        workflowId: id,
        type: NodeType.INITIAL,
        position: { x: 0, y: 0 },
        data: {},
      });
      return db.workflows.get(id);
    },
    onSuccess: (data) => {
      toast.success(`Workflow "${data?.name}" created successfully.`);
      queryClient.invalidateQueries({ queryKey: workflowKeys.all });
    },
    onError: (error: Error) => {
      toast.error(`Failed to create workflow: ${error.message}`);
    },
  });
};

export const useRemoveWorkflow = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const wf = await db.workflows.get(id);
      await db.transaction("rw", [db.workflows, db.workflowNodes, db.workflowConnections], async () => {
        await db.workflowNodes.where("workflowId").equals(id).delete();
        await db.workflowConnections.where("workflowId").equals(id).delete();
        await db.workflows.delete(id);
      });
      return wf;
    },
    onSuccess: (data) => {
      toast.success(`Workflow "${data?.name}" removed successfully.`);
      queryClient.invalidateQueries({ queryKey: workflowKeys.all });
    },
    onError: (error: Error) => {
      toast.error(`Failed to remove workflow: ${error.message}`);
    },
  });
};

export const useUpdateWorkflowName = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      await db.workflows.update(id, { name, updatedAt: new Date().toISOString() });
      return db.workflows.get(id);
    },
    onSuccess: (data) => {
      toast.success(`Workflow "${data?.name}" updated successfully.`);
      queryClient.invalidateQueries({ queryKey: workflowKeys.all });
    },
    onError: (error: Error) => {
      toast.error(`Failed to update workflow: ${error.message}`);
    },
  });
};

export const useUpdateWorkflow = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      nodes,
      edges,
    }: {
      id: string;
      nodes: Node[];
      edges: Edge[];
    }) => {
      const now = new Date().toISOString();

      await db.transaction("rw", [db.workflowNodes, db.workflowConnections, db.workflows], async () => {
        // Replace all nodes for this workflow
        await db.workflowNodes.where("workflowId").equals(id).delete();
        await db.workflowNodes.bulkAdd(
          nodes.map((n) => ({
            id: n.id,
            workflowId: id,
            type: (n.type ?? NodeType.INITIAL) as NodeType,
            position: n.position as { x: number; y: number },
            data: (n.data as Record<string, unknown>) ?? {},
          })),
        );

        // Replace all connections
        await db.workflowConnections.where("workflowId").equals(id).delete();
        await db.workflowConnections.bulkAdd(
          edges.map((e) => ({
            id: e.id ?? createId(),
            workflowId: id,
            fromNodeId: e.source,
            toNodeId: e.target,
            fromOutput: e.sourceHandle ?? "main",
            toInput: e.targetHandle ?? "main",
          })),
        );

        await db.workflows.update(id, { updatedAt: now });
      });

      return db.workflows.get(id);
    },
    onSuccess: (data) => {
      toast.success(`Workflow "${data?.name}" saved successfully.`);
      queryClient.invalidateQueries({ queryKey: workflowKeys.all });
    },
    onError: (error: Error) => {
      toast.error(`Failed to save workflow: ${error.message}`);
    },
  });
};

/** Trigger a workflow execution — the actual run happens in the execution engine. */
export const useExecuteWorkflow = () => {
  return useMutation({
    mutationFn: async (id: string) => {
      const wf = await db.workflows.get(id);
      if (!wf) throw new Error("Workflow not found");
      return wf;
    },
    onError: (error: Error) => {
      toast.error(`Failed to execute workflow: ${error.message}`);
    },
  });
};

/** Cancel a running execution by marking it FAILED in IndexedDB. */
export const usePauseExecution = () => {
  return useMutation({
    mutationFn: async (executionId: string) => {
      const exec = await db.executions.get(executionId);
      if (!exec || exec.status !== "RUNNING") {
        return { paused: false, execution: exec };
      }
      await db.executions.update(executionId, {
        status: "CANCELED",
        completedAt: new Date().toISOString(),
        error: "Canceled by user.",
      });
      return { paused: true, execution: exec };
    },
    onSuccess: ({ paused, execution }) => {
      if (paused) {
        toast.success("Execution canceled.");
      } else {
        toast.info(`Execution is already finished (${execution?.status}).`);
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to cancel execution: ${error.message}`);
    },
  });
};
