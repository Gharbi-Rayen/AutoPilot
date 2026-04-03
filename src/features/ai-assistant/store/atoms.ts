import { atom } from "jotai";

// Whether the AI assistant panel is open
export const aiPanelOpenAtom = atom<boolean>(false);

// ── Conversation history ──────────────────────────────────────────────────────
// Each message in the conversation. Cleared when the panel is closed and
// the user discards the session, or when they click "New conversation".

export type ConversationMessage =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      type: "workflow";
      workflowName: string;
      explanation: string;
      notes: string;
      nodes: unknown[];
      edges: unknown[];
      workflowSnapshot: string;
    }
  | {
      role: "assistant";
      type: "suggestion";
      message: string;
      suggestions: {
        title: string;
        description: string;
        promptToGenerate: string;
      }[];
    }
  | { role: "assistant"; type: "clarification"; question: string }
  | { role: "assistant"; type: "error"; message: string };

export const conversationAtom = atom<ConversationMessage[]>([]);

// ── Draft workflow (last generated, pending user confirmation) ────────────────
export const aiDraftAtom = atom<{
  type: "workflow";
  workflowName: string;
  explanation: string;
  notes: string;
  nodes: unknown[];
  edges: unknown[];
} | null>(null);

// ── Generation loading state (shared with canvas indicator) ──────────────────
export const aiGeneratingAtom = atom<boolean>(false);
export const aiGenerationStepAtom = atom<number>(0);
