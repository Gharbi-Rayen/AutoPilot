/**
 * src/features/ai-assistant/components/ai-assistant-panel.tsx
 */

"use client";

import { useState } from "react";
import { useAtom } from "jotai";
import { useReactFlow } from "@xyflow/react";
import { useTRPC } from "@/trpc/client";
import { useMutation } from "@tanstack/react-query";
import { aiPanelOpenAtom, aiDraftAtom } from "../store/atoms";
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
  HelpCircle,
} from "lucide-react";
import { toast } from "sonner";
import type { AIWorkflowNode } from "../lib/workflow-schema";

const LOADING_STEPS = [
  "Reading your request...",
  "Selecting the right nodes...",
  "Writing code and templates...",
  "Calculating layout...",
];

export function AiAssistantPanel() {
  const [isOpen, setIsOpen] = useAtom(aiPanelOpenAtom);
  const [draft, setDraft] = useAtom(aiDraftAtom);
  const [prompt, setPrompt] = useState("");
  const [loadingStep, setLoadingStep] = useState(0);

  // Clarification state — questions from Gemini + user answers
  const [clarificationQuestions, setClarificationQuestions] = useState<string[]>([]);
  const [clarificationAnswers, setClarificationAnswers] = useState<string[]>([]);

  const { setNodes, setEdges, getNodes } = useReactFlow();
  const trpc = useTRPC();

  const { mutate, isPending } = useMutation(
    trpc.aiAssistant.generateWorkflow.mutationOptions({
      onMutate: () => {
        let step = 0;
        const interval = window.setInterval(() => {
          step = (step + 1) % LOADING_STEPS.length;
          setLoadingStep(step);
        }, 1500);
        window.sessionStorage.setItem('_aiInterval', interval.toString());
      },

      onSuccess: (data) => {
        const intervalStr = window.sessionStorage.getItem('_aiInterval');
        if (intervalStr) {
          window.clearInterval(parseInt(intervalStr, 10));
          window.sessionStorage.removeItem('_aiInterval');
        }

        if (data.type === "clarification") {
          // Gemini needs more info — show questions inline, no error
          setClarificationQuestions(data.questions);
          setClarificationAnswers(new Array(data.questions.length).fill(""));
          return;
        }

        // Happy path — workflow is ready
        setClarificationQuestions([]);
        setClarificationAnswers([]);
        setDraft(data);
        toast.success(`"${data.workflowName}" is ready to review`);
      },

      onError: () => {
        const intervalStr = window.sessionStorage.getItem('_aiInterval');
        if (intervalStr) {
          window.clearInterval(parseInt(intervalStr, 10));
          window.sessionStorage.removeItem('_aiInterval');
        }
        // Generic error — do not tell the user their prompt is bad
        toast.error("Something went wrong generating the workflow. Please try again.");
      },
    })
  );

  // ── Submit handlers ─────────────────────────────────────────────────────────

  function handleGenerate() {
    if (!prompt.trim()) return;
    setDraft(null);
    setClarificationQuestions([]);
    mutate({ prompt });
  }

  // When the user has answered the clarifying questions, merge answers into
  // the original prompt and resubmit automatically.
  function handleAnswerSubmit() {
    const enrichedPrompt =
      `${prompt}\n\nAdditional context:\n` +
      clarificationQuestions
        .map((q, i) => `${q} — ${clarificationAnswers[i] || "not specified"}`)
        .join("\n");

    setClarificationQuestions([]);
    mutate({ prompt: enrichedPrompt });
  }

  // ── Canvas injection ────────────────────────────────────────────────────────

  function handleApply(mode: "overwrite" | "append") {
    if (!draft || draft.type !== "workflow" || !draft.nodes || !draft.edges) return;

    const reactFlowNodes = (draft.nodes as (AIWorkflowNode & { position: {x: number, y: number} })[]).map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: { label: n.data.label, type: n.type, parameters: n.data.parameters },
      selected: false,
      dragging: false,
    }));

    const reactFlowEdges = draft.edges.map((e) => ({
      id: e.id as string,
      source: e.source as string,
      target: e.target as string,
      type: "smoothstep",
      animated: false,
    }));

    if (mode === "overwrite") {
      setNodes(reactFlowNodes);
      setEdges(reactFlowEdges);
    } else {
      const existingNodes = getNodes();
      const maxX = existingNodes.reduce(
        (max, n) => Math.max(max, n.position.x + 240),
        0
      );
      const offsetX = existingNodes.length > 0 ? maxX + 120 : 0;
      const ts = Date.now();

      setNodes((prev) => [
        ...prev,
        ...reactFlowNodes.map((n) => ({
          ...n,
          id: `ai_${ts}_${n.id}`,
          position: { ...n.position, x: n.position.x + offsetX },
        })),
      ]);
      setEdges((prev) => [
        ...prev,
        ...reactFlowEdges.map((e) => ({
          ...e,
          id: `ai_${ts}_${e.id}`,
          source: `ai_${ts}_${e.source}`,
          target: `ai_${ts}_${e.target}`,
        })),
      ]);
    }

    toast.success("Workflow applied to canvas");
    setDraft(null);
    setIsOpen(false);
  }

  function handleDiscard() {
    setDraft(null);
    setPrompt("");
    setClarificationQuestions([]);
    setClarificationAnswers([]);
  }

  if (!isOpen) return null;

  const hasClarification = clarificationQuestions.length > 0;
  const hasWorkflow = draft && draft.type === "workflow";

  return (
    <div className="absolute bottom-4 right-4 z-50 w-[400px] rounded-xl border bg-background shadow-xl flex flex-col overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">AI Workflow Builder</span>
        </div>
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-col gap-3 p-4">

        {/* Prompt input */}
        <Textarea
          placeholder='Describe your workflow… e.g. "Take a CSV file, find duplicate rows, and generate a PDF report"'
          className="min-h-[90px] resize-none text-sm"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGenerate();
          }}
          disabled={isPending}
        />

        {/* Loading */}
        {isPending && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            <span>{LOADING_STEPS[loadingStep]}</span>
          </div>
        )}

        {/* ── Clarification mode ─────────────────────────────────────────── */}
        {hasClarification && !isPending && (
          <div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-3">
            <div className="flex items-center gap-2">
              <HelpCircle className="h-4 w-4 shrink-0 text-amber-500" />
              <span className="text-sm font-medium">
                A few quick questions first
              </span>
            </div>

            {clarificationQuestions.map((question, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: Fixed size from server
              <div key={i} className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground" htmlFor={`question-${i}`}>
                  {question}
                </label>
                <input
                  id={`question-${i}`}
                  className="w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="Your answer…"
                  value={clarificationAnswers[i] ?? ""}
                  onChange={(e) => {
                    const next = [...clarificationAnswers];
                    next[i] = e.target.value;
                    setClarificationAnswers(next);
                  }}
                />
              </div>
            ))}

            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                className="flex-1 gap-2 text-xs"
                onClick={handleAnswerSubmit}
                disabled={clarificationAnswers.every((a) => !a.trim())}
              >
                <Sparkles className="h-3.5 w-3.5" />
                Generate now
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-xs"
                onClick={handleDiscard}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* ── Workflow draft review ──────────────────────────────────────── */}
        {hasWorkflow && !isPending && draft && (
          <div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
              <span className="truncate text-sm font-medium">
                {draft.workflowName}
              </span>
              <Badge variant="secondary" className="ml-auto shrink-0 text-xs">
                {draft.nodes?.length ?? 0} nodes
              </Badge>
            </div>

            {/* AI notes */}
            {draft.notes && (
              <div className="flex gap-2 rounded-md border bg-background p-2 text-xs text-muted-foreground">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                <span>{draft.notes}</span>
              </div>
            )}

            {/* Actions */}
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
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* Generate button — hidden while clarifying or reviewing */}
        {!hasClarification && !hasWorkflow && (
          <Button
            size="sm"
            onClick={handleGenerate}
            disabled={isPending || prompt.trim().length < 10}
            className="w-full gap-2"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {isPending ? "Generating…" : "Generate workflow  ⌘↵"}
          </Button>
        )}
      </div>
    </div>
  );
}