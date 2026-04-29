"use client";

import { type NodeProps, useReactFlow } from "@xyflow/react";
import { Columns } from "lucide-react";
import { memo, useState } from "react";

import { BaseExecutionNode } from "@/features/executions/components/base-execution-node";
import { useNodeStatus } from "../../hooks/use-node-status";
import { CsvRestructureDialog, type CsvRestructureFormValues } from "./dialog";

interface CsvRestructureNodeData extends Record<string, unknown> {
  sourceVariable?: string;
  variableName?: string;
  outputColumns?: CsvRestructureFormValues["outputColumns"];
}

export const CsvRestructureNode = memo((props: NodeProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { setNodes } = useReactFlow();
  const data = props.data as CsvRestructureNodeData;
  const nodeStatus = useNodeStatus(props.id);

  const handleSubmit = (values: CsvRestructureFormValues) => {
    setNodes((nodes) =>
      nodes.map((node) =>
        node.id !== props.id ? node : { ...node, data: { ...node.data, ...values } },
      ),
    );
  };

  const cols = data.outputColumns ?? [];
  const colPreview = cols.map((c) => c.name).join(", ");
  const description =
    cols.length > 0
      ? `→ ${colPreview.length > 40 ? `${colPreview.slice(0, 40)}…` : colPreview}`
      : "Reorder, remove, or add columns";

  return (
    <>
      <CsvRestructureDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
        defaultValues={data}
        nodeId={props.id}
      />
      <BaseExecutionNode
        {...props}
        id={props.id}
        name="CSV Restructure"
        description={description}
        icon={Columns}
        status={nodeStatus}
        onSettings={() => setDialogOpen(true)}
        onDoubleClick={() => setDialogOpen(true)}
      />
    </>
  );
});

CsvRestructureNode.displayName = "CsvRestructureNode";
