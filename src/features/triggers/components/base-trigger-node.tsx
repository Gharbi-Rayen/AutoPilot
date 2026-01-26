"use client";

import type { ComponentType, ReactNode } from "react";
import { memo } from "react";

import { type NodeProps, Position } from "@xyflow/react";
import Image from "next/image";

import { BaseHandle } from "../../../components/react-flow/base-handle";
import { BaseNode, BaseNodeContent } from "../../../components/react-flow/base-node";
import { WorkflowNode } from "../../../components/workflow-node";

interface BaseTriggerNodeProps extends NodeProps {
    icon: ComponentType<{ className?: string }> | string;
    name: string;
    description?: string;
    children?: ReactNode;
    // status?: NodeStatus;
    onSettings?: () => void;
    onDoubleClick?: () => void;
}

export const BaseTriggerNode = memo(({
    icon: Icon,
    name,
    description,
    children,
    onSettings,
    onDoubleClick,
}: BaseTriggerNodeProps) => {

    return (
        <WorkflowNode
        name={name}
        description={description}
        onSettings={onSettings}
        onDelete={undefined}
        >
        <BaseNode onDoubleClick={onDoubleClick} className="rounded-l-2xl relative group">

        {/* TODO : wrap within Node Status Indicator */ }
            <BaseNodeContent>
                {typeof Icon === "string" ? (
                    <Image 
                    src={Icon} alt={`${name} icon`} className="size-6" width={24} height={24} />
                ) : (
                    <Icon className="size-4 text-muted-foreground"  />
                )}
                {children}
              
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
BaseTriggerNode.displayName = "BaseTriggerNode";