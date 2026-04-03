import { useAtomValue, useSetAtom } from "jotai";
import { FlaskConicalIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useExecuteWorkflow,
  useUpdateWorkflow,
} from "@/features/workflows/hooks/use-workflows";
import type { NodeType } from "@/generated/prisma";
import {
  activeExecutionIdAtom,
  resetWorkflowExecutionStateAtom,
  workflowExecutionErrorAtom,
  workflowExecutionStateAtom,
  workflowProgressPanelOpenAtom,
} from "@/store/execution-status";
import { editorAtom } from "../store/atoms";

export const ExecuteWorkflowButton = ({
  workflowId,
}: {
  workflowId: string;
}) => {
  const editor = useAtomValue(editorAtom);
  const resetWorkflowExecutionState = useSetAtom(
    resetWorkflowExecutionStateAtom,
  );
  const setWorkflowExecutionState = useSetAtom(workflowExecutionStateAtom);
  const setWorkflowExecutionError = useSetAtom(workflowExecutionErrorAtom);
  const setActiveExecutionId = useSetAtom(activeExecutionIdAtom);
  const setWorkflowProgressPanelOpen = useSetAtom(
    workflowProgressPanelOpenAtom,
  );
  const saveWorkflow = useUpdateWorkflow();
  const executeWorkflow = useExecuteWorkflow();

  const handleExecute = async () => {
    if (!editor) {
      return;
    }

    resetWorkflowExecutionState();
    setWorkflowProgressPanelOpen(true);

    const nodes = editor.getNodes().map((node) => ({
      id: node.id,
      type: node.type as NodeType,
      position: node.position,
      data: node.data as Record<string, unknown> | undefined,
    }));

    const edges = editor.getEdges().map((edge) => ({
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
    }));

    try {
      await saveWorkflow.mutateAsync({
        id: workflowId,
        nodes,
        edges,
      });

      setWorkflowExecutionState("running");

      const workflowExecution = await executeWorkflow.mutateAsync({
        id: workflowId,
      });

      setActiveExecutionId(workflowExecution.executionId);
    } catch (error) {
      setWorkflowExecutionState("error");
      setWorkflowExecutionError(
        error instanceof Error ? error.message : "Failed to execute workflow.",
      );
    }
  };

  const isPending = executeWorkflow.isPending || saveWorkflow.isPending;

  return (
    <Button size="lg" onClick={handleExecute} disabled={isPending}>
      {isPending ? (
        <Loader2Icon className="size-4 animate-spin" />
      ) : (
        <FlaskConicalIcon className="size-4" />
      )}
      {isPending ? "Executing..." : "Execute Workflow"}
    </Button>
  );
};
