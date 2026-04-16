import { Suspense } from "react";
import {
  WorkflowsComponent,
  WorkflowsLoading,
} from "@/features/workflows/components/workflows";

export default function WorkflowsPage() {
  return (
    <Suspense fallback={<WorkflowsLoading />}>
      <WorkflowsComponent />
    </Suspense>
  );
}
