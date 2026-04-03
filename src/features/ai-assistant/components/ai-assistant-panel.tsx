"use client";

import { useMutation } from "@tanstack/react-query";
import { useReactFlow } from "@xyflow/react";
import { useAtom, useAtomValue } from "jotai";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  RotateCcw,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useTRPC } from "@/trpc/client";
import type { AIWorkflowNode, TopLevelResult } from "../lib/workflow-schema";
import {
  aiDraftAtom,
  aiGeneratingAtom,
  aiGenerationStepAtom,
  aiPanelOpenAtom,
  type ConversationMessage,
  conversationAtom,
} from "../store/atoms";

declare global {
  interface Window {
    _aiInterval?: number;
  }
}

const LOADING_STEPS = [
  "Reading your request…",
  "Selecting nodes…",
  "Writing code & templates…",
  "Calculating layout…",
];

export function AiAssistantPanel() {
  const [isOpen, setIsOpen] = useAtom(aiPanelOpenAtom);
  const [, setDraft] = useAtom(aiDraftAtom);
  const [conversation, setConversation] = useAtom(conversationAtom);
  const [, setIsGenerating] = useAtom(aiGeneratingAtom);
  const [, setGenerationStep] = useAtom(aiGenerationStepAtom);
  const isGenerating = useAtomValue(aiGeneratingAtom);

  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const { setNodes, setEdges, getNodes } = useReactFlow();
  const trpc = useTRPC();

  // Auto-scroll to latest message
  useEffect(() => {
    // Use length to align with dependency array and keep Biome happy
    void conversation.length;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation.length]);

  function buildHistoryForRouter() {
    return conversation
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => {
        if (m.role === "user") {
          return { role: "user" as const, content: m.content };
        }

        const msg = m as Extract<ConversationMessage, { role: "assistant" }>;

        if (msg.type === "workflow") {
          return {
            role: "assistant" as const,
            content: msg.explanation,
            workflowSnapshot: msg.workflowSnapshot,
          };
        }

        if (msg.type === "suggestion") {
          return { role: "assistant" as const, content: msg.message };
        }

        if (msg.type === "clarification") {
          return { role: "assistant" as const, content: msg.question };
        }

        return { role: "assistant" as const, content: "" };
      })
      .filter((m) => m.content.length > 0);
  }

  const { mutate } = useMutation(
    trpc.aiAssistant.generateWorkflow.mutationOptions({
      onMutate: () => {
        setIsGenerating(true);
        setGenerationStep(0);
        let step = 0;
        const interval = window.setInterval(() => {
          step = (step + 1) % 4;
          setGenerationStep(step);
        }, 1500);
        window._aiInterval = interval;
      },

      onSuccess: (data) => {
        const result = data as TopLevelResult;

        if (window._aiInterval !== undefined) {
          clearInterval(window._aiInterval);
        }
        setIsGenerating(false);
        setGenerationStep(0);

        if (result.type === "suggestion") {
          setConversation((prev) => [
            ...prev,
            {
              role: "assistant",
              type: "suggestion",
              message: result.message,
              suggestions: result.suggestions,
            },
          ]);
          return;
        }

        if (result.type === "clarification") {
          setConversation((prev) => [
            ...prev,
            {
              role: "assistant",
              type: "clarification",
              question: result.question,
            },
          ]);
          return;
        }

        const workflowSnapshot = JSON.stringify({
          nodes: result.nodes,
          edges: result.edges,
        });

        setConversation((prev) => [
          ...prev,
          {
            role: "assistant",
            type: "workflow",
            workflowName: result.workflowName,
            explanation: result.explanation,
            notes: result.notes,
            nodes: result.nodes,
            edges: result.edges,
            workflowSnapshot,
          },
        ]);

        setDraft({
          type: "workflow",
          workflowName: result.workflowName,
          explanation: result.explanation,
          notes: result.notes,
          nodes: result.nodes,
          edges: result.edges,
        });

        toast.success(`"${result.workflowName}" is ready to review`);
      },

      onError: () => {
        if (window._aiInterval !== undefined) {
          clearInterval(window._aiInterval);
        }
        setIsGenerating(false);
        setGenerationStep(0);

        setConversation((prev) => [
          ...prev,
          {
            role: "assistant",
            type: "error",
            message: "Something went wrong. Please try again.",
          },
        ]);
      },
    }),
  );

  function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || isGenerating) return;

    setConversation((prev) => [...prev, { role: "user", content }]);
    setInput("");
    setDraft(null);

    mutate({
      prompt: content,
      history: buildHistoryForRouter(),
    });
  }

  function handleApply(
    nodes: unknown[],
    edges: unknown[],
    mode: "overwrite" | "append",
  ) {
    const rfNodes = (
      nodes as (AIWorkflowNode & { position: { x: number; y: number } })[]
    ).map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: {
        label: n.data.label,
        type: n.type,
        parameters: n.data.parameters,
      },
      selected: false,
      dragging: false,
    }));

    const rfEdges = (
      edges as { id: string; source: string; target: string }[]
    ).map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: "smoothstep" as const,
      animated: false,
    }));

    if (mode === "overwrite") {
      setNodes(rfNodes);
      setEdges(rfEdges);
    } else {
      const existing = getNodes();
      const maxX = existing.reduce(
        (max, n) => Math.max(max, n.position.x + 240),
        0,
      );
      const offsetX = existing.length > 0 ? maxX + 120 : 0;
      const ts = Date.now();

      setNodes((prev) => [
        ...prev,
        ...rfNodes.map((n) => ({
          ...n,
          id: `ai_${ts}_${n.id}`,
          position: { ...n.position, x: n.position.x + offsetX },
        })),
      ]);
      setEdges((prev) => [
        ...prev,
        ...rfEdges.map((e) => ({
          ...e,
          id: `ai_${ts}_${e.id}`,
          source: `ai_${ts}_${e.source}`,
          target: `ai_${ts}_${e.target}`,
        })),
      ]);
    }

    toast.success("Workflow applied to canvas");
  }

  function handleNewConversation() {
    setConversation([]);
    setDraft(null);
    setInput("");
  }

  if (!isOpen) return null;

  const isEmpty = conversation.length === 0;

  return (
    <div
      style={{
        position: "absolute",
        bottom: "16px",
        right: "16px",
        zIndex: 50,
        width: "380px",
        maxHeight: "600px",
        display: "flex",
        flexDirection: "column",
        borderRadius: "16px",
        overflow: "hidden",
      }}
      className="border bg-background shadow-xl"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">AI Workflow Builder</span>
        </div>
        <div className="flex items-center gap-1">
          {conversation.length > 0 && (
            <button
              type="button"
              onClick={handleNewConversation}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div
        className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3"
        style={{ minHeight: 0 }}
      >
        {isEmpty && (
          <div className="flex flex-col gap-3 py-2">
            <p className="text-xs text-muted-foreground text-center">
              Describe what you want to automate in plain language.
              <br />
              I'll figure out the nodes.
            </p>
            {[
              "Take a CSV, find duplicate rows, generate a PDF report",
              "When a Stripe payment succeeds, send me an email summary",
              "When a Google Form is submitted, send a confirmation email",
            ].map((hint) => (
              <button
                key={hint}
                type="button"
                onClick={() => send(hint)}
                className="text-left text-xs px-3 py-2 rounded-lg border bg-muted/40 hover:bg-muted transition-colors"
              >
                {hint}
              </button>
            ))}
          </div>
        )}

        {conversation.map((msg, i) => (
          <MessageBubble
            // biome-ignore lint/suspicious/noArrayIndexKey: conversation is small and append-only
            key={i}
            message={msg}
            onSuggestionClick={(prompt) => send(prompt)}
            onApply={handleApply}
          />
        ))}

        {isGenerating && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-primary" />
            <span>{LOADING_STEPS[0]}</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="border-t px-3 py-3 shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            rows={1}
            placeholder={
              conversation.length > 0
                ? "Ask to refine or extend this workflow…"
                : "Describe what you want to automate…"
            }
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            disabled={isGenerating}
            className="flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ minHeight: "36px", maxHeight: "96px", overflow: "hidden" }}
          />
          <Button
            type="button"
            size="icon"
            disabled={!input.trim() || isGenerating}
            onClick={() => send()}
            className="rounded-full"
            style={{ width: "36px", height: "36px" }}
          >
            {isGenerating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Zap className="w-4 h-4" />
            )}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5 px-1">
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  onSuggestionClick,
  onApply,
}: {
  message: ConversationMessage;
  onSuggestionClick: (prompt: string) => void;
  onApply: (
    nodes: unknown[],
    edges: unknown[],
    mode: "overwrite" | "append",
  ) => void;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-3 py-2 text-sm max-w-[85%]">
          {message.content}
        </div>
      </div>
    );
  }

  const msg = message as Extract<ConversationMessage, { role: "assistant" }>;

  if (msg.type === "error") {
    return (
      <div className="flex items-start gap-2 text-xs text-destructive">
        <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>{msg.message}</span>
      </div>
    );
  }

  if (msg.type === "clarification") {
    return (
      <div className="bg-muted rounded-2xl rounded-tl-sm px-3 py-2.5 text-sm max-w-[90%]">
        {msg.question}
      </div>
    );
  }

  if (msg.type === "suggestion") {
    return (
      <div className="flex flex-col gap-2 max-w-[95%]">
        <p className="text-sm text-muted-foreground px-1">{msg.message}</p>
        {msg.suggestions.map((s) => (
          <button
            key={s.promptToGenerate}
            type="button"
            onClick={() => onSuggestionClick(s.promptToGenerate)}
            className="w-full text-left rounded-lg border bg-muted/40 hover:bg-muted px-3 py-2 transition-colors"
          >
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-xs font-medium line-clamp-1">
                {s.title}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{s.description}</p>
          </button>
        ))}
      </div>
    );
  }

  if (msg.type === "workflow") {
    return (
      <div className="flex flex-col gap-2 max-w-[95%]">
        <div className="bg-muted rounded-2xl rounded-tl-sm px-3 py-2.5 text-sm">
          {msg.explanation}
        </div>

        <div className="border rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/40">
            <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
            <span className="text-xs font-medium truncate">
              {msg.workflowName}
            </span>
          </div>

          {msg.notes && (
            <div className="flex gap-2 px-3 py-2 border-b">
              <span className="text-[11px] font-medium text-muted-foreground">
                Notes:
              </span>
              <p className="text-[11px] text-muted-foreground line-clamp-3">
                {msg.notes}
              </p>
            </div>
          )}

          <div className="flex gap-1.5 px-3 py-2">
            <Button
              type="button"
              size="sm"
              className="h-7 text-[11px] px-2"
              onClick={() => onApply(msg.nodes, msg.edges, "overwrite")}
            >
              Replace canvas
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-[11px] px-2"
              onClick={() => onApply(msg.nodes, msg.edges, "append")}
            >
              Append to canvas
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
