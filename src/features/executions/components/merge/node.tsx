"use client";

import { type NodeProps, useReactFlow } from "@xyflow/react";
import { Combine } from "lucide-react";
import { memo, useState } from "react";

import { BaseExecutionNode } from "@/features/executions/components/base-execution-node";
import { FILE_CHANNEL_NAME } from "@/inngest/channels/file";
import { useNodeStatus } from "../../hooks/use-node-status";
import { fetchFileRealTimeToken } from "../download-file/actions";
import { MergeDialog, type MergeFormValues } from "./dialog";

interface MergeNodeData extends Record<string, unknown> {
  leftVariable?: string;
  rightVariable?: string;
  strategy?: "concat" | "zip" | "by_key";
  leftKey?: string;
  rightKey?: string;
  variableName?: string;
}

export const MergeNode = memo((props: NodeProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { setNodes } = useReactFlow();

  const handleSubmit = (values: MergeFormValues) => {
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

  const data = props.data as MergeNodeData;
  const description =
    data?.strategy === "by_key"
      ? "Merge records by matching key"
      : data?.strategy === "zip"
        ? "Zip left and right data by index"
        : "Merge two datasets";

  const nodeStatus = useNodeStatus({
    nodeId: props.id,
    channel: FILE_CHANNEL_NAME,
    topic: "status",
    refreshToken: fetchFileRealTimeToken,
  });

  return (
    <>
      <MergeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
        defaultValues={data}
      />
      <BaseExecutionNode
        {...props}
        id={props.id}
        name="Merge"
        description={description}
        icon={Combine}
        status={nodeStatus}
        onSettings={handleOpenSettings}
        onDoubleClick={handleOpenSettings}
      />
    </>
  );
});

MergeNode.displayName = "MergeNode";
