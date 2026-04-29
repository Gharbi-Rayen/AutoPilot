"use client";

import { type NodeProps, useReactFlow } from "@xyflow/react";
import { WandSparkles } from "lucide-react";
import { memo, useState } from "react";

import { BaseExecutionNode } from "@/features/executions/components/base-execution-node";
import { useNodeStatus } from "../../hooks/use-node-status";
import {
  CsvColumnTransformDialog,
  type CsvColumnTransformFormValues,
} from "./dialog";

interface CsvColumnTransformNodeData extends Record<string, unknown> {
  sourceVariable?: string;
  variableName?: string;
  transforms?: CsvColumnTransformFormValues["transforms"];
}

export const CsvColumnTransformNode = memo((props: NodeProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { setNodes } = useReactFlow();
  const data = props.data as CsvColumnTransformNodeData;
  const nodeStatus = useNodeStatus(props.id);

  const handleSubmit = (values: CsvColumnTransformFormValues) => {
    setNodes((nodes) =>
      nodes.map((node) =>
        node.id !== props.id ? node : { ...node, data: { ...node.data, ...values } },
      ),
    );
  };

  const colCount = data.transforms?.length ?? 0;
  const totalOps = data.transforms?.reduce((sum, t) => sum + t.ops.length, 0) ?? 0;
  const description =
    colCount > 0
      ? `${colCount} column${colCount !== 1 ? "s" : ""} · ${totalOps} op${totalOps !== 1 ? "s" : ""}`
      : "Transform column values";

  return (
    <>
      <CsvColumnTransformDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
        defaultValues={data}
        nodeId={props.id}
      />
      <BaseExecutionNode
        {...props}
        id={props.id}
        name="Column Transform"
        description={description}
        icon={WandSparkles}
        status={nodeStatus}
        onSettings={() => setDialogOpen(true)}
        onDoubleClick={() => setDialogOpen(true)}
      />
    </>
  );
});

CsvColumnTransformNode.displayName = "CsvColumnTransformNode";
