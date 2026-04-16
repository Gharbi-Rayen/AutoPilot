"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Editor } from "@/features/editor/components/editor";

function EditorContent() {
  const searchParams = useSearchParams();
  const workflowId = searchParams.get("id") ?? "";
  return <Editor workflowId={workflowId} />;
}

export default function WorkflowEditorPage() {
  return (
    <Suspense>
      <EditorContent />
    </Suspense>
  );
}
