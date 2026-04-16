"use client";

import { type NodeProps, Position, useReactFlow } from "@xyflow/react";
import { MousePointerClick } from "lucide-react";
import { memo } from "react";

import { BaseHandle } from "@/components/react-flow/base-handle";
import { BaseNode, BaseNodeContent } from "@/components/react-flow/base-node";
import { WorkflowNode } from "@/components/workflow-node";

export const ManualTriggerNode = memo((props: NodeProps) => {
  const { setNodes, setEdges } = useReactFlow();

  const handleDelete = () => {
    setNodes((nds) => nds.filter((n) => n.id !== props.id));
    setEdges((eds) =>
      eds.filter((e) => e.source !== props.id && e.target !== props.id),
    );
  };

  return (
    <WorkflowNode
      name="Manual Trigger"
      description="Start the workflow manually"
      onDelete={handleDelete}
    >
      <BaseNode>
        <BaseNodeContent className="items-center">
          <div className="flex size-8 items-center justify-center rounded-full bg-primary/10 ring-2 ring-primary/30">
            <MousePointerClick className="size-4 text-primary" />
          </div>
          <BaseHandle id="source-1" type="source" position={Position.Right} />
        </BaseNodeContent>
      </BaseNode>
    </WorkflowNode>
  );
});

ManualTriggerNode.displayName = "ManualTriggerNode";
