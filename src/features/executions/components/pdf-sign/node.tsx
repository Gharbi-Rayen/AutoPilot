"use client";

import { type NodeProps, useReactFlow } from "@xyflow/react";
import { memo, useState } from "react";

import { BaseExecutionNode } from "@/features/executions/components/base-execution-node";

import { useNodeStatus } from "../../hooks/use-node-status";
import { PdfSignDialog, type PdfSignFormValues } from "./dialog";

interface PdfSignNodeData extends Record<string, unknown> {
  pdfVariable?: string;
  certificateVariable?: string;
  variableName?: string;
}

export const PdfSignNode = memo((props: NodeProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { setNodes } = useReactFlow();

  const handleSubmit = (values: PdfSignFormValues) => {
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

  const data = props.data as PdfSignNodeData;
  const description = data.pdfVariable
    ? `Sign: ${data.pdfVariable}`
    : "Apply signature to PDF";

  const nodeStatus = useNodeStatus(props.id);

  return (
    <>
      <PdfSignDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
        defaultValues={data}
        nodeId={props.id}
      />
      <BaseExecutionNode
        {...props}
        id={props.id}
        name="PDF Sign"
        description={description}
        icon="/logos/pdf-sign.svg"
        status={nodeStatus}
        onSettings={handleOpenSettings}
        onDoubleClick={handleOpenSettings}
      />
    </>
  );
});

PdfSignNode.displayName = "PdfSignNode";
