"use client";

import { type NodeProps, useReactFlow } from "@xyflow/react";
import { ArrowLeftRight } from "lucide-react";
import { memo, useState } from "react";

import { BaseExecutionNode } from "@/features/executions/components/base-execution-node";

import { useNodeStatus } from "../../hooks/use-node-status";
import { CsvCompareDialog, type CsvCompareFormValues } from "./dialog";

interface CsvCompareNodeData extends Record<string, unknown> {
  leftVariable?: string;
  rightVariable?: string;
  variableName?: string;
  keyField?: string;
  compareFields?: string;
}

export const CsvCompareNode = memo((props: NodeProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { setNodes } = useReactFlow();

  const handleSubmit = (values: CsvCompareFormValues) => {
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

  const data = props.data as CsvCompareNodeData;
  const description = data.keyField
    ? `Compare by ${data.keyField}`
    : "Compare two datasets";

  const nodeStatus = useNodeStatus(props.id);

  return (
    <>
      <CsvCompareDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
        defaultValues={data}
        nodeId={props.id}
      />
      <BaseExecutionNode
        {...props}
        id={props.id}
        name="CSV Compare"
        description={description}
        icon={ArrowLeftRight}
        status={nodeStatus}
        onSettings={handleOpenSettings}
        onDoubleClick={handleOpenSettings}
      />
    </>
  );
});

CsvCompareNode.displayName = "CsvCompareNode";
