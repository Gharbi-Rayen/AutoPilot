"use client";

import { type NodeProps, useReactFlow } from "@xyflow/react";
import { GitBranch } from "lucide-react";
import { memo, useState } from "react";

import { BaseExecutionNode } from "@/features/executions/components/base-execution-node";
import { FILE_CHANNEL_NAME } from "@/inngest/channels/file";

import { useNodeStatus } from "../../hooks/use-node-status";
import { fetchFileRealTimeToken } from "../upload-file/actions";
import {
  CsvConsecutiveSequenceDialog,
  type CsvConsecutiveSequenceFormValues,
} from "./dialog";

interface CsvConsecutiveSequenceNodeData extends Record<string, unknown> {
  sourceVariable?: string;
  variableName?: string;
  minimumSequenceLength?: number;
  analysisColumn?: string;
  groupByColumns?: string;
  comparisonMode?:
    | "integer-step"
    | "number-step"
    | "date-step"
    | "alphabetic-step"
    | "custom-expression";
}

export const CsvConsecutiveSequenceNode = memo((props: NodeProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { setNodes } = useReactFlow();

  const handleSubmit = (values: CsvConsecutiveSequenceFormValues) => {
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

  const data = props.data as CsvConsecutiveSequenceNodeData;
  const description = data.analysisColumn
    ? `Analyze ${data.analysisColumn}${data.groupByColumns ? ` by ${data.groupByColumns}` : ""}`
    : "Analyze consecutive values";

  const nodeStatus = useNodeStatus({
    nodeId: props.id,
    channel: FILE_CHANNEL_NAME,
    topic: "status",
    refreshToken: fetchFileRealTimeToken,
  });

  return (
    <>
      <CsvConsecutiveSequenceDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
        defaultValues={data}
        nodeId={props.id}
      />
      <BaseExecutionNode
        {...props}
        id={props.id}
        name="Consecutive Sequence Analyzer"
        description={description}
        icon={GitBranch}
        status={nodeStatus}
        onSettings={handleOpenSettings}
        onDoubleClick={handleOpenSettings}
      />
    </>
  );
});

CsvConsecutiveSequenceNode.displayName = "CsvConsecutiveSequenceNode";
