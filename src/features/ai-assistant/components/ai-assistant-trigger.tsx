"use client";

import { useAtom } from "jotai";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { aiPanelOpenAtom } from "../store/atoms";

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
