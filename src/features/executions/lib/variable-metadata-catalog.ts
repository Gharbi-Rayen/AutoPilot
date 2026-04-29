type GraphNode = {
  id: string;
  type?: string;
  data?: Record<string, unknown>;
};

type GraphEdge = {
  source: string;
  target: string;
};

export interface VariableMetadata {
  variableName: string;
  columns: string[];
  rowCount?: number;
  columnCount?: number;
  sourceNodeId: string;
  sourceNodeType?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const readString = (
  data: Record<string, unknown> | undefined,
  key: string,
): string | null => {
  if (!data) {
    return null;
  }

  const value = data[key];
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const readNumber = (
  data: Record<string, unknown> | undefined,
  key: string,
): number | undefined => {
  if (!data) {
    return undefined;
  }

  const value = data[key];
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : undefined;
};

const readColumnName = (value: unknown): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (!isRecord(value)) {
    return null;
  }

  const candidateKeys = ["name", "column", "field", "key", "label"];
  for (const key of candidateKeys) {
    const rawValue = value[key];
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

const readColumns = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const item of value) {
    const name = readColumnName(item);
    if (!name) {
      continue;
    }

    if (seen.has(name)) {
      continue;
    }

    seen.add(name);
    normalized.push(name);
  }

  return normalized;
};

const pickPreviewMetadata = (data: Record<string, unknown> | undefined) => {
  if (!data) {
    return null;
  }

  const candidates = [
    data.previewMetadata,
    data.parsedMetadata,
    data.filePreviewMetadata,
  ];

  for (const candidate of candidates) {
    if (!isRecord(candidate)) {
      continue;
    }

    const columns = readColumns(candidate.columns);
    if (columns.length === 0) {
      continue;
    }

    const rowCount = readNumber(candidate, "rowCount");

    const columnCount = readNumber(candidate, "columnCount") ?? columns.length;

    return {
      columns,
      rowCount,
      columnCount,
    };
  }

  return null;
};

const getUpstreamScope = (
  edges: GraphEdge[],
  currentNodeId?: string,
): Set<string> => {
  if (!currentNodeId) {
    return new Set<string>();
  }

  const reverse = new Map<string, string[]>();
  for (const edge of edges) {
    const sources = reverse.get(edge.target);
    if (sources) {
      sources.push(edge.source);
    } else {
      reverse.set(edge.target, [edge.source]);
    }
  }

  const visited = new Set<string>();
  const queue = [currentNodeId];

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId || visited.has(nodeId)) {
      continue;
    }

    visited.add(nodeId);
    const sources = reverse.get(nodeId);
    if (!sources) {
      continue;
    }

    for (const sourceId of sources) {
      if (!visited.has(sourceId)) {
        queue.push(sourceId);
      }
    }
  }

  return visited;
};

const topologicalSort = (
  nodes: GraphNode[],
  edges: GraphEdge[],
): GraphNode[] => {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  for (const edge of edges) {
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) {
      continue;
    }

    adjacency.get(edge.source)?.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [nodeId, degree] of inDegree.entries()) {
    if (degree === 0) {
      queue.push(nodeId);
    }
  }

  const ordered: GraphNode[] = [];

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId) {
      continue;
    }

    const node = nodeMap.get(nodeId);
    if (!node) {
      continue;
    }

    ordered.push(node);

    const neighbors = adjacency.get(nodeId) ?? [];
    for (const neighborId of neighbors) {
      const nextDegree = (inDegree.get(neighborId) ?? 0) - 1;
      inDegree.set(neighborId, nextDegree);
      if (nextDegree === 0) {
        queue.push(neighborId);
      }
    }
  }

  if (ordered.length === nodes.length) {
    return ordered;
  }

  const visited = new Set(ordered.map((node) => node.id));
  const remainder = nodes.filter((node) => !visited.has(node.id));
  return [...ordered, ...remainder];
};

const cloneMetadata = (metadata: VariableMetadata): VariableMetadata => {
  return {
    variableName: metadata.variableName,
    columns: [...metadata.columns],
    rowCount: metadata.rowCount,
    columnCount: metadata.columnCount,
    sourceNodeId: metadata.sourceNodeId,
    sourceNodeType: metadata.sourceNodeType,
  };
};

const setVariableMetadata = (
  map: Map<string, VariableMetadata>,
  metadata: VariableMetadata,
) => {
  map.set(metadata.variableName, cloneMetadata(metadata));
};

const buildJoinColumns = (
  left: VariableMetadata | undefined,
  right: VariableMetadata | undefined,
) => {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const column of left?.columns ?? []) {
    if (!seen.has(column)) {
      seen.add(column);
      merged.push(column);
    }
  }

  for (const column of right?.columns ?? []) {
    if (!seen.has(column)) {
      seen.add(column);
      merged.push(column);
    }
  }

  return merged;
};

export const buildVariableMetadataCatalog = ({
  nodes,
  edges,
  currentNodeId,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  currentNodeId?: string;
}): Map<string, VariableMetadata> => {
  const scope =
    currentNodeId && currentNodeId.length > 0
      ? getUpstreamScope(edges, currentNodeId)
      : null;

  const scopedNodes =
    scope && scope.size > 0
      ? nodes.filter((node) => scope.has(node.id))
      : nodes;

  const scopedNodeIds = new Set(scopedNodes.map((node) => node.id));
  const scopedEdges = edges.filter(
    (edge) => scopedNodeIds.has(edge.source) && scopedNodeIds.has(edge.target),
  );

  const orderedNodes = topologicalSort(scopedNodes, scopedEdges);
  const metadataByVariable = new Map<string, VariableMetadata>();

  for (const node of orderedNodes) {
    const nodeType = (node.type || "").toUpperCase();
    const data = isRecord(node.data) ? node.data : undefined;

    if (nodeType === "UPLOAD_FILE") {
      const variableName = readString(data, "variableName");
      const preview = pickPreviewMetadata(data);
      if (!variableName || !preview) {
        continue;
      }

      setVariableMetadata(metadataByVariable, {
        variableName,
        columns: preview.columns,
        rowCount: preview.rowCount,
        columnCount: preview.columnCount,
        sourceNodeId: node.id,
        sourceNodeType: node.type,
      });
      continue;
    }

    if (nodeType === "CSV_PARSE") {
      const sourceVariable = readString(data, "csvVariable");
      const variableName = readString(data, "variableName");
      if (!sourceVariable || !variableName) {
        continue;
      }

      const source = metadataByVariable.get(sourceVariable);
      if (!source) {
        continue;
      }

      setVariableMetadata(metadataByVariable, {
        ...source,
        variableName,
        sourceNodeId: node.id,
        sourceNodeType: node.type,
      });
      continue;
    }

    if (
      nodeType === "CSV_FILTER" ||
      nodeType === "CSV_SORT" ||
      nodeType === "CSV_COLUMN_TRANSFORM"
    ) {
      const sourceVariable = readString(data, "sourceVariable");
      const variableName = readString(data, "variableName");
      if (!sourceVariable || !variableName) {
        continue;
      }

      const source = metadataByVariable.get(sourceVariable);
      if (!source) {
        continue;
      }

      setVariableMetadata(metadataByVariable, {
        ...source,
        variableName,
        sourceNodeId: node.id,
        sourceNodeType: node.type,
      });
      continue;
    }

    if (nodeType === "CSV_RESTRUCTURE") {
      const sourceVariable = readString(data, "sourceVariable");
      const variableName = readString(data, "variableName");
      const rawCols = data?.outputColumns as Array<{ name: string }> | undefined;
      if (!sourceVariable || !variableName || !rawCols) {
        continue;
      }

      const source = metadataByVariable.get(sourceVariable);
      if (!source) {
        continue;
      }

      const columns = rawCols.map((c) => c.name);
      setVariableMetadata(metadataByVariable, {
        ...source,
        variableName,
        columns,
        columnCount: columns.length,
        sourceNodeId: node.id,
        sourceNodeType: node.type,
      });
      continue;
    }

    if (nodeType === "CSV_DEDUPLICATE") {
      const sourceVariable = readString(data, "sourceVariable");
      const variableName = readString(data, "variableName");
      if (!sourceVariable || !variableName) {
        continue;
      }

      const source = metadataByVariable.get(sourceVariable);
      if (!source) {
        continue;
      }

      const selectedColumn = readString(data, "column");
      const duplicateColumns = selectedColumn
        ? readColumns([selectedColumn, "count"])
        : readColumns([...source.columns, "count"]);

      setVariableMetadata(metadataByVariable, {
        ...source,
        variableName,
        columns: duplicateColumns,
        columnCount: duplicateColumns.length,
        sourceNodeId: node.id,
        sourceNodeType: node.type,
      });

      setVariableMetadata(metadataByVariable, {
        ...source,
        variableName: `${variableName}_unique`,
        sourceNodeId: node.id,
        sourceNodeType: node.type,
      });
      continue;
    }

    if (nodeType === "CSV_AGGREGATE") {
      const variableName = readString(data, "variableName");
      const groupBy = readString(data, "groupBy");
      const operation = readString(data, "operation") || "count";
      const targetField = readString(data, "targetField");

      if (!variableName || !groupBy) {
        continue;
      }

      const aggregateColumn =
        operation === "count"
          ? "count"
          : targetField
            ? `${operation}_${targetField}`
            : operation;

      const columns = readColumns([groupBy, aggregateColumn]);
      setVariableMetadata(metadataByVariable, {
        variableName,
        columns,
        columnCount: columns.length,
        sourceNodeId: node.id,
        sourceNodeType: node.type,
      });
      continue;
    }

    if (nodeType === "CSV_JOIN") {
      const variableName = readString(data, "variableName");
      if (!variableName) {
        continue;
      }

      const leftVariable = readString(data, "leftVariable");
      const rightVariable = readString(data, "rightVariable");
      const leftMeta = leftVariable
        ? metadataByVariable.get(leftVariable)
        : undefined;
      const rightMeta = rightVariable
        ? metadataByVariable.get(rightVariable)
        : undefined;

      let columns: string[] = [];
      if (Array.isArray(data?.outputColumns)) {
        const outputColumns = data.outputColumns
          .filter(isRecord)
          .map((entry) => {
            const alias =
              typeof entry.alias === "string" ? entry.alias.trim() : "";
            const column =
              typeof entry.column === "string" ? entry.column.trim() : "";
            return alias || column;
          })
          .filter((value) => value.length > 0);

        columns = readColumns(outputColumns);
      }

      if (columns.length === 0) {
        columns = buildJoinColumns(leftMeta, rightMeta);
      }

      if (columns.length === 0) {
        continue;
      }

      const leftCount = leftMeta?.rowCount;
      const rightCount = rightMeta?.rowCount;
      const rowCount =
        typeof leftCount === "number" && typeof rightCount === "number"
          ? Math.max(leftCount, rightCount)
          : (leftCount ?? rightCount);

      setVariableMetadata(metadataByVariable, {
        variableName,
        columns,
        rowCount,
        columnCount: columns.length,
        sourceNodeId: node.id,
        sourceNodeType: node.type,
      });
    }
  }

  return metadataByVariable;
};

export const getColumnsForVariable = (
  catalog: Map<string, VariableMetadata>,
  variableName?: string,
) => {
  if (!variableName) {
    return [] as string[];
  }

  const normalizedVariable = variableName.trim();
  if (!normalizedVariable) {
    return [] as string[];
  }

  return catalog.get(normalizedVariable)?.columns ?? [];
};
