"use client";

import { type NodeProps, useReactFlow } from "@xyflow/react";
import { memo, useState } from "react";

import { BaseExecutionNode } from "@/features/executions/components/base-execution-node";
import { WHATSAPP_CHANNEL_NAME } from "@/inngest/channels/whatsapp";
import { useNodeStatus } from "../../hooks/use-node-status";
import { fetchWhatsAppRealTimeToken } from "./actions";
import { WhatsAppDialog, type WhatsAppFormValues } from "./dialog";

interface WhatsAppNodeData extends Record<string, unknown> {
  credentialId?: string;
  variableName?: string;
  phoneNumberId?: string;
  recipientPhone?: string;
  text?: string;
  enablePreview?: boolean;
}

export const WhatsAppNode = memo((props: NodeProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { setNodes } = useReactFlow();

  const handleSubmit = (values: WhatsAppFormValues) => {
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

  const data = props.data as WhatsAppNodeData;
  const description = data?.recipientPhone
    ? `To: ${data.recipientPhone}`
    : "Not configured";

  const nodeStatus = useNodeStatus({
    nodeId: props.id,
    channel: WHATSAPP_CHANNEL_NAME,
    topic: "status",
    refreshToken: fetchWhatsAppRealTimeToken,
  });

  return (
    <>
      <WhatsAppDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
        defaultValues={data}
      />
      <BaseExecutionNode
        {...props}
        id={props.id}
        name="WhatsApp"
        description={description}
        icon="/logos/whatsapp.svg"
        status={nodeStatus}
        onSettings={handleOpenSettings}
        onDoubleClick={handleOpenSettings}
      />
    </>
  );
});

WhatsAppNode.displayName = "WhatsAppNode";
