import { useAtomValue } from "jotai";
import { FlaskConicalIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useExecuteWorkflow,
  useUpdateWorkflow,
} from "@/features/workflows/hooks/use-workflows";
import type { NodeType } from "@/generated/prisma";
import { editorAtom } from "../store/atoms";

export const ExecuteWorkflowButton = ({
  workflowId,
}: {
  workflowId: string;
}) => {
  const editor = useAtomValue(editorAtom);
  const saveWorkflow = useUpdateWorkflow();
  const executeWorkflow = useExecuteWorkflow();

  const handleExecute = async () => {
    if (!editor) {
      return;
    }

    const nodes = editor.getNodes().map((node) => ({
      id: node.id,
      type: node.type as NodeType,
      position: node.position,
      data: node.data as Record<string, unknown> | undefined,
    }));

    const edges = editor.getEdges().map((edge) => ({
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
    }));

    await saveWorkflow.mutateAsync({
      id: workflowId,
      nodes,
      edges,
    });

    executeWorkflow.mutate({ id: workflowId });
  };

  const isPending = executeWorkflow.isPending || saveWorkflow.isPending;

  return (
    <Button size="lg" onClick={handleExecute} disabled={isPending}>
      {isPending ? (
        <Loader2Icon className="size-4 animate-spin" />
      ) : (
        <FlaskConicalIcon className="size-4" />
      )}
      {isPending ? "Executing..." : "Execute Workflow"}
    </Button>
  );
};
