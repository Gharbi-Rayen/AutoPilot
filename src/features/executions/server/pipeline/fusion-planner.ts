import { isFusionCompatibleNodeType } from "@/features/executions/components/lib/executor-registry";
import { NodeType } from "@/generated/prisma";

export interface FusionPlannerNode {
  id: string;
  type: NodeType;
  data: unknown;
}

export interface FusionPlannerConnection {
  fromNodeId: string;
  toNodeId: string;
}

export interface FusionChainPlan {
  kind: "csv-parse-filter-aggregate";
  nodeIds: [string, string, string];
  startIndex: number;
  endIndex: number;
}

const normalizeVariableReference = (reference: unknown): string => {
  if (typeof reference !== "string") {
    return "";
  }

  const trimmed = reference.trim();
  if (!trimmed) {
    return "";
  }

  const unwrapped = /^\{\{\s*(.+?)\s*\}\}$/.exec(trimmed)?.[1] ?? trimmed;

  return unwrapped
    .replace(/^context\./, "")
    .replace(/^\$\./, "")
    .trim();
};

const readStringField = (data: unknown, field: string): string => {
  if (typeof data !== "object" || data === null) {
    return "";
  }

  const value = (data as Record<string, unknown>)[field];
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
};

const buildAdjacencyMap = (
  connections: FusionPlannerConnection[],
  source: "fromNodeId" | "toNodeId",
  target: "fromNodeId" | "toNodeId",
) => {
  const adjacency = new Map<string, string[]>();

  for (const connection of connections) {
    const sourceNodeId = connection[source];
    const targetNodeId = connection[target];
    const neighbors = adjacency.get(sourceNodeId) ?? [];
    neighbors.push(targetNodeId);
    adjacency.set(sourceNodeId, neighbors);
  }

  return adjacency;
};

export const planLinearFusionChains = ({
  nodes,
  connections,
}: {
  nodes: FusionPlannerNode[];
  connections: FusionPlannerConnection[];
}): FusionChainPlan[] => {
  const plans: FusionChainPlan[] = [];

  if (nodes.length < 3 || connections.length === 0) {
    return plans;
  }

  const outgoing = buildAdjacencyMap(connections, "fromNodeId", "toNodeId");
  const incoming = buildAdjacencyMap(connections, "toNodeId", "fromNodeId");

  for (let index = 0; index <= nodes.length - 3; index += 1) {
    const parseNode = nodes[index];
    const filterNode = nodes[index + 1];
    const aggregateNode = nodes[index + 2];

    if (
      !parseNode ||
      !filterNode ||
      !aggregateNode ||
      parseNode.type !== NodeType.CSV_PARSE ||
      filterNode.type !== NodeType.CSV_FILTER ||
      aggregateNode.type !== NodeType.CSV_AGGREGATE
    ) {
      continue;
    }

    if (
      !isFusionCompatibleNodeType(parseNode.type) ||
      !isFusionCompatibleNodeType(filterNode.type) ||
      !isFusionCompatibleNodeType(aggregateNode.type)
    ) {
      continue;
    }

    const parseOutgoing = outgoing.get(parseNode.id) ?? [];
    const filterOutgoing = outgoing.get(filterNode.id) ?? [];
    const filterIncoming = incoming.get(filterNode.id) ?? [];
    const aggregateIncoming = incoming.get(aggregateNode.id) ?? [];

    const parseToFilter = parseOutgoing.includes(filterNode.id);
    const filterToAggregate = filterOutgoing.includes(aggregateNode.id);

    if (!parseToFilter || !filterToAggregate) {
      continue;
    }

    if (
      parseOutgoing.length !== 1 ||
      filterOutgoing.length !== 1 ||
      filterIncoming.length !== 1 ||
      aggregateIncoming.length !== 1
    ) {
      continue;
    }

    const parseVariable = readStringField(parseNode.data, "variableName");
    const filterVariable = readStringField(filterNode.data, "variableName");
    const filterSource = normalizeVariableReference(
      (filterNode.data as Record<string, unknown> | null)?.sourceVariable,
    );
    const aggregateSource = normalizeVariableReference(
      (aggregateNode.data as Record<string, unknown> | null)?.sourceVariable,
    );

    if (
      !parseVariable ||
      !filterVariable ||
      !filterSource ||
      !aggregateSource ||
      filterSource !== parseVariable ||
      aggregateSource !== filterVariable
    ) {
      continue;
    }

    plans.push({
      kind: "csv-parse-filter-aggregate",
      nodeIds: [parseNode.id, filterNode.id, aggregateNode.id],
      startIndex: index,
      endIndex: index + 2,
    });

    index += 2;
  }

  return plans;
};
