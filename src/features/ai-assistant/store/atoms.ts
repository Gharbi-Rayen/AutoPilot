import { atom } from "jotai";

// Whether the AI assistant panel is visible
export const aiPanelOpenAtom = atom<boolean>(false);

// Draft state — holds the last generated workflow before the user confirms
export const aiDraftAtom = atom<{
  nodes: unknown[];
  edges: unknown[];
  notes: string;
  workflowName: string;
} | null>(null);

// Loading state for when the AI is currently generating a workflow
export const aiGeneratingAtom = atom<boolean>(false);

