"use client";

import { useEdges, useNodes } from "@xyflow/react";
import { useMemo } from "react";
import {
  buildVariableMetadataCatalog,
  getColumnsForVariable,
} from "@/features/executions/lib/variable-metadata-catalog";

export const useUpstreamVariableMetadata = (
  nodeId: string,
  enabled = true,
) => {
  const nodes = useNodes();
  const edges = useEdges();

  const catalog = useMemo(() => {
    if (!enabled) {
      return new Map();
    }

    return buildVariableMetadataCatalog({
      nodes,
      edges,
      currentNodeId: nodeId,
    });
  }, [edges, enabled, nodeId, nodes]);

  const getColumns = (variableName?: string) => {
    return getColumnsForVariable(catalog, variableName);
  };

  const getRowCount = (variableName?: string) => {
    if (!variableName) {
      return undefined;
    }

    return catalog.get(variableName.trim())?.rowCount;
  };

  return {
    catalog,
    getColumns,
    getRowCount,
  };
};
