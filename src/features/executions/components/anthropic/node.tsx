"use client";

import { type NodeProps, useReactFlow } from "@xyflow/react";
import { memo, useState } from "react";

import { BaseExecutionNode } from "@/features/executions/components/base-execution-node";
import { ANTHROPIC_CHANNEL_NAME } from "@/inngest/channels/anthropic";
import { useNodeStatus } from "../../hooks/use-node-status";
import { fetchAnthropicRealTimeToken } from "./actions";
import {
  AnthropicDialog,
  type AnthropicFormValues,
  DEFAULT_MODEL,
} from "./dialog";

export const AnthropicNode = memo((props: NodeProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { setNodes } = useReactFlow();

  const handleSubmit = (values: AnthropicFormValues) => {
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
    channel: ANTHROPIC_CHANNEL_NAME,
    topic: "status",
    refreshToken: fetchAnthropicRealTimeToken,
  });

  return (
    <>
      <AnthropicDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
        defaultValues={data as Partial<AnthropicFormValues>}
      />
      <BaseExecutionNode
        {...props}
        id={props.id}
        name="Anthropic"
        description={description}
        icon="/logos/anthropic.svg"
        status={nodeStatus}
        onSettings={handleOpenSettings}
        onDoubleClick={handleOpenSettings}
      />
    </>
  );
});

AnthropicNode.displayName = "AnthropicNode";
