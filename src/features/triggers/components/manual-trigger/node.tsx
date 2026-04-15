import type { NodeProps } from "@xyflow/react";
import stableStringify from "fast-json-stable-stringify";
import { useAtomValue, useSetAtom } from "jotai";
import { Loader2Icon, PlayIcon, SquareIcon } from "lucide-react";
import { memo, useRef, useState } from "react";
import { editorAtom, workflowIdAtom } from "@/features/editor/store/atoms";
import { useNodeStatus } from "@/features/executions/hooks/use-node-status";
import {
  useExecuteWorkflow,
  usePauseExecution,
  useUpdateWorkflow,
} from "@/features/workflows/hooks/use-workflows";
import type { NodeType } from "@/generated/prisma";
import { MANUAL_TRIGGER_CHANNEL_NAME } from "@/inngest/channels/manual-triggers";
import {
  activeExecutionIdAtom,
  executionStartedAtAtom,
  resetWorkflowExecutionStateAtom,
  workflowExecutionErrorAtom,
  workflowExecutionStateAtom,
  workflowProgressPanelCollapsedAtom,
} from "@/store/execution-status";
import { BaseTriggerNode } from "../base-trigger-node";
import { fetchManualTriggerRealTimeToken } from "./actions";
import { ManualTriggerDialog } from "./dialog";

const PlayTriggerIcon = ({ className }: { className?: string }) => (
  <PlayIcon className={className} />
);
const StopTriggerIcon = ({ className }: { className?: string }) => (
  <SquareIcon className={className} />
);
const LoadingTriggerIcon = ({ className }: { className?: string }) => (
  <Loader2Icon className={className} />
);

export const ManualTriggerNode = memo((props: NodeProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);

  const nodeStatus = useNodeStatus({
    nodeId: props.id,
    channel: MANUAL_TRIGGER_CHANNEL_NAME,
    topic: "status",
    refreshToken: fetchManualTriggerRealTimeToken,
  });

  const editor = useAtomValue(editorAtom);
  const workflowId = useAtomValue(workflowIdAtom);
  const executionState = useAtomValue(workflowExecutionStateAtom);
  const activeExecutionId = useAtomValue(activeExecutionIdAtom);

  const resetExecutionState = useSetAtom(resetWorkflowExecutionStateAtom);
  const setExecutionState = useSetAtom(workflowExecutionStateAtom);
  const setExecutionError = useSetAtom(workflowExecutionErrorAtom);
  const setActiveExecutionId = useSetAtom(activeExecutionIdAtom);
  const setExecutionStartedAt = useSetAtom(executionStartedAtAtom);
  const setPanelCollapsed = useSetAtom(workflowProgressPanelCollapsedAtom);

  const saveWorkflow = useUpdateWorkflow();
  const executeWorkflow = useExecuteWorkflow();
  const pauseExecution = usePauseExecution();

  const lastSavedSignatureRef = useRef<string | null>(null);

  const isRunning = executionState === "running";
  const isStartingPending = saveWorkflow.isPending || executeWorkflow.isPending;
  const isCancelingPending = pauseExecution.isPending;
  const isPending = isStartingPending || isCancelingPending;

  const handleRun = async () => {
    if (!editor || !workflowId || isPending) return;

    resetExecutionState();
    setPanelCollapsed(false);
    setExecutionState("running");
    setExecutionStartedAt(Date.now());

    const latestNodes = editor.getNodes().map((node) => ({
      id: node.id,
      type: node.type as NodeType,
      position: node.position,
      data: node.data as Record<string, unknown> | undefined,
    }));

    const latestEdges = editor.getEdges().map((edge) => ({
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
    }));

    const graphSignature = stableStringify({
      nodes: latestNodes,
      edges: latestEdges,
    });

    try {
      if (graphSignature !== lastSavedSignatureRef.current) {
        await saveWorkflow.mutateAsync({
          id: workflowId,
          nodes: latestNodes,
          edges: latestEdges,
        });
        lastSavedSignatureRef.current = graphSignature;
      }

      const workflowExecution = await executeWorkflow.mutateAsync({
        id: workflowId,
      });

      setActiveExecutionId(workflowExecution.executionId);
    } catch (error) {
      setExecutionState("error");
      setExecutionError(
        error instanceof Error ? error.message : "Failed to execute workflow.",
      );
    }
  };

  const handleCancel = async () => {
    if (!activeExecutionId || isPending) return;
    try {
      await pauseExecution.mutateAsync({ executionId: activeExecutionId });
    } catch {
      // best-effort: still reset local state
    }
    resetExecutionState();
  };

  const handleIconClick = () => {
    if (isPending) return;
    if (isRunning) {
      void handleCancel();
    } else {
      void handleRun();
    }
  };

  const TriggerIcon = isPending
    ? LoadingTriggerIcon
    : isRunning
      ? StopTriggerIcon
      : PlayTriggerIcon;

  const iconClassName = isPending
    ? "size-4 animate-spin text-black"
    : isRunning
      ? "size-4 text-black"
      : "size-4 text-black";

  return (
    <>
      <ManualTriggerDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      <BaseTriggerNode
        {...props}
        icon={TriggerIcon}
        iconClassName={iconClassName}
        name="Manual Trigger"
        status={nodeStatus}
        description={
          isCancelingPending
            ? "Canceling execution..."
            : isStartingPending
              ? "Saving & starting..."
              : isRunning
                ? "Click stop to cancel and reset execution"
                : "Click play to run the workflow"
        }
        onIconClick={handleIconClick}
        onSettings={() => setDialogOpen(true)}
      />
    </>
  );
});

ManualTriggerNode.displayName = "ManualTriggerNode";
