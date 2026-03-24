"use client";

import { type NodeProps, useReactFlow } from "@xyflow/react";
import { memo, useState } from "react";

import { BaseExecutionNode } from "@/features/executions/components/base-execution-node";
import { GEMINI_CHANNEL_NAME } from "@/inngest/channels/gemini";
import { useNodeStatus } from "../../hooks/use-node-status";
import { fetchGeminiRealTimeToken } from "./actions";
import { DEFAULT_MODEL, GeminiDialog, type GeminiFormValues } from "./dialog";

export const GeminiNode = memo((props: NodeProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { setNodes } = useReactFlow();

  const handleSubmit = (values: GeminiFormValues) => {
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

  const data = props.data as Record<string, unknown>;
  const description = data?.userPrompt
    ? `${(data?.model as string) || DEFAULT_MODEL} : ${(data.userPrompt as string).slice(0, 50)}...`
    : "Not configured";

  const nodeStatus = useNodeStatus({
    nodeId: props.id,
    channel: GEMINI_CHANNEL_NAME,
    topic: "status",
    refreshToken: fetchGeminiRealTimeToken,
  });

  return (
    <>
      <GeminiDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
        defaultValues={data as Partial<GeminiFormValues>}
      />
      <BaseExecutionNode
        {...props}
        id={props.id}
        name="Gemini"
        description={description}
        icon="/logos/gemini.svg"
        status={nodeStatus}
        onSettings={handleOpenSettings}
        onDoubleClick={handleOpenSettings}
      />
    </>
  );
});

GeminiNode.displayName = "GeminiNode";
