"use client";

import { type NodeProps, Position, useReactFlow } from "@xyflow/react";
import { useAtomValue } from "jotai";
import { PlayIcon, SquareIcon } from "lucide-react";
import { memo } from "react";

import { BaseHandle } from "@/components/react-flow/base-handle";
import { BaseNode, BaseNodeContent } from "@/components/react-flow/base-node";
import { WorkflowNode } from "@/components/workflow-node";
import { workflowIdAtom } from "@/features/editor/store/atoms";
import { useRunWorkflow } from "@/features/executions/hooks/use-run-workflow";
import { workflowExecutionStateAtom } from "@/store/execution-status";

export const ManualTriggerNode = memo((props: NodeProps) => {
  const { setNodes, setEdges, getNodes, getEdges } = useReactFlow();
  const { execute, cancel } = useRunWorkflow();
  const executionState = useAtomValue(workflowExecutionStateAtom);
  const workflowId = useAtomValue(workflowIdAtom);

  const isRunning = executionState === "running";

  const handleDelete = () => {
    setNodes((nds) => nds.filter((n) => n.id !== props.id));
    setEdges((eds) =>
      eds.filter((e) => e.source !== props.id && e.target !== props.id),
    );
  };

  const handleRun = () => {
    if (!workflowId) return;
    execute(workflowId, getNodes(), getEdges());
  };

  return (
    <WorkflowNode
      name="Manual Trigger"
      description="Start the workflow manually"
      onDelete={handleDelete}
    >
      <BaseNode>
        <BaseNodeContent className="items-center">
          <button
            type="button"
            onClick={isRunning ? cancel : handleRun}
            className="flex items-center justify-center"
          >
            {isRunning ? (
              <SquareIcon className="size-4 text-muted-foreground" />
            ) : (
              <PlayIcon className="size-4 text-muted-foreground" />
            )}
          </button>
          <BaseHandle id="source-1" type="source" position={Position.Right} />
        </BaseNodeContent>
      </BaseNode>
    </WorkflowNode>
  );
});

ManualTriggerNode.displayName = "ManualTriggerNode";
