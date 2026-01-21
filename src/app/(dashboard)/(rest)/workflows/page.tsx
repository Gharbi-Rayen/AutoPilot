import { prefetchWorkflows } from "@/features/workflows/server/prefetch";
import { requireAuth } from "@/lib/auth-utils";
import { HydrateClient } from "@/trpc/server";
import { Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { WorkflowsContainer, WorkflowsList } from "@/features/workflows/components/workflows";
const page = async () => {
    await requireAuth();

    prefetchWorkflows();
    return (
      <WorkflowsContainer>
           <HydrateClient>
              <ErrorBoundary fallback={<p>Something went wrong.</p>}>
                  <Suspense fallback={<p>Loading workflows...</p>}>
                        <WorkflowsList />
                  </Suspense>
              </ErrorBoundary>
           </HydrateClient>
      </WorkflowsContainer>

    );
   

};

export default page;
