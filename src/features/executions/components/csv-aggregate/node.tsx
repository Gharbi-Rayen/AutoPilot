"use client";

import { type NodeProps, useReactFlow } from "@xyflow/react";
import { Sigma } from "lucide-react";
import { memo, useState } from "react";

import { BaseExecutionNode } from "@/features/executions/components/base-execution-node";
import { FILE_CHANNEL_NAME } from "@/inngest/channels/file";
import { useNodeStatus } from "../../hooks/use-node-status";
import { fetchFileRealTimeToken } from "../download-file/actions";
import {
  CsvAggregateDialog,
  type CsvAggregateFormValues,
} from "./dialog";

interface CsvAggregateNodeData extends Record<string, unknown> {
  sourceVariable?: string;
  variableName?: string;
  groupBy?: string;
  operation?: string;
  targetField?: string;
}

export const CsvAggregateNode = memo((props: NodeProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { setNodes } = useReactFlow();

  const handleSubmit = (values: CsvAggregateFormValues) => {
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

  const data = props.data as CsvAggregateNodeData;
  const description = data?.groupBy
    ? `Group by ${data.groupBy}`
    : "Aggregate CSV records";

  const nodeStatus = useNodeStatus({
    nodeId: props.id,
    channel: FILE_CHANNEL_NAME,
    topic: "status",
    refreshToken: fetchFileRealTimeToken,
  });

  return (
    <>
      <CsvAggregateDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
        defaultValues={data}
      />
      <BaseExecutionNode
        {...props}
        id={props.id}
        name="CSV Aggregate"
        description={description}
        icon={Sigma}
        status={nodeStatus}
        onSettings={handleOpenSettings}
        onDoubleClick={handleOpenSettings}
      />
    </>
  );
});

CsvAggregateNode.displayName = "CsvAggregateNode";