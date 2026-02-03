import type { NodeProps } from "@xyflow/react";
import { MousePointerIcon } from "lucide-react";
import { memo, useState } from "react";
import { BaseTriggerNode } from "../base-trigger-node";
import { ManualTriggerDialog } from "./dialog";
import { MANUAL_TRIGGER_CHANNEL_NAME } from "@/inngest/channels/manual-triggers";
import { useNodeStatus } from "@/features/executions/hooks/use-node-status";
import { fetchManualTriggerRealTimeToken } from "./actions";

export const ManualTriggerNode = memo((props: NodeProps) => {
  const [DialogOpen, setDialogOpen] = useState(false);

  const nodeStatus = useNodeStatus({
      nodeId : props.id,
      channel : MANUAL_TRIGGER_CHANNEL_NAME,
      topic : "status",
      refreshToken : fetchManualTriggerRealTimeToken,
    });

  const handleOpenSettings = () => setDialogOpen(true);

  return (
    <>
      <ManualTriggerDialog open={DialogOpen} onOpenChange={setDialogOpen} />
      <BaseTriggerNode
        {...props}
        icon={MousePointerIcon}
        name="When Clicking 'Execute workflow' "
        status={nodeStatus}
        description="This trigger starts the workflow manually."
        onSettings={handleOpenSettings}
        onDoubleClick={handleOpenSettings}
      />
    </>
  );
});
