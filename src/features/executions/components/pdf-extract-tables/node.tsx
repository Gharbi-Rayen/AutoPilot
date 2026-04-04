"use client";

import { type NodeProps, useReactFlow } from "@xyflow/react";
import { Table2 } from "lucide-react";
import { memo, useState } from "react";

import { BaseExecutionNode } from "@/features/executions/components/base-execution-node";
import { FILE_CHANNEL_NAME } from "@/inngest/channels/file";

import { useNodeStatus } from "../../hooks/use-node-status";
import { fetchFileRealTimeToken } from "../upload-file/actions";
import {
  PdfExtractTablesDialog,
  type PdfExtractTablesFormValues,
} from "./dialog";

interface PdfExtractTablesNodeData extends Record<string, unknown> {
  pdfVariable?: string;
  variableName?: string;
}

export const PdfExtractTablesNode = memo((props: NodeProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { setNodes } = useReactFlow();

  const handleSubmit = (values: PdfExtractTablesFormValues) => {
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

  const data = props.data as PdfExtractTablesNodeData;
  const description = data.pdfVariable
    ? `Extract tables: ${data.pdfVariable}`
    : "Extract tables from PDF";

  const nodeStatus = useNodeStatus({
    nodeId: props.id,
    channel: FILE_CHANNEL_NAME,
    topic: "status",
    refreshToken: fetchFileRealTimeToken,
  });

  return (
    <>
      <PdfExtractTablesDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
        defaultValues={data}
      />
      <BaseExecutionNode
        {...props}
        id={props.id}
        name="PDF Extract Tables"
        description={description}
        icon={Table2}
        status={nodeStatus}
        onSettings={handleOpenSettings}
        onDoubleClick={handleOpenSettings}
      />
    </>
  );
});

PdfExtractTablesNode.displayName = "PdfExtractTablesNode";
