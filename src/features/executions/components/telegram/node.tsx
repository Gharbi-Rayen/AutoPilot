"use client";

import { type NodeProps, useReactFlow } from "@xyflow/react";
import { memo, useState } from "react";

import { BaseExecutionNode } from "@/features/executions/components/base-execution-node";
import { TELEGRAM_CHANNEL_NAME } from "@/inngest/channels/telegram";
import { useNodeStatus } from "../../hooks/use-node-status";
import { fetchTelegramRealTimeToken } from "./actions";
import { TelegramDialog, type TelegramFormValues } from "./dialog";

interface TelegramNodeData extends Record<string, unknown> {
  credentialId?: string;
  variableName?: string;
  chatId?: string;
  text?: string;
  parseMode?: "none" | "HTML" | "MarkdownV2";
}

export const TelegramNode = memo((props: NodeProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { setNodes } = useReactFlow();

  const handleSubmit = (values: TelegramFormValues) => {
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

  const data = props.data as TelegramNodeData;
  const description = data?.chatId ? `To: ${data.chatId}` : "Not configured";

  const nodeStatus = useNodeStatus({
    nodeId: props.id,
    channel: TELEGRAM_CHANNEL_NAME,
    topic: "status",
    refreshToken: fetchTelegramRealTimeToken,
  });

  return (
    <>
      <TelegramDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
        defaultValues={data}
      />
      <BaseExecutionNode
        {...props}
        id={props.id}
        name="Telegram"
        description={description}
        icon="/logos/telegram.svg"
        status={nodeStatus}
        onSettings={handleOpenSettings}
        onDoubleClick={handleOpenSettings}
      />
    </>
  );
});

TelegramNode.displayName = "TelegramNode";
