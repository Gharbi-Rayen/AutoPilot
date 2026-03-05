"use client";

import { type NodeProps, useReactFlow } from "@xyflow/react";
import { memo, useState } from "react";

import { BaseExecutionNode } from "@/features/executions/components/base-execution-node";
import { EMAIL_CHANNEL_NAME } from "@/inngest/channels/email";
import { useNodeStatus } from "../../hooks/use-node-status";
import { fetchEmailRealTimeToken } from "./actions";
import { EmailDialog, type EmailFormValues } from "./dialog";

interface EmailNodeData extends Record<string, unknown> {
  credentialId?: string;
  variableName?: string;
  smtpService?: string;
  smtpHost?: string;
  smtpPort?: string;
  smtpSecure?: boolean;
  fromEmail?: string;
  toEmail?: string;
  subject?: string;
  body?: string;
  isHtml?: boolean;
}

export const EmailNode = memo((props: NodeProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { setNodes } = useReactFlow();

  const handleSubmit = (values: EmailFormValues) => {
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

  const data = props.data as EmailNodeData;
  const description = data?.toEmail
    ? `To: ${data.toEmail.length > 30 ? `${data.toEmail.slice(0, 30)}...` : data.toEmail}`
    : "Not configured";

  const nodeStatus = useNodeStatus({
    nodeId: props.id,
    channel: EMAIL_CHANNEL_NAME,
    topic: "status",
    refreshToken: fetchEmailRealTimeToken,
  });

  return (
    <>
      <EmailDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
        defaultValues={data}
      />
      <BaseExecutionNode
        {...props}
        id={props.id}
        name="Email (SMTP)"
        description={description}
        icon="/logos/gmail.svg"
        status={nodeStatus}
        onSettings={handleOpenSettings}
        onDoubleClick={handleOpenSettings}
      />
    </>
  );
});

EmailNode.displayName = "EmailNode";
