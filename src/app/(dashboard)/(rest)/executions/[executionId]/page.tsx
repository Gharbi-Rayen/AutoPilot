import { Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";
import {
  ExecutionDetail,
  ExecutionDetailError,
  ExecutionDetailLoading,
} from "@/features/executions/components/execution-detail";
import { prefetchExecutionSummary } from "@/features/executions/server/prefetch";
import { requireAuth } from "@/lib/auth-utils";
import { HydrateClient } from "@/trpc/server";

interface PageProps {
  params: Promise<{
    executionId: string;
  }>;
}

const page = async ({ params }: PageProps) => {
  await requireAuth();

  const { executionId } = await params;

  prefetchExecutionSummary(executionId);

  return (
    <HydrateClient>
      <ErrorBoundary fallback={<ExecutionDetailError />}>
        <Suspense fallback={<ExecutionDetailLoading />}>
          <ExecutionDetail executionId={executionId} />
        </Suspense>
      </ErrorBoundary>
    </HydrateClient>
  );
};

export default page;
