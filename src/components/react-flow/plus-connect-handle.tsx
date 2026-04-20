"use client";

import { NodeToolbar, Position, useEdges, useStore } from "@xyflow/react";
import { useSetAtom } from "jotai";
import { PlusIcon } from "lucide-react";
import { useCallback } from "react";
import {
  pendingConnectionAtom,
  quickConnectOpenAtom,
} from "@/features/editor/store/atoms";

interface PlusConnectHandleProps {
  nodeId: string;
}

export const PlusConnectHandle = ({ nodeId }: PlusConnectHandleProps) => {
  const setPendingConnection = useSetAtom(pendingConnectionAtom);
  const setQuickConnectOpen = useSetAtom(quickConnectOpenAtom);

  const isSelected = useStore(
    useCallback(
      (store) =>
        store.nodes.find((n) => n.id === nodeId)?.selected ?? false,
      [nodeId],
    ),
  );

  const edges = useEdges();
  const hasOutgoingEdge = edges.some((e) => e.source === nodeId);

  const shouldShow = isSelected && !hasOutgoingEdge;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPendingConnection(nodeId);
    setQuickConnectOpen(true);
  };

  return (
    <NodeToolbar position={Position.Right} isVisible={shouldShow} offset={2}>
      <div className="flex items-center">
        <div className="w-4 h-px bg-border/50" />
        <button
          type="button"
          onClick={handleClick}
          className="nodrag nopan flex items-center justify-center size-5 rounded-full
            bg-background border border-border/60 text-muted-foreground/60
            hover:border-primary hover:text-primary hover:scale-125
            transition-all duration-150 cursor-pointer shadow-sm"
        >
          <PlusIcon className="size-3" />
        </button>
      </div>
    </NodeToolbar>
  );
};
