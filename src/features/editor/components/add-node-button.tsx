"use client";

import { memo } from "react";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AddNodeButtonProps {
  onClick: () => void;
  ariaLabel?: string;
}

export const AddNodeButton = memo(({ onClick, ariaLabel = "Add node" }: AddNodeButtonProps) => {
  return (
    <Button
      onClick={onClick}
      size="icon"
      variant="outline"
      className="bg-background"
      aria-label={ariaLabel}
    >
      <PlusIcon aria-hidden="true" />
    </Button>
  );
});

AddNodeButton.displayName = "AddNodeButton";