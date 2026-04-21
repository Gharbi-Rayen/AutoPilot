import { atom } from "jotai";
import type { NodeStatus } from "@/components/react-flow/node-status-indicator";

export type WorkflowExecutionState =
  | "idle"
  | "running"
  | "paused"
  | "success"
  | "error";

export const nodeStatusMapAtom = atom<Record<string, NodeStatus>>({});

export const nodeProgressMapAtom = atom<Record<string, { progress: number; message?: string }>>({});

export const nodeTimingsAtom = atom<Record<string, { startMs: number; endMs?: number }>>({});

export const workflowExecutionStateAtom = atom<WorkflowExecutionState>("idle");

export const activeExecutionIdAtom = atom<string | null>(null);

export const executionStartedAtAtom = atom<number | null>(null);

export const workflowExecutionResultAtom = atom<unknown | null>(null);

export const workflowExecutionErrorAtom = atom<string | null>(null);

export const workflowProgressPanelOpenAtom = atom(false);

export const workflowProgressPanelCollapsedAtom = atom(false);

export const resetWorkflowExecutionStateAtom = atom(null, (_get, set) => {
  set(nodeStatusMapAtom, {});
  set(nodeProgressMapAtom, {});
  set(nodeTimingsAtom, {});
  set(workflowExecutionStateAtom, "idle");
  set(activeExecutionIdAtom, null);
  set(executionStartedAtAtom, null);
  set(workflowExecutionResultAtom, null);
  set(workflowExecutionErrorAtom, null);
  set(workflowProgressPanelCollapsedAtom, false);
});
