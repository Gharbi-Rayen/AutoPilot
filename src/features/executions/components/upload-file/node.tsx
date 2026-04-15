"use client";

import { type NodeProps, useReactFlow } from "@xyflow/react";
import { Upload } from "lucide-react";
import { memo, useState } from "react";

import { BaseExecutionNode } from "@/features/executions/components/base-execution-node";
import { FILE_CHANNEL_NAME } from "@/inngest/channels/file";
import { useNodeStatus } from "../../hooks/use-node-status";
import { fetchFileRealTimeToken } from "./actions";
import {
  type SerializedUploadFile,
  UploadFileDialog,
  type UploadFileNodeSubmitValues,
  type UploadPreviewMetadata,
} from "./dialog";

interface UploadFileNodeData extends Record<string, unknown> {
  fileName?: string;
  variableName?: string;
  maxSizeMB?: number;
  allowedTypes?: string;
  file?: SerializedUploadFile;
  previewMetadata?: UploadPreviewMetadata;
  previewJobId?: string;
  previewExecutionId?: string;
  previewState?: "ready";
}

export const UploadFileNode = memo((props: NodeProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { getEdges, setNodes } = useReactFlow();

  const buildDownstreamNodeSet = (startNodeId: string) => {
    const edges = getEdges();
    const adjacency = new Map<string, string[]>();

    for (const edge of edges) {
      const existing = adjacency.get(edge.source);
      if (existing) {
        existing.push(edge.target);
      } else {
        adjacency.set(edge.source, [edge.target]);
      }
    }

    const visited = new Set<string>();
    const queue = [...(adjacency.get(startNodeId) ?? [])];

    while (queue.length > 0) {
      const nodeId = queue.shift();
      if (!nodeId || visited.has(nodeId)) {
        continue;
      }

      visited.add(nodeId);

      const next = adjacency.get(nodeId);
      if (!next) {
        continue;
      }

      for (const nextId of next) {
        if (!visited.has(nextId)) {
          queue.push(nextId);
        }
      }
    }

    return visited;
  };

  const normalizeColumns = (metadata?: UploadPreviewMetadata) => {
    if (!metadata || !Array.isArray(metadata.columns)) {
      return [] as string[];
    }

    const readColumnName = (value: unknown): string | null => {
      if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
      }

      if (!value || typeof value !== "object") {
        return null;
      }

      const columnRecord = value as Record<string, unknown>;
      const candidateKeys = ["name", "column", "field", "key", "label"];

      for (const key of candidateKeys) {
        const rawValue = columnRecord[key];
        if (typeof rawValue !== "string") {
          continue;
        }

        const trimmed = rawValue.trim();
        if (trimmed.length > 0) {
          return trimmed;
        }
      }

      return null;
    };

    return metadata.columns
      .map((column) => readColumnName(column))
      .filter((column): column is string => Boolean(column));
  };

  const didMetadataColumnsChange = (
    previous?: UploadPreviewMetadata,
    next?: UploadPreviewMetadata,
  ) => {
    const prevColumns = normalizeColumns(previous);
    const nextColumns = normalizeColumns(next);

    if (prevColumns.length !== nextColumns.length) {
      return true;
    }

    return prevColumns.some((column, index) => nextColumns[index] !== column);
  };

  const clearColumnDependentData = (
    nodeType: string | undefined,
    data: Record<string, unknown>,
  ) => {
    const normalizedType = (nodeType || "").toUpperCase();

    if (normalizedType === "CSV_FILTER") {
      return {
        ...data,
        field: "",
      };
    }

    if (normalizedType === "CSV_SORT") {
      return {
        ...data,
        sortField: "",
      };
    }

    if (normalizedType === "CSV_AGGREGATE") {
      return {
        ...data,
        groupBy: "",
        targetField: "",
      };
    }

    if (normalizedType === "CSV_DEDUPLICATE") {
      return {
        ...data,
        fields: "",
      };
    }

    if (normalizedType === "CSV_COLUMN_STATS") {
      return {
        ...data,
        fields: "",
      };
    }

    if (normalizedType === "CSV_COMPARE") {
      return {
        ...data,
        keyField: "",
        compareFields: "",
      };
    }

    if (normalizedType === "CSV_JOIN") {
      return {
        ...data,
        keyPairs: [],
        outputColumns: [],
      };
    }

    return data;
  };

  const handleSubmit = (values: UploadFileNodeSubmitValues) => {
    const currentData = props.data as UploadFileNodeData;
    const shouldClearDownstream = didMetadataColumnsChange(
      currentData.previewMetadata,
      values.previewMetadata,
    );
    const downstreamIds = shouldClearDownstream
      ? buildDownstreamNodeSet(props.id)
      : new Set<string>();

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

        if (downstreamIds.has(node.id)) {
          const nodeData =
            typeof node.data === "object" && node.data !== null
              ? (node.data as Record<string, unknown>)
              : {};

          return {
            ...node,
            data: clearColumnDependentData(node.type, nodeData),
          };
        }

        return node;
      }),
    );
  };

  const handleOpenSettings = () => setDialogOpen(true);

  const data = props.data as UploadFileNodeData;
  const description = data?.variableName
    ? `Upload to variable: ${data.variableName}`
    : "Upload file manually";

  const nodeStatus = useNodeStatus({
    nodeId: props.id,
    channel: FILE_CHANNEL_NAME,
    topic: "status",
    refreshToken: fetchFileRealTimeToken,
  });

  return (
    <>
      <UploadFileDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
        defaultValues={data}
        nodeId={props.id}
      />
      <BaseExecutionNode
        {...props}
        id={props.id}
        name="Upload File"
        description={description}
        icon={Upload}
        status={nodeStatus}
        onSettings={handleOpenSettings}
        onDoubleClick={handleOpenSettings}
      />
    </>
  );
});

UploadFileNode.displayName = "UploadFileNode";
