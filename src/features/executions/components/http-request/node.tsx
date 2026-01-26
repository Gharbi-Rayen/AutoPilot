"use client";

import { memo } from "react";

import type { NodeProps } from "@xyflow/react";
import { GlobeIcon } from "lucide-react";

import { BaseExecutionNode } from "@/features/executions/components/base-execution-node";

interface HttpRequestNodeData extends Record<string, unknown> {
    endpoint?: string;
    method?: "GET" | "POST" | "PUT" | "DELETE";
    body?: string;
}

export const HttpRequestNode = memo((props: NodeProps) => {
    const data = props.data as HttpRequestNodeData;
    const description = data?.endpoint
        ? `${data?.method || "GET"} : ${data.endpoint}`
        : "Not configured";

    return (
        <BaseExecutionNode
            {...props}
            name="HTTP Request"
            description={description}
            icon={GlobeIcon}
            onSettings={() => {}}
            onDoubleClick={() => {}}
        />
    );
});

HttpRequestNode.displayName = "HttpRequestNode";