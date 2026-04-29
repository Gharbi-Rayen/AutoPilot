"use client";

import { type NodeProps, useReactFlow } from "@xyflow/react";
import { FileText } from "lucide-react";
import { memo, useState } from "react";

import { BaseExecutionNode } from "@/features/executions/components/base-execution-node";

import { useNodeStatus } from "../../hooks/use-node-status";
import { PdfGenerateDialog, type PdfGenerateFormValues } from "./dialog";

interface PdfGenerateNodeData extends Record<string, unknown> {
  variableName?: string;
  contentVariable?: string;
  title?: string;
  fileName?: string;
}

export const PdfGenerateNode = memo((props: NodeProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { setNodes } = useReactFlow();

  const handleSubmit = (values: PdfGenerateFormValues) => {
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

  const data = props.data as PdfGenerateNodeData;
  const description = data?.variableName
    ? `Generate: ${data.variableName}`
    : "Generate PDF from text";

  const nodeStatus = useNodeStatus(props.id);

  return (
    <>
      <PdfGenerateDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
        defaultValues={data}
        nodeId={props.id}
      />
      <BaseExecutionNode
        {...props}
        id={props.id}
        name="PDF Generate"
        description={description}
        icon={FileText}
        status={nodeStatus}
        onSettings={handleOpenSettings}
        onDoubleClick={handleOpenSettings}
      />
    </>
  );
});

PdfGenerateNode.displayName = "PdfGenerateNode";
