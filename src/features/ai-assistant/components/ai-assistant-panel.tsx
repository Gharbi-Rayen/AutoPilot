"use client";

import { useState } from "react";
import { useSetAtom, useAtom } from "jotai";
import { useReactFlow } from "@xyflow/react";
import { useTRPC } from "@/trpc/client";
import { useMutation } from "@tanstack/react-query";
import { aiPanelOpenAtom, aiDraftAtom, aiGeneratingAtom } from "../store/atoms";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";

const LOADING_STEPS = [
  "Reading your request...",
  "Selecting the right nodes...",
  "Wiring variables...",
  "Calculating layout...",
];

export function AiAssistantPanel() {
  const [isOpen, setIsOpen] = useAtom(aiPanelOpenAtom);
  const [draft, setDraft] = useAtom(aiDraftAtom);
  const setAiGenerating = useSetAtom(aiGeneratingAtom);
  const [prompt, setPrompt] = useState("");
  const [loadingStep, setLoadingStep] = useState(0);
  const { setNodes, setEdges, getNodes } = useReactFlow();
  const trpc = useTRPC();

  const { mutate, isPending } = useMutation(
    trpc.aiAssistant.generateWorkflow.mutationOptions({
      onMutate: () => {
      setAiGenerating(true);
      // Cycle through loading messages every 1.5s
      let step = 0;
      const interval = setInterval(() => {
        step = (step + 1) % LOADING_STEPS.length;
        setLoadingStep(step);
      }, 1500);
      // Store interval ref for cleanup
      (window as unknown as { _aiInterval: ReturnType<typeof setInterval> })._aiInterval = interval;
    },
    onSuccess: (data: { workflowName: string; nodes: unknown[]; edges: unknown[]; notes: string }) => {
      setAiGenerating(false);
      clearInterval(
        (window as unknown as { _aiInterval: ReturnType<typeof setInterval> })._aiInterval
      );
      setDraft(data);
      toast.success(`Workflow "${data.workflowName}" is ready to review`);
    },
    onError: (err: { message: string }) => {
      setAiGenerating(false);
      clearInterval(
        (window as unknown as { _aiInterval: ReturnType<typeof setInterval> })._aiInterval
      );
      toast.error("Generation failed: " + err.message);
    },
  }));

  function handleGenerate() {
    if (!prompt.trim()) return;
    setDraft(null);
    mutate({ prompt });
  }

  function handleApply(mode: "overwrite" | "append") {
    if (!draft) return;

    const reactFlowNodes = draft.nodes.map((n: unknown) => {
      const node = n as {
        id: string;
        type: string;
        position: { x: number; y: number };
        data: { label: string; parameters: Record<string, unknown> };
      };
      return {
        id: node.id,
        type: node.type,
        position: node.position,
        data: {
          label: node.data.label,
          type: node.type,
          parameters: node.data.parameters,
        },
      };
    });

    const reactFlowEdges = draft.edges.map((e: unknown) => {
      const edge = e as { id: string; source: string; target: string };
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: "smoothstep",
      };
    });

    let finalNodes = reactFlowNodes;
    let finalEdges = reactFlowEdges;

    if (mode === "append") {
      // Append: offset new nodes so they don't overlap existing ones
      const existingNodes = getNodes();
      const maxX = existingNodes.length > 0 ? Math.max(...existingNodes.map((n) => n.position.x)) : 0;
      const offset = existingNodes.length > 0 ? maxX + 300 : 0;
      
      const prefix = `ai_${Date.now()}_`;
      finalNodes = reactFlowNodes.map((n) => ({
        ...n,
        id: prefix + n.id,
        position: { ...n.position, x: n.position.x + offset },
      }));

      finalEdges = reactFlowEdges.map((e) => ({
        ...e,
        id: prefix + e.id,
        source: prefix + e.source,
        target: prefix + e.target,
      }));

      setNodes((prev) => [...prev, ...finalNodes]);
      setEdges((prev) => [...prev, ...finalEdges]);
    } else {
      setNodes(finalNodes);
      setEdges(finalEdges);
    }

    toast.success("Workflow applied to canvas");
    setDraft(null);
    setIsOpen(false);
  }

  function handleDiscard() {
    setDraft(null);
    setPrompt("");
  }

  const hasCanvasTrigger = getNodes().some((n) => n.type?.includes("TRIGGER") || n.type === "MANUAL_TRIGGER");
  const draftHasTrigger = draft
    ? (draft.nodes as { type: string }[]).some((n) => n.type?.includes("TRIGGER") || n.type === "MANUAL_TRIGGER")
    : false;
  const showTriggerWarning = hasCanvasTrigger && draftHasTrigger;

  if (!isOpen) return null;

  return (
    <div className="absolute bottom-4 right-4 z-50 w-[400px] rounded-xl border bg-background shadow-xl flex flex-col gap-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">AI Workflow Builder</span>
        </div>
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div className="p-4 flex flex-col gap-3">
        {/* Prompt input */}
        <Textarea
          placeholder="Describe your workflow... e.g. 'When a Stripe payment succeeds, summarize it with Gemini and send it to Slack'"
          className="resize-none text-sm min-h-[90px]"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGenerate();
          }}
          disabled={isPending}
        />

        {/* Loading state */}
        {isPending && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>{LOADING_STEPS[loadingStep]}</span>
          </div>
        )}

        {/* Draft review panel */}
        {draft && !isPending && (
          <div className="rounded-lg border bg-muted/40 p-3 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
              <span className="text-sm font-medium">{draft.workflowName}</span>
              <Badge variant="secondary" className="ml-auto text-xs">
                {(draft.nodes as unknown[]).length} nodes
              </Badge>
            </div>

            {/* AI notes */}
            <div className="flex gap-2 text-xs text-muted-foreground bg-background rounded-md p-2 border">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-500" />
              <span>{draft.notes}</span>
            </div>

            {/* Multiple trigger warning */}
            {showTriggerWarning && (
              <div className="flex gap-2 text-xs text-red-600 bg-red-500/10 rounded-md p-2 border border-red-500/20">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  <strong>Warning:</strong> The canvas already has a trigger node. Appending this draft will create multiple triggers, which may cause execution errors. Consider replacing the canvas instead.
                </span>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-2">
              <Button
                size="sm"
                className="flex-1 text-xs"
                onClick={() => handleApply("overwrite")}
              >
                Replace canvas
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1 text-xs"
                onClick={() => handleApply("append")}
              >
                Append
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="shrink-0"
                onClick={handleDiscard}
                title="Discard"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* Generate button */}
        {!draft && (
          <Button
            size="sm"
            onClick={handleGenerate}
            disabled={isPending || prompt.trim().length < 10}
            className="w-full gap-2"
          >
            {isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            {isPending ? "Generating..." : "Generate workflow (⌘↵)"}
          </Button>
        )}
      </div>
    </div>
  );
}
