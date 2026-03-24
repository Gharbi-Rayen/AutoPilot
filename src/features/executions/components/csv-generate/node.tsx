"use client";

import { type NodeProps, useReactFlow } from "@xyflow/react";
import { FileSpreadsheet } from "lucide-react";
import { memo, useState } from "react";

import { BaseExecutionNode } from "@/features/executions/components/base-execution-node";
import { FILE_CHANNEL_NAME } from "@/inngest/channels/file";
import { useNodeStatus } from "../../hooks/use-node-status";
import { fetchFileRealTimeToken } from "../download-file/actions";
import { CsvGenerateDialog, type CsvGenerateFormValues } from "./dialog";

interface CsvGenerateNodeData extends Record<string, unknown> {
  sourceVariable?: string;
  variableName?: string;
  delimiter?: string;
  includeHeader?: boolean;
}

export const CsvGenerateNode = memo((props: NodeProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { setNodes } = useReactFlow();

  const handleSubmit = (values: CsvGenerateFormValues) => {
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

  const data = props.data as CsvGenerateNodeData;
  const description = data?.sourceVariable
    ? `From: ${data.sourceVariable}`
    : "Generate CSV from records";

  const nodeStatus = useNodeStatus({
    nodeId: props.id,
    channel: FILE_CHANNEL_NAME,
    topic: "status",
    refreshToken: fetchFileRealTimeToken,
  });

  return (
    <>
      <CsvGenerateDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
        defaultValues={data}
      />
      <BaseExecutionNode
        {...props}
        id={props.id}
        name="CSV Generate"
        description={description}
        icon={FileSpreadsheet}
        status={nodeStatus}
        onSettings={handleOpenSettings}
        onDoubleClick={handleOpenSettings}
      />
    </>
  );
});

CsvGenerateNode.displayName = "CsvGenerateNode";
