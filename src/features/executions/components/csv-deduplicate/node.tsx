"use client";

import { type NodeProps, useReactFlow } from "@xyflow/react";
import { Copy } from "lucide-react";
import { memo, useState } from "react";

import { BaseExecutionNode } from "@/features/executions/components/base-execution-node";
import { useNodeStatus } from "../../hooks/use-node-status";
import { CsvDeduplicateDialog, type CsvDeduplicateFormValues } from "./dialog";

interface CsvDeduplicateNodeData extends Record<string, unknown> {
  sourceVariable?: string;
  variableName?: string;
  column?: string;
}

export const CsvDeduplicateNode = memo((props: NodeProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { setNodes } = useReactFlow();

  const handleSubmit = (values: CsvDeduplicateFormValues) => {
    setNodes((nodes) =>
      nodes.map((node) =>
        node.id !== props.id ? node : { ...node, data: { ...node.data, ...values } },
      ),
    );
  };

  const handleOpenSettings = () => setDialogOpen(true);

  const data = props.data as CsvDeduplicateNodeData;
  const description = data.column
    ? `Detect duplicates in "${data.column}"`
    : "Detect duplicate rows";

  const nodeStatus = useNodeStatus(props.id);

  return (
    <>
      <CsvDeduplicateDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
        defaultValues={data}
        nodeId={props.id}
      />
      <BaseExecutionNode
        {...props}
        id={props.id}
        name="Detect Duplicates"
        description={description}
        icon={Copy}
        status={nodeStatus}
        onSettings={handleOpenSettings}
        onDoubleClick={handleOpenSettings}
      />
    </>
  );
});

CsvDeduplicateNode.displayName = "CsvDeduplicateNode";
