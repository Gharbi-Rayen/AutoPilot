"use client";

import { useSetAtom } from "jotai";
import { useCallback, useRef } from "react";
import type { Edge, Node } from "@xyflow/react";
import { runWorkflow } from "@/lib/execution-engine";
import {
  activeExecutionIdAtom,
  executionStartedAtAtom,
  nodeStatusMapAtom,
  resetWorkflowExecutionStateAtom,
  workflowExecutionErrorAtom,
  workflowExecutionStateAtom,
  workflowProgressPanelOpenAtom,
} from "@/store/execution-status";
import type { NodeStatus } from "@/components/react-flow/node-status-indicator";

export function useRunWorkflow() {
  const resetState = useSetAtom(resetWorkflowExecutionStateAtom);
  const setNodeStatusMap = useSetAtom(nodeStatusMapAtom);
  const setWorkflowState = useSetAtom(workflowExecutionStateAtom);
  const setActiveExecutionId = useSetAtom(activeExecutionIdAtom);
  const setExecutionStartedAt = useSetAtom(executionStartedAtAtom);
  const setError = useSetAtom(workflowExecutionErrorAtom);
  const setPanelOpen = useSetAtom(workflowProgressPanelOpenAtom);
  const isRunning = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }, []);

  const execute = useCallback(
    async (workflowId: string, nodes: Node[], edges: Edge[]) => {
      if (isRunning.current) return;
      isRunning.current = true;

      const controller = new AbortController();
      abortControllerRef.current = controller;

      resetState();
      setExecutionStartedAt(Date.now());
      setPanelOpen(true);

      try {
        const executionId = await runWorkflow(workflowId, nodes, edges, {
          onNodeStatusChange: (nodeId, status) => {
            setNodeStatusMap((prev) => ({
              ...prev,
              [nodeId]: status as NodeStatus,
            }));
          },
          onWorkflowStatusChange: (status) => {
            setWorkflowState(
              status === "running" ? "running" : status === "success" ? "success" : "error",
            );
          },
          onProgress: (_nodeId, _progress, _message) => {
            // Future: could drive per-node progress bars here
          },
          onError: (error) => {
            setError(error);
          },
        }, controller.signal);

        setActiveExecutionId(executionId);
        return executionId;
      } finally {
        isRunning.current = false;
      }
    },
    [
      resetState,
      setNodeStatusMap,
      setWorkflowState,
      setActiveExecutionId,
      setExecutionStartedAt,
      setError,
      setPanelOpen,
    ],
  );

  return { execute, cancel };
}
