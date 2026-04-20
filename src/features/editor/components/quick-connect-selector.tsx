"use client";

import { useAtom } from "jotai";
import { NodeSelector } from "@/components/node-selector";
import { pendingConnectionAtom, quickConnectOpenAtom } from "../store/atoms";

export const QuickConnectSelector = () => {
  const [pendingNodeId, setPendingNodeId] = useAtom(pendingConnectionAtom);
  const [open, setOpen] = useAtom(quickConnectOpenAtom);

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) setPendingNodeId(null);
  };

  return (
    <NodeSelector
      open={open}
      onOpenChange={handleOpenChange}
      pendingSourceNodeId={pendingNodeId}
    />
  );
};
