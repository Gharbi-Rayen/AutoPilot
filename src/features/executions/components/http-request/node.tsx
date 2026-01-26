"use client";

import type {Node , NodeProps } from "@xyflow/react";

import { GlobeIcon } from "lucide-react";
import { memo } from "react";
import { BaseExecutionNode } from "@/features/executions/components/base-execution-node";

type HttpRequestNodeData = {
    endpoint : string;
    method : "GET" | "POST" | "PUT" | "DELETE";
    body ?: string;
    [key : string]: unknown;
};

type HttpRequestNodeProps = Node<HttpRequestNodeData>;

export const HttpRequestNode = memo((props: NodeProps<HttpRequestNodeProps>) => {
    const nodeData = props.data as HttpRequestNodeData;
    const decription = nodeData?.endpoint
        ? `${nodeData.method || "GET"} : ${nodeData.endpoint}`
        : "Not configured";

    return (
        <>
        <BaseExecutionNode
        {...props}
        id = {props.id}
        name="HTTP Request"
        description={decription}
        icon={GlobeIcon}
        onSettings={() => {}}
        onDoubleClick={() => {}}
        />
        </>
    )
});

HttpRequestNode.displayName = "HttpRequestNode";