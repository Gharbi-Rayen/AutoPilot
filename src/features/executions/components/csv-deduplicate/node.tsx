"use client";

import { type NodeProps, useReactFlow } from "@xyflow/react";
import { Copy } from "lucide-react";
import { memo, useState } from "react";

import { BaseExecutionNode } from "@/features/executions/components/base-execution-node";
import { FILE_CHANNEL_NAME } from "@/inngest/channels/file";

import { useNodeStatus } from "../../hooks/use-node-status";
import { fetchFileRealTimeToken } from "../upload-file/actions";
import { CsvDeduplicateDialog, type CsvDeduplicateFormValues } from "./dialog";

interface CsvDeduplicateNodeData extends Record<string, unknown> {
  sourceVariable?: string;
  variableName?: string;
  fields?: string;
  keep?: "first" | "last";
  includeDuplicates?: boolean;
}

export const CsvDeduplicateNode = memo((props: NodeProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { setNodes } = useReactFlow();

  const handleSubmit = (values: CsvDeduplicateFormValues) => {
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

  const data = props.data as CsvDeduplicateNodeData;
  const description = data.fields
    ? `Deduplicate by ${data.fields}`
    : "Remove duplicate rows";

  const nodeStatus = useNodeStatus({
    nodeId: props.id,
    channel: FILE_CHANNEL_NAME,
    topic: "status",
    refreshToken: fetchFileRealTimeToken,
  });

  return (
    <>
      <CsvDeduplicateDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
        defaultValues={data}
      />
      <BaseExecutionNode
        {...props}
        id={props.id}
        name="CSV Deduplicate"
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
