"use client";

import type { NodeProps } from "@xyflow/react";
import { PlusIcon } from "lucide-react";
import {memo } from "react";
import { PlaceholderNode } from "@/components/react-flow/placeholder-node";
import { WorkflowNode } from "./workflow-node";

export const InitialNode = memo((props: NodeProps) => {
    return (
        <WorkflowNode name="initial_node" description="This is the initial node of the workflow.">
            <PlaceholderNode {...props}>
                <div className="flex items-center justify-center" aria-label="Initial workflow node">
                  <PlusIcon className="size-4" />
                </div>
            </PlaceholderNode>
        </WorkflowNode>
    );
});