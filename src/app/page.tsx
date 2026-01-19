"use client";

import { Button } from "@/components/ui/button";
import { requireAuth } from "@/lib/auth-utils";
import { useTRPC } from "@/trpc/client";
import { caller } from "@/trpc/server";
import { QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { use } from "react";
import { toast } from "sonner";


const page =  () =>{
  
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const  {data} = useQuery(trpc.getWorkflows.queryOptions());

  const testAi = useMutation(trpc.testAi.mutationOptions(

    {onSuccess: () =>{
      toast.success("AI job queued successfully");
      
      }
    }
  ));

  const create = useMutation(trpc.createWorkflow.mutationOptions({
    onSuccess: () =>{
    toast.success("Workflow created successfully");
    
    }
  }));



  return( 
   <div className="min-h-screen min-w-screen flex items-center justify-center ">
    {JSON.stringify(data,null,2)}
  
    <Button disabled={create.isPending} onClick={() => create.mutate()}>
      Create Workflow
    </Button> 
    <Button disabled={testAi.isPending} onClick={() => testAi.mutate()}>
      Test AI
    </Button>  
    </div>
  );
};

export default page ;