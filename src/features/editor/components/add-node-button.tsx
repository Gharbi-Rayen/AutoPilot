"use client";

import { memo, useState } from "react";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NodeSelector } from "@/components/node-selector";

interface AddNodeButtonProps {
  onClick: () => void;
  ariaLabel?: string;
}

export const AddNodeButton = memo(({ onClick, ariaLabel = "Add node" }: AddNodeButtonProps) => {
const [selectorOpen, setSelectorOpen] = useState(false);
 
  return (
    <NodeSelector open={selectorOpen} onOpenChange={setSelectorOpen}>
    <Button
      onClick={onClick}
      size="icon"
      variant="outline"
      className="bg-background"
      aria-label={ariaLabel}
    >
      <PlusIcon aria-hidden="true" />
    </Button>
    </NodeSelector>
  );
});

AddNodeButton.displayName = "AddNodeButton";