import type { ReactFlowInstance } from "@xyflow/react";
import { atom } from "jotai";

export const editorAtom = atom<ReactFlowInstance | null>(null);
export const workflowIdAtom = atom<string | null>(null);

/** nodeId of the node that triggered a quick-connect action */
export const pendingConnectionAtom = atom<string | null>(null);
/** whether the quick-connect node selector sheet is open */
export const quickConnectOpenAtom = atom<boolean>(false);
