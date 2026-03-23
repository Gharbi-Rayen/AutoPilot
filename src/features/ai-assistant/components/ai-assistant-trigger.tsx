"use client";

import { useAtom } from "jotai";
import { aiPanelOpenAtom } from "../store/atoms";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";

export function AiAssistantTrigger() {
  const [isOpen, setIsOpen] = useAtom(aiPanelOpenAtom);

  return (
    <Button
      size="sm"
      variant={isOpen ? "default" : "outline"}
      className="gap-2"
      onClick={() => setIsOpen((v) => !v)}
    >
      <Sparkles className="w-4 h-4" />
      AI Builder
    </Button>
  );
}
