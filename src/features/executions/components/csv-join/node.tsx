"use client";

import { type NodeProps, useReactFlow } from "@xyflow/react";
import { Link2 } from "lucide-react";
import { memo, useState } from "react";

import { BaseExecutionNode } from "@/features/executions/components/base-execution-node";
import { FILE_CHANNEL_NAME } from "@/inngest/channels/file";
import { useNodeStatus } from "../../hooks/use-node-status";
import { fetchFileRealTimeToken } from "../download-file/actions";
import { CsvJoinDialog, type CsvJoinFormValues } from "./dialog";

interface CsvJoinNodeData extends Record<string, unknown> {
  leftVariable?: string;
  rightVariable?: string;
  leftKey?: string;
  rightKey?: string;
  joinType?:
    | "inner"
    | "left"
    | "right"
    | "full"
    | "left_exclusive"
    | "right_exclusive";
  variableName?: string;
}

export const CsvJoinNode = memo((props: NodeProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { setNodes } = useReactFlow();

  const handleSubmit = (values: CsvJoinFormValues) => {
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

  const data = props.data as CsvJoinNodeData;
  const description = data?.joinType
    ? `${data.joinType} join`
    : "Join two CSV datasets";

  const nodeStatus = useNodeStatus({
    nodeId: props.id,
    channel: FILE_CHANNEL_NAME,
    topic: "status",
    refreshToken: fetchFileRealTimeToken,
  });

  return (
    <>
      <CsvJoinDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
        defaultValues={data}
      />
      <BaseExecutionNode
        {...props}
        id={props.id}
        name="CSV Join"
        description={description}
        icon={Link2}
        status={nodeStatus}
        onSettings={handleOpenSettings}
        onDoubleClick={handleOpenSettings}
      />
    </>
  );
});

CsvJoinNode.displayName = "CsvJoinNode";
