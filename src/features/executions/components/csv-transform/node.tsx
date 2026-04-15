"use client";

import { type NodeProps, useReactFlow } from "@xyflow/react";
import { ScanSearch } from "lucide-react";
import { memo, useState } from "react";

import { BaseExecutionNode } from "@/features/executions/components/base-execution-node";
import { FILE_CHANNEL_NAME } from "@/inngest/channels/file";
import { useNodeStatus } from "../../hooks/use-node-status";
import { fetchFileRealTimeToken } from "../upload-file/actions";
import { CsvTransformDialog, type CsvTransformFormValues } from "./dialog";

interface CsvTransformNodeData extends Record<string, unknown> {
  sourceVariable?: string;
  variableName?: string;
  rules?: CsvTransformFormValues["rules"];
  matchMode?: "all" | "any";
  caseSensitive?: boolean;
}

export const CsvTransformNode = memo((props: NodeProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { setNodes } = useReactFlow();

  const handleSubmit = (values: CsvTransformFormValues) => {
    setNodes((nodes) =>
      nodes.map((node) => {
        if (node.id !== props.id) return node;
        return { ...node, data: { ...node.data, ...values } };
      }),
    );
  };

  const handleOpenSettings = () => setDialogOpen(true);

  const data = props.data as CsvTransformNodeData;
  const ruleCount = data.rules?.length ?? 0;
  const description =
    ruleCount > 0
      ? `${ruleCount} rule${ruleCount === 1 ? "" : "s"} · ${data.matchMode ?? "all"} match`
      : "Search, replace, delete rows";

  const nodeStatus = useNodeStatus({
    nodeId: props.id,
    channel: FILE_CHANNEL_NAME,
    topic: "status",
    refreshToken: fetchFileRealTimeToken,
  });

  return (
    <>
      <CsvTransformDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
        defaultValues={data}
        nodeId={props.id}
      />
      <BaseExecutionNode
        {...props}
        id={props.id}
        name="CSV Transform"
        description={description}
        icon={ScanSearch}
        status={nodeStatus}
        onSettings={handleOpenSettings}
        onDoubleClick={handleOpenSettings}
      />
    </>
  );
});

CsvTransformNode.displayName = "CsvTransformNode";
