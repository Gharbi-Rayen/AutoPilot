import type { NodeProps } from "@xyflow/react";import { memo, useState } from "react";
import { BaseTriggerNode } from "../base-trigger-node";
import { GoogleFormDialog } from "./dialog";
import { useNodeStatus } from "@/features/executions/hooks/use-node-status";
import { fetchGoogleFormTriggerRealTimeToken } from "./actions";
import { GOOGLE_FORM_TRIGGER_CHANNEL_NAME } from "@/inngest/channels/google-form-trigger";

export const GoogleFormTrigger = memo((props: NodeProps) => {
  const [DialogOpen, setDialogOpen] = useState(false);

  const nodeStatus = useNodeStatus({
        nodeId : props.id,
        channel : GOOGLE_FORM_TRIGGER_CHANNEL_NAME,
        topic : "status",
        refreshToken : fetchGoogleFormTriggerRealTimeToken,
      });




  const handleOpenSettings = () => setDialogOpen(true);

  return (
    <>
      <GoogleFormDialog open={DialogOpen} onOpenChange={setDialogOpen} />
      <BaseTriggerNode
        {...props}
        icon="/logos/googleform.svg"
        name="Google Form "
        status={nodeStatus}
        description="This trigger starts When a form is submitted."
        onSettings={handleOpenSettings}
        onDoubleClick={handleOpenSettings}
      />
    </>
  );
});
