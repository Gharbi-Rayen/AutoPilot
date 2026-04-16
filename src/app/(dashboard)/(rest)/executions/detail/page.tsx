"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { ExecutionDetail, ExecutionDetailLoading } from "@/features/executions/components/execution-detail";

function ExecutionDetailContent() {
  const searchParams = useSearchParams();
  const executionId = searchParams.get("id") ?? "";
  return <ExecutionDetail executionId={executionId} />;
}

export default function ExecutionDetailPage() {
  return (
    <Suspense fallback={<ExecutionDetailLoading />}>
      <ExecutionDetailContent />
    </Suspense>
  );
}
