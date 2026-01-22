import { useTRPC } from "@/trpc/client";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";

import { toast } from "sonner";
import { useWorkflowsParams } from "./use-workflows-params";

/**
 * 
 * Use this hook to access workflow-related functionalities.
 * 
 * */

export const useSuspenseWorkflows = () => {
  // Placeholder for future workflow-related hooks and logic.
    const trpc  = useTRPC();
    const [params] = useWorkflowsParams();

    return useSuspenseQuery(trpc.workflows.getMany.queryOptions(params));
};


export const useCreateWorkflow = () => {
  
  const queryClient = useQueryClient();
  const trpc = useTRPC();

  return useMutation(trpc.workflows.create.mutationOptions({
    onSuccess : (data) =>{
      toast.success(`Workflow "${data.name}" created successfully.`);
      queryClient.invalidateQueries(trpc.workflows.getMany.queryOptions({}));
    },
    onError : (error) => {
      toast.error(`Failed to create workflow: ${error.message}`);
    },
  }),
);

   

};
