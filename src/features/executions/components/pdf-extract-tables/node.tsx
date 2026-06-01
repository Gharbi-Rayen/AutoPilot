"use client";

import { type NodeProps, useReactFlow } from "@xyflow/react";
import { Table2 } from "lucide-react";
import { memo, useState } from "react";

import { BaseExecutionNode } from "@/features/executions/components/base-execution-node";

import { useNodeStatus } from "../../hooks/use-node-status";
import {
  PdfExtractTablesDialog,
  type PdfExtractTablesFormValues,
} from "./dialog";

interface PdfExtractTablesNodeData extends Record<string, unknown> {
  pdfVariable?: string;
  variableName?: string;
  fromPage?: number;
  toPage?: number;
  hasHeaderRow?: boolean;
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
  const pageRange = data.fromPage || data.toPage
    ? ` (p${data.fromPage ?? 1}–${data.toPage ?? "end"})`
    : "";
  const description = data.pdfVariable
    ? `${data.pdfVariable}${pageRange} → dataset`
    : "Extract tables → dataset";

  const nodeStatus = useNodeStatus(props.id);

  return (
    <>
      <PdfExtractTablesDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
        defaultValues={data}
        nodeId={props.id}
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
