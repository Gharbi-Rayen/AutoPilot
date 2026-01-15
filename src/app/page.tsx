import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import {Client} from "./client";
import {getQueryClient, trpc} from "@/trpc/server";
const page = async() =>{
  const queryClient = getQueryClient();
  void queryClient.prefetchQuery(trpc.getUsers.queryOptions());
  
  return( 
  <div className="min-h-screen min-w-screen flex items-center justify-center ">
  <HydrationBoundary state={dehydrate(queryClient)}>
   <Client />
  </HydrationBoundary>
    </div>);
};

export default page ;