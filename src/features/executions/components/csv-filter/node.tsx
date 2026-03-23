"use client";

import { type NodeProps, useReactFlow } from "@xyflow/react";
import { Filter } from "lucide-react";
import { memo, useState } from "react";

import { BaseExecutionNode } from "@/features/executions/components/base-execution-node";
import { FILE_CHANNEL_NAME } from "@/inngest/channels/file";
import { useNodeStatus } from "../../hooks/use-node-status";
import { fetchFileRealTimeToken } from "../download-file/actions";
import { CsvFilterDialog, type CsvFilterFormValues } from "./dialog";

interface CsvFilterNodeData extends Record<string, unknown> {
  sourceVariable?: string;
  variableName?: string;
  field?: string;
  operator?: "eq" | "ne" | "contains" | "not_contains" | "starts_with" | "ends_with" | "gt" | "gte" | "lt" | "lte" | "is_empty" | "is_not_empty";
  value?: string;
}

export const CsvFilterNode = memo((props: NodeProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { setNodes } = useReactFlow();

  const handleSubmit = (values: CsvFilterFormValues) => {
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

  const data = props.data as CsvFilterNodeData;
  const description = data?.field
    ? `Filter by ${data.field}`
    : "Filter CSV records";

  const nodeStatus = useNodeStatus({
    nodeId: props.id,
    channel: FILE_CHANNEL_NAME,
    topic: "status",
    refreshToken: fetchFileRealTimeToken,
  });

  return (
    <>
      <CsvFilterDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
        defaultValues={data}
      />
      <BaseExecutionNode
        {...props}
        id={props.id}
        name="CSV Filter"
        description={description}
        icon={Filter}
        status={nodeStatus}
        onSettings={handleOpenSettings}
        onDoubleClick={handleOpenSettings}
      />
    </>
  );
});

CsvFilterNode.displayName = "CsvFilterNode";