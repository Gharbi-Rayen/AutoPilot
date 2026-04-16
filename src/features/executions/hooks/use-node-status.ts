"use client";

import { useAtomValue } from "jotai";
import type { NodeStatus } from "@/components/react-flow/node-status-indicator";
import { nodeStatusMapAtom } from "@/store/execution-status";

/**
 * Returns the live execution status for a given node.
 * Status is driven by the client-side execution engine via Jotai atoms —
 * no server subscription needed.
 */
export function useNodeStatus(nodeId: string): NodeStatus {
  const statusMap = useAtomValue(nodeStatusMapAtom);
  return statusMap[nodeId] ?? "initial";
}
