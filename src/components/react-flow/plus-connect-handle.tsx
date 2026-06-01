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
      (store) => store.nodes.find((n) => n.id === nodeId)?.selected ?? false,
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
    <NodeToolbar position={Position.Right} isVisible={shouldShow} offset={6}>
      <div
        className="flex items-center animate-in fade-in-0 slide-in-from-left-2 duration-150 motion-reduce:animate-none"
      >
        {/* Dashed connector stub extending from the output handle */}
        <div className="w-8 border-t-2 border-dashed border-muted-foreground/30" />

        {/* Add button + "Add node" label */}
        <div className="relative group/addnode">
          <button
            type="button"
            onClick={handleClick}
            className="nodrag nopan flex items-center justify-center size-8 rounded-full
              bg-primary text-primary-foreground
              shadow-md ring-2 ring-background
              hover:scale-110 hover:shadow-lg
              active:scale-95
              transition-all duration-150 cursor-pointer"
            aria-label="Add connected node"
          >
            <PlusIcon className="size-4" />
          </button>

          {/* Label — fades in when button is hovered */}
          <span
            className="absolute top-1/2 -translate-y-1/2 left-[calc(100%+8px)]
              whitespace-nowrap text-[10px] font-medium text-muted-foreground
              bg-background/95 px-2 py-1 rounded-md border border-border shadow-sm
              opacity-0 group-hover/addnode:opacity-100
              transition-opacity duration-100 motion-reduce:transition-none
              pointer-events-none select-none"
          >
            Add node
          </span>
        </div>
      </div>
    </NodeToolbar>
  );
};
