"use client";

import { type NodeProps, Position, useReactFlow } from "@xyflow/react";
import Image from "next/image";
import type { ComponentType, ReactNode } from "react";
import { memo } from "react";
import {
  type NodeStatus,
  NodeStatusIndicator,
} from "@/components/react-flow/node-status-indicator";
import { BaseHandle } from "../../../components/react-flow/base-handle";
import {
  BaseNode,
  BaseNodeContent,
} from "../../../components/react-flow/base-node";
import { WorkflowNode } from "../../../components/workflow-node";

interface BaseTriggerNodeProps extends NodeProps {
  icon: ComponentType<{ className?: string }> | string;
  name: string;
  description?: string;
  children?: ReactNode;
  status?: NodeStatus;
  onSettings?: () => void;
  onDoubleClick?: () => void;
}

export const BaseTriggerNode = memo(
  ({
    id,
    icon: Icon,
    name,
    description,
    children,
    status = "initial",
    onSettings,
    onDoubleClick,
  }: BaseTriggerNodeProps) => {
    const { setNodes, setEdges } = useReactFlow();

    const handleDelete = () => {
      setNodes((nds) => {
        const updatedNodes = nds.filter((n) => n.id !== id);
        return updatedNodes;
      });

      setEdges((eds) => {
        const updatedEdges = eds.filter(
          (e) => e.source !== id && e.target !== id,
        );
        return updatedEdges;
      });
    };

    return (
      <WorkflowNode
        name={name}
        description={description}
        onSettings={onSettings}
        onDelete={handleDelete}
      >
        <NodeStatusIndicator
          status={status}
          variant="border"
          className="rounded-l-2xl"
        >
          <BaseNode
            status={status}
            onDoubleClick={onDoubleClick}
            className="rounded-l-2xl relative group"
          >
            <BaseNodeContent>
              {typeof Icon === "string" ? (
                <Image
                  src={Icon}
                  alt={`${name} icon`}
                  className="size-4"
                  width={16}
                  height={16}
                />
              ) : (
                <Icon className="size-4 text-muted-foreground" />
              )}
              {children}

              <BaseHandle
                id="source-1"
                type="source"
                position={Position.Right}
              />
            </BaseNodeContent>
          </BaseNode>
        </NodeStatusIndicator>
      </WorkflowNode>
    );
  },
);
BaseTriggerNode.displayName = "BaseTriggerNode";
