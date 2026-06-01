"use client";

import { type NodeProps, useReactFlow } from "@xyflow/react";
import { FileText } from "lucide-react";
import { memo, useState } from "react";

import { BaseExecutionNode } from "@/features/executions/components/base-execution-node";
import { useNodeStatus } from "../../hooks/use-node-status";
import { PdfExtractTextDialog, type PdfExtractTextFormValues } from "./dialog";

interface PdfExtractTextNodeData extends Record<string, unknown> {
  pdfVariable?: string;
  variableName?: string;
  fromPage?: number;
  toPage?: number;
  cleanText?: boolean;
  includeMetadata?: boolean;
}

export const PdfExtractTextNode = memo((props: NodeProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { setNodes } = useReactFlow();

  const handleSubmit = (values: PdfExtractTextFormValues) => {
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

  const data = props.data as PdfExtractTextNodeData;
  const pageRange = data.fromPage || data.toPage
    ? ` (p${data.fromPage ?? 1}–${data.toPage ?? "end"})`
    : "";
  const description = data?.pdfVariable
    ? `${data.pdfVariable}${pageRange}`
    : "Extract text from PDF";

  const nodeStatus = useNodeStatus(props.id);

  return (
    <>
      <PdfExtractTextDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
        defaultValues={data}
        nodeId={props.id}
      />
      <BaseExecutionNode
        {...props}
        id={props.id}
        name="PDF Extract Text"
        description={description}
        icon={FileText}
        status={nodeStatus}
        onSettings={handleOpenSettings}
        onDoubleClick={handleOpenSettings}
      />
    </>
  );
});

PdfExtractTextNode.displayName = "PdfExtractTextNode";
