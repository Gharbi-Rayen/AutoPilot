"use client";

import { type NodeProps, useReactFlow } from "@xyflow/react";
import { memo, useState } from "react";

import { BaseExecutionNode } from "@/features/executions/components/base-execution-node";
import { CODE_CHANNEL_NAME } from "@/inngest/channels/code";
import { useNodeStatus } from "../../hooks/use-node-status";
import { fetchCodeRealTimeToken } from "./actions";
import type { CodeLanguage } from "./dialog";
import { CodeDialog, type CodeFormValues } from "./dialog";

interface CodeNodeData extends Record<string, unknown> {
  language?: CodeLanguage;
  variableName?: string;
  code?: string;
}

export const CodeNode = memo((props: NodeProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { setNodes } = useReactFlow();

  const handleSubmit = (values: CodeFormValues) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === props.id) {
          return {
            ...node,
            data: {
              ...node.data,
              ...values,
            },
          };
        }
        return node;
      }),
    );
  };

  const handleOpenSettings = () => setDialogOpen(true);

  const data = props.data as CodeNodeData;
  const lang = data?.language === "java" ? "Java" : "JavaScript";
  const description = data?.code ? `${lang} · Configured` : "Not configured";

  const nodeStatus = useNodeStatus({
    nodeId: props.id,
    channel: CODE_CHANNEL_NAME,
    topic: "status",
    refreshToken: fetchCodeRealTimeToken,
  });

  return (
    <>
      <CodeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
        defaultValues={data}
      />
      <BaseExecutionNode
        {...props}
        id={props.id}
        name="Code"
        description={description}
        icon="/logos/code.svg"
        status={nodeStatus}
        onSettings={handleOpenSettings}
        onDoubleClick={handleOpenSettings}
      />
    </>
  );
});

CodeNode.displayName = "CodeNode";
