"use client";

import { type NodeProps, useReactFlow } from "@xyflow/react";
import { Table2 } from "lucide-react";
import { memo, useState } from "react";

import { BaseExecutionNode } from "@/features/executions/components/base-execution-node";
import { useNodeStatus } from "../../hooks/use-node-status";
import { CsvParseDialog, type CsvParseFormValues } from "./dialog";

interface CsvParseNodeData extends Record<string, unknown> {
  csvVariable?: string;
  variableName?: string;
  hasHeader?: boolean;
  delimiter?: string;
}

export const CsvParseNode = memo((props: NodeProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { setNodes } = useReactFlow();

  const handleSubmit = (values: CsvParseFormValues) => {
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

  const data = props.data as CsvParseNodeData;
  const description = data?.csvVariable
    ? `Parse: ${data.csvVariable}`
    : "Parse CSV data";

  const nodeStatus = useNodeStatus(props.id);

  return (
    <>
      <CsvParseDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
        defaultValues={data}
        nodeId={props.id}
      />
      <BaseExecutionNode
        {...props}
        id={props.id}
        name="CSV Parse"
        description={description}
        icon={Table2}
        status={nodeStatus}
        onSettings={handleOpenSettings}
        onDoubleClick={handleOpenSettings}
      />
    </>
  );
});

CsvParseNode.displayName = "CsvParseNode";
