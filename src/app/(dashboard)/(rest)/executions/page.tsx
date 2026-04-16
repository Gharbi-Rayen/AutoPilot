import { Suspense } from "react";
import {
  ExecutionsComponent,
  ExecutionsLoading,
} from "@/features/executions/components/executions";

export default function ExecutionsPage() {
  return (
    <Suspense fallback={<ExecutionsLoading />}>
      <ExecutionsComponent />
    </Suspense>
  );
}
