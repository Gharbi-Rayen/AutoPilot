"use client";

import { type NodeProps, useReactFlow } from "@xyflow/react";
import { Filter } from "lucide-react";
import { memo, useState } from "react";

import { BaseExecutionNode } from "@/features/executions/components/base-execution-node";
import { FILE_CHANNEL_NAME } from "@/inngest/channels/file";
import { useNodeStatus } from "../../hooks/use-node-status";
import { fetchFileRealTimeToken } from "../download-file/actions";
import { FilterDialog, type FilterFormValues } from "./dialog";

interface FilterNodeData extends Record<string, unknown> {
  sourceVariable?: string;
  variableName?: string;
  field?: string;
  operator?: string;
  value?: string;
}

export const FilterNode = memo((props: NodeProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { setNodes } = useReactFlow();

  const handleSubmit = (values: FilterFormValues) => {
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

  const data = props.data as FilterNodeData;
  const description = data?.field ? `Filter by ${data.field}` : "Filter records";

  const nodeStatus = useNodeStatus({
    nodeId: props.id,
    channel: FILE_CHANNEL_NAME,
    topic: "status",
    refreshToken: fetchFileRealTimeToken,
  });

  return (
    <>
      <FilterDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
        defaultValues={data}
      />
      <BaseExecutionNode
        {...props}
        id={props.id}
        name="Filter"
        description={description}
        icon={Filter}
        status={nodeStatus}
        onSettings={handleOpenSettings}
        onDoubleClick={handleOpenSettings}
      />
    </>
  );
});

FilterNode.displayName = "FilterNode";
