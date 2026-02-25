import { FlaskConicalIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useExecuteWorkflow } from "@/features/workflows/hooks/use-workflows";

export const ExecuteWorkflowButton = ({
  workflowId,
}: {
  workflowId: string;
}) => {
  const executeWorkflow = useExecuteWorkflow();

  const handleExecute = () => {
    executeWorkflow.mutate({ id: workflowId });
  };

  return (
    <Button
      size="lg"
      onClick={handleExecute}
      disabled={executeWorkflow.isPending}
    >
      {executeWorkflow.isPending ? (
        <Loader2Icon className="size-4 animate-spin" />
      ) : (
        <FlaskConicalIcon className="size-4" />
      )}
      {executeWorkflow.isPending ? "Executing..." : "Execute Workflow"}
    </Button>
  );
};
