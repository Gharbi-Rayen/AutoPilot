"use client";

import type { Edge, Node } from "@xyflow/react";
import { useSetAtom } from "jotai";
import { useCallback, useRef } from "react";
import type { NodeStatus } from "@/components/react-flow/node-status-indicator";
import { runWorkflow } from "@/lib/execution-engine";
import {
  activeExecutionIdAtom,
  executionStartedAtAtom,
  nodeProgressMapAtom,
  nodeStatusMapAtom,
  nodeTimingsAtom,
  resetWorkflowExecutionStateAtom,
  workflowExecutionErrorAtom,
  workflowExecutionStateAtom,
  workflowProgressPanelOpenAtom,
} from "@/store/execution-status";

export function useRunWorkflow() {
  const resetState = useSetAtom(resetWorkflowExecutionStateAtom);
  const setNodeStatusMap = useSetAtom(nodeStatusMapAtom);
  const setNodeProgressMap = useSetAtom(nodeProgressMapAtom);
  const setNodeTimings = useSetAtom(nodeTimingsAtom);
  const setWorkflowState = useSetAtom(workflowExecutionStateAtom);
  const setActiveExecutionId = useSetAtom(activeExecutionIdAtom);
  const setExecutionStartedAt = useSetAtom(executionStartedAtAtom);
  const setError = useSetAtom(workflowExecutionErrorAtom);
  const setPanelOpen = useSetAtom(workflowProgressPanelOpenAtom);
  const isRunning = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  // Track workflow start time in a ref so callbacks have a stable, non-stale reference
  const workflowStartMsRef = useRef<number>(0);

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

      const startMs = Date.now();
      workflowStartMsRef.current = startMs;
      resetState();
      setExecutionStartedAt(startMs);
      setPanelOpen(true);

      try {
        const executionId = await runWorkflow(
          workflowId,
          nodes,
          edges,
          {
            onExecutionCreated: (id) => {
              // Set immediately so the panel's DB query activates before nodes run
              setActiveExecutionId(id);
            },
            onNodeStatusChange: (nodeId, status) => {
              // execution-engine emits "running"; map to "loading" for the UI
              const uiStatus: NodeStatus =
                status === "running" ? "loading" : (status as NodeStatus);
              setNodeStatusMap((prev) => ({ ...prev, [nodeId]: uiStatus }));

              // Record real wall-clock timing relative to workflow start
              const relMs = Date.now() - workflowStartMsRef.current;
              if (status === "running") {
                setNodeTimings((prev) => ({ ...prev, [nodeId]: { startMs: relMs } }));
              } else if (status === "success" || status === "error") {
                setNodeTimings((prev) => ({
                  ...prev,
                  [nodeId]: { ...(prev[nodeId] ?? { startMs: relMs }), endMs: relMs },
                }));
              }
            },
            onWorkflowStatusChange: (status) => {
              setWorkflowState(
                status === "running"
                  ? "running"
                  : status === "success"
                    ? "success"
                    : "error",
              );
            },
            onProgress: (nodeId, progress, message) => {
              setNodeProgressMap((prev) => ({
                ...prev,
                [nodeId]: { progress, message },
              }));
            },
            onError: (error) => {
              setError(error);
            },
          },
          controller.signal,
        );

        return executionId;
      } finally {
        isRunning.current = false;
      }
    },
    [
      resetState,
      setNodeStatusMap,
      setNodeProgressMap,
      setNodeTimings,
      setWorkflowState,
      setActiveExecutionId,
      setExecutionStartedAt,
      setError,
      setPanelOpen,
    ],
  );

  return { execute, cancel };
}
