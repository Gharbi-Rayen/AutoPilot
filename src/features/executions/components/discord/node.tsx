"use client";

import { type NodeProps, useReactFlow } from "@xyflow/react";
import { memo, useState } from "react";

import { BaseExecutionNode } from "@/features/executions/components/base-execution-node";
import { DISCORD_CHANNEL_NAME } from "@/inngest/channels/discord";
import { useNodeStatus } from "../../hooks/use-node-status";
import { fetchDiscordRealTimeToken } from "./actions";
import { DiscordDialog, type DiscordFormValues } from "./dialog";

interface DiscordNodeData extends Record<string, unknown> {
  credentialId?: string;
  variableName?: string;
  content?: string;
  username?: string;
  avatarUrl?: string;
}

export const DiscordNode = memo((props: NodeProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { setNodes } = useReactFlow();

  const handleSubmit = (values: DiscordFormValues) => {
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

  const data = props.data as DiscordNodeData;
  const description = data?.content
    ? `Send: ${data.content.slice(0, 50)}${data.content.length > 50 ? "..." : ""}`
    : "Not configured";

  const nodeStatus = useNodeStatus({
    nodeId: props.id,
    channel: DISCORD_CHANNEL_NAME,
    topic: "status",
    refreshToken: fetchDiscordRealTimeToken,
  });

  return (
    <>
      <DiscordDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
        defaultValues={data}
      />
      <BaseExecutionNode
        {...props}
        id={props.id}
        name="Discord"
        description={description}
        icon="/logos/discord.svg"
        status={nodeStatus}
        onSettings={handleOpenSettings}
        onDoubleClick={handleOpenSettings}
      />
    </>
  );
});

DiscordNode.displayName = "DiscordNode";
