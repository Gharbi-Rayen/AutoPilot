"use client";

import { type NodeProps, useReactFlow } from "@xyflow/react";
import { BarChart3 } from "lucide-react";
import { memo, useState } from "react";

import { BaseExecutionNode } from "@/features/executions/components/base-execution-node";
import { FILE_CHANNEL_NAME } from "@/inngest/channels/file";

import { useNodeStatus } from "../../hooks/use-node-status";
import { fetchFileRealTimeToken } from "../upload-file/actions";
import { CsvColumnStatsDialog, type CsvColumnStatsFormValues } from "./dialog";

interface CsvColumnStatsNodeData extends Record<string, unknown> {
  sourceVariable?: string;
  variableName?: string;
  fields?: string;
}

export const CsvColumnStatsNode = memo((props: NodeProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { setNodes } = useReactFlow();

  const handleSubmit = (values: CsvColumnStatsFormValues) => {
    setNodes((nodes) =>
      nodes.map((node) => {
        if (node.id !== props.id) {
          return node;
        }

        return {
          ...node,
          data: {
            ...node.data,
            ...values,
          },
        };
      }),
    );
  };

  const handleOpenSettings = () => setDialogOpen(true);

  const data = props.data as CsvColumnStatsNodeData;
  const description = data.fields
    ? `Stats for ${data.fields}`
    : "Generate column statistics";

  const nodeStatus = useNodeStatus({
    nodeId: props.id,
    channel: FILE_CHANNEL_NAME,
    topic: "status",
    refreshToken: fetchFileRealTimeToken,
  });

  return (
    <>
      <CsvColumnStatsDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
        defaultValues={data}
      />
      <BaseExecutionNode
        {...props}
        id={props.id}
        name="CSV Column Stats"
        description={description}
        icon={BarChart3}
        status={nodeStatus}
        onSettings={handleOpenSettings}
        onDoubleClick={handleOpenSettings}
      />
    </>
  );
});

CsvColumnStatsNode.displayName = "CsvColumnStatsNode";
