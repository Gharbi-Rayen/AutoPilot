"use client";

import { type NodeProps, useReactFlow } from "@xyflow/react";
import { FileStack } from "lucide-react";
import { memo, useState } from "react";

import { BaseExecutionNode } from "@/features/executions/components/base-execution-node";

import { useNodeStatus } from "../../hooks/use-node-status";
import { PdfMergeDialog, type PdfMergeFormValues } from "./dialog";

interface PdfMergeNodeData extends Record<string, unknown> {
  pdfVariables?: string;
  variableName?: string;
  fileName?: string;
}

export const PdfMergeNode = memo((props: NodeProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { setNodes } = useReactFlow();

  const handleSubmit = (values: PdfMergeFormValues) => {
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

  const data = props.data as PdfMergeNodeData;
  const description = data.pdfVariables
    ? `Merge: ${data.pdfVariables}`
    : "Merge multiple PDF files";

  const nodeStatus = useNodeStatus(props.id);

  return (
    <>
      <PdfMergeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
        defaultValues={data}
      />
      <BaseExecutionNode
        {...props}
        id={props.id}
        name="PDF Merge"
        description={description}
        icon={FileStack}
        status={nodeStatus}
        onSettings={handleOpenSettings}
        onDoubleClick={handleOpenSettings}
      />
    </>
  );
});

PdfMergeNode.displayName = "PdfMergeNode";
