"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Editor } from "@/features/editor/components/editor";
import { EditorHeader } from "@/features/editor/components/editor-header";

function EditorContent() {
  const searchParams = useSearchParams();
  const workflowId = searchParams.get("id") ?? "";
  return (
    <div className="flex h-full flex-col">
      <EditorHeader workflowId={workflowId} />
      <div className="min-h-0 flex-1">
        <Editor workflowId={workflowId} />
      </div>
    </div>
  );
}

export default function WorkflowEditorPage() {
  return (
    <Suspense>
      <EditorContent />
    </Suspense>
  );
}
