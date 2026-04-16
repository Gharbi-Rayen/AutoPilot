"use client";

import { type NodeProps, useReactFlow } from "@xyflow/react";
import { memo, useState } from "react";

import { BaseExecutionNode } from "@/features/executions/components/base-execution-node";

import { useNodeStatus } from "../../hooks/use-node-status";
import { PdfFillFormDialog, type PdfFillFormFormValues } from "./dialog";

interface PdfFillFormNodeData extends Record<string, unknown> {
  pdfVariable?: string;
  formDataVariable?: string;
  variableName?: string;
}

export const PdfFillFormNode = memo((props: NodeProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { setNodes } = useReactFlow();

  const handleSubmit = (values: PdfFillFormFormValues) => {
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

  const data = props.data as PdfFillFormNodeData;
  const description = data.pdfVariable
    ? `Fill form: ${data.pdfVariable}`
    : "Fill PDF form fields";

  const nodeStatus = useNodeStatus(props.id);

  return (
    <>
      <PdfFillFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
        defaultValues={data}
      />
      <BaseExecutionNode
        {...props}
        id={props.id}
        name="PDF Fill Form"
        description={description}
        icon="/logos/pdf-fill-form.svg"
        status={nodeStatus}
        onSettings={handleOpenSettings}
        onDoubleClick={handleOpenSettings}
      />
    </>
  );
});

PdfFillFormNode.displayName = "PdfFillFormNode";
