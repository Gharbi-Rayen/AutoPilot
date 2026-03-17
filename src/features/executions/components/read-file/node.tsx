"use client";

import { type NodeProps, useReactFlow } from "@xyflow/react";
import { memo, useState } from "react";
import { FileText } from "lucide-react";

import { BaseExecutionNode } from "@/features/executions/components/base-execution-node";
import { FILE_CHANNEL_NAME } from "@/inngest/channels/file";
import { useNodeStatus } from "../../hooks/use-node-status";
import { fetchFileRealTimeToken } from "../download-file/actions";
import {
  ReadFileDialog,
  type ReadFileFormValues,
} from "./dialog";

interface ReadFileNodeData extends Record<string, unknown> {
  fileVariable?: string;
  variableName?: string;
  encoding?: string;
}

export const ReadFileNode = memo((props: NodeProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { setNodes } = useReactFlow();

  const handleSubmit = (values: ReadFileFormValues) => {
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

  const data = props.data as ReadFileNodeData;
  const description = data?.fileVariable ? `Read: ${data.fileVariable}` : "Read file content";

  const nodeStatus = useNodeStatus({
    nodeId: props.id,
    channel: FILE_CHANNEL_NAME,
    topic: "status",
    refreshToken: fetchFileRealTimeToken,
  });

  return (
    <>
      <ReadFileDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
        defaultValues={data}
      />
      <BaseExecutionNode
        {...props}
        id={props.id}
        name="Read File"
        description={description}
        icon={FileText}
        status={nodeStatus}
        onSettings={handleOpenSettings}
        onDoubleClick={handleOpenSettings}
      />
    </>
  );
});

ReadFileNode.displayName = "ReadFileNode";
