"use client";

import { type NodeProps, useReactFlow } from "@xyflow/react";
import { ArrowUpDown } from "lucide-react";
import { memo, useState } from "react";

import { BaseExecutionNode } from "@/features/executions/components/base-execution-node";

import { useNodeStatus } from "../../hooks/use-node-status";
import { CsvSortDialog, type CsvSortFormValues } from "./dialog";

interface CsvSortNodeData extends Record<string, unknown> {
  sourceVariable?: string;
  variableName?: string;
  sortField?: string;
  direction?: "asc" | "desc";
  compareAs?: "string" | "number" | "date";
  nulls?: "first" | "last";
}

export const CsvSortNode = memo((props: NodeProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { setNodes } = useReactFlow();

  const handleSubmit = (values: CsvSortFormValues) => {
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

  const data = props.data as CsvSortNodeData;
  const description = data.sortField
    ? `Sort by ${data.sortField}`
    : "Sort CSV records";

  const nodeStatus = useNodeStatus(props.id);

  return (
    <>
      <CsvSortDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
        defaultValues={data}
        nodeId={props.id}
      />
      <BaseExecutionNode
        {...props}
        id={props.id}
        name="CSV Sort"
        description={description}
        icon={ArrowUpDown}
        status={nodeStatus}
        onSettings={handleOpenSettings}
        onDoubleClick={handleOpenSettings}
      />
    </>
  );
});

CsvSortNode.displayName = "CsvSortNode";
