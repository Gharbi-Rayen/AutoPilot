"use client";

import { useEdges, useNodes } from "@xyflow/react";
import type { Edge, Node } from "@xyflow/react";
import { useMemo } from "react";

import { buildVariableMetadataCatalog } from "@/features/executions/lib/variable-metadata-catalog";

function sanitizeStem(name: string): string {
  return name
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 30);
}

function findFileStem(nodes: Node[], edges: Edge[], startNodeId: string): string | null {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const reverseEdges = new Map<string, string[]>();
  for (const edge of edges) {
    const list = reverseEdges.get(edge.target) ?? [];
    list.push(edge.source);
    reverseEdges.set(edge.target, list);
  }

  const visited = new Set<string>();
  const queue = [startNodeId];

  while (queue.length > 0) {
    const id = queue.shift();
    if (!id || visited.has(id)) continue;
    visited.add(id);

    const node = nodeMap.get(id);
    if (!node) continue;

    if (node.type?.toUpperCase() === "UPLOAD_FILE") {
      const rawName = typeof node.data?.fileName === "string" ? node.data.fileName : null;
      if (rawName) return sanitizeStem(rawName);
    }

    for (const srcId of reverseEdges.get(id) ?? []) {
      if (!visited.has(srcId)) queue.push(srcId);
    }
  }

  return null;
}

function buildUniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

export function useVariableNameSuggestion({
  nodeId,
  sourceVariable,
  secondaryVariable,
  suffix,
  fileStem,
  open,
}: {
  nodeId?: string;
  sourceVariable?: string;
  secondaryVariable?: string;
  suffix: string;
  fileStem?: string;
  open: boolean;
}): string {
  const nodes = useNodes();
  const edges = useEdges();

  return useMemo(() => {
    if (!open) return "";

    const allVarsMap = buildVariableMetadataCatalog({ nodes, edges });

    const takenNames = new Set<string>();
    for (const [varName, meta] of allVarsMap.entries()) {
      if (!nodeId || meta.sourceNodeId !== nodeId) {
        takenNames.add(varName);
      }
    }

    let stem1: string | null = fileStem ? sanitizeStem(fileStem) : null;
    let stem2: string | null = null;

    if (!stem1 && sourceVariable) {
      const srcNodeId = allVarsMap.get(sourceVariable)?.sourceNodeId;
      if (srcNodeId) stem1 = findFileStem(nodes, edges, srcNodeId);
    }

    if (secondaryVariable) {
      const secNodeId = allVarsMap.get(secondaryVariable)?.sourceNodeId;
      if (secNodeId) stem2 = findFileStem(nodes, edges, secNodeId);
    }

    let base: string;
    if (stem1 && stem2) {
      base = `${stem1}_${stem2}_${suffix}`;
    } else if (stem1) {
      base = `${stem1}_${suffix}`;
    } else {
      base = suffix;
    }

    return buildUniqueName(base, takenNames);
  }, [nodes, edges, nodeId, sourceVariable, secondaryVariable, suffix, fileStem, open]);
}
