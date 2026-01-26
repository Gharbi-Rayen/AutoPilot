"use client";

import type { ComponentType, ReactNode } from "react";
import { memo } from "react";

import { type NodeProps, Position } from "@xyflow/react";
import Image from "next/image";

import { BaseHandle } from "../../../components/react-flow/base-handle";
import { BaseNode, BaseNodeContent } from "../../../components/react-flow/base-node";
import { WorkflowNode } from "../../../components/workflow-node";

interface BaseExecutionNodeProps extends NodeProps {
    icon: ComponentType<{ className?: string }> | string;
    name: string;
    description?: string;
    children?: ReactNode;
    // status?: NodeStatus;
    onSettings?: () => void;
    onDoubleClick?: () => void;
}

export const BaseExecutionNode = memo(({
    icon: Icon,
    name,
    description,
    children,
    onSettings,
    onDoubleClick,
}: BaseExecutionNodeProps) => {
    // TODO: implement delete handler - currently hidden until deletion is available

    return (
        <WorkflowNode
        name={name}
        description={description}
        onSettings={onSettings}
        onDelete={undefined}
        >
        <BaseNode onDoubleClick={onDoubleClick}>

        {/* TODO : wrap within Node Status Indicator */ }
            <BaseNodeContent>
                {typeof Icon === "string" ? (
                    <Image src={Icon} alt={`${name} icon`} className="size-6" width={24} height={24} />
                ) : (
                    <Icon className="size-4 text-muted-foreground"  />
                )}
                {children}
                <BaseHandle 
                id="target-1"
                type="target"
                position={Position.Left}
                />
                <BaseHandle 
                id="source-1"
                type="source"
                position={Position.Right}
                />
            </BaseNodeContent>
        

        </BaseNode>
        </WorkflowNode>
    );
});

BaseExecutionNode.displayName = "BaseExecutionNode";