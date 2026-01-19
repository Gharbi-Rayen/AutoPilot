"use client";

import { Button } from "@/components/ui/button";
import { requireAuth } from "@/lib/auth-utils";
import { useTRPC } from "@/trpc/client";
import { caller } from "@/trpc/server";
import { QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { use } from "react";


const page =  () =>{
  
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const  {data} = useQuery(trpc.getWorkflows.queryOptions());

  const create = useMutation(trpc.createWorkflow.mutationOptions({
    onSuccess: () =>{
    queryClient.invalidateQueries(trpc.getWorkflows.queryOptions());
    
    }
  }));



  return( 
   <div className="min-h-screen min-w-screen flex items-center justify-center ">
    {JSON.stringify(data,null,2)}
  
    <Button disabled={create.isPending} onClick={() => create.mutate()}>
      Create Workflow
    </Button>   
    </div>
  );
};

export default page ;