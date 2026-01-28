"use client";

import type { ComponentType, ReactNode } from "react";
import { memo } from "react";

import { type NodeProps, Position, useReactFlow } from "@xyflow/react";
import Image from "next/image";

import { BaseHandle } from "../../../components/react-flow/base-handle";
import { BaseNode, BaseNodeContent } from "../../../components/react-flow/base-node";
import { WorkflowNode } from "../../../components/workflow-node";
import { type NodeStatus , NodeStatusIndicator } from "@/components/react-flow/node-status-indicator";

interface BaseExecutionNodeProps extends NodeProps {
    icon: ComponentType<{ className?: string }> | string;
    name: string;
    description?: string;
    children?: ReactNode;
    status?: NodeStatus;
    onSettings?: () => void;
    onDoubleClick?: () => void;
}

export const BaseExecutionNode = memo(({
    id,
    icon: Icon,
    name,
    description,
    children,
    status = "initial",
    onSettings,
    onDoubleClick,
}: BaseExecutionNodeProps) => {
    
        const {setNodes , setEdges} =  useReactFlow();
    
        const handleDelete = () => {
            setNodes((nds) => {
                const updatedNodes =   nds.filter((n) => n.id !== id);
                return updatedNodes;
            });
    
            setEdges((eds) => {
                const updatedEdges = eds.filter((e) => e.source !== id && e.target !== id);
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

          <NodeStatusIndicator status={status} variant="border">  
        <BaseNode status={status} onDoubleClick={onDoubleClick}>

        
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
        </NodeStatusIndicator>
        </WorkflowNode>
    );
});

BaseExecutionNode.displayName = "BaseExecutionNode";