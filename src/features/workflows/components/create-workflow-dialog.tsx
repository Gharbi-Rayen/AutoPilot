"use client";

import { useEffect, useState } from "react";
import { ArrowLeftIcon, CheckIcon, Loader2, PlusIcon, SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { db } from "@/lib/db";
import {
  NODE_TYPE_LABELS,
  workflowTemplates,
  type WorkflowTemplate,
} from "../templates";

interface CreateWorkflowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string, template?: WorkflowTemplate) => void;
  isPending?: boolean;
}

type Step = "name" | "template";

export const CreateWorkflowDialog = ({
  open,
  onOpenChange,
  onCreate,
  isPending,
}: CreateWorkflowDialogProps) => {
  const [name, setName] = useState("");
  const [isTaken, setIsTaken] = useState(false);
  const [checking, setChecking] = useState(false);
  const [step, setStep] = useState<Step>("name");
  const [selectedTemplate, setSelectedTemplate] = useState<WorkflowTemplate | null>(null);

  useEffect(() => {
    if (!open) {
      setName("");
      setIsTaken(false);
      setChecking(false);
      setStep("name");
      setSelectedTemplate(null);
    }
  }, [open]);

  useEffect(() => {
    if (!name.trim()) {
      setIsTaken(false);
      return;
    }
    setChecking(true);
    const timer = setTimeout(async () => {
      const trimmed = name.trim().toLowerCase();
      const existing = await db.workflows
        .filter((w) => w.name.toLowerCase() === trimmed)
        .count();
      setIsTaken(existing > 0);
      setChecking(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [name]);

  const canSubmit = name.trim().length > 0 && !isTaken && !checking && !isPending;

  const handleStartBlank = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onCreate(name.trim());
  };

  const handleGoToTemplates = () => {
    if (!canSubmit) return;
    setStep("template");
  };

  const handleCreateFromTemplate = () => {
    if (!selectedTemplate || isPending) return;
    onCreate(name.trim(), selectedTemplate);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {step === "name" ? (
          <div
            key="step-name"
            className="animate-in fade-in-0 duration-150 motion-reduce:animate-none"
          >
            <DialogHeader>
              <DialogTitle>Create workflow</DialogTitle>
              <DialogDescription>
                Give your workflow a unique name, then start blank or pick a template.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleStartBlank}>
              <div className="flex flex-col gap-2 py-4">
                <Label htmlFor="workflow-name">Name</Label>
                <Input
                  id="workflow-name"
                  placeholder="my-workflow"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                  autoComplete="off"
                />
                {isTaken && (
                  <p className="text-xs text-destructive">This name is already taken.</p>
                )}
                {checking && (
                  <p className="text-xs text-muted-foreground">Checking…</p>
                )}
              </div>

              <DialogFooter className="mt-2 flex-col-reverse sm:flex-row gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={isPending}
                  className="sm:mr-auto"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!canSubmit}
                  onClick={handleGoToTemplates}
                >
                  <SparklesIcon className="size-4" />
                  Use a template
                </Button>
                <Button type="submit" disabled={!canSubmit}>
                  {isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <PlusIcon className="size-4" />
                  )}
                  Start blank
                </Button>
              </DialogFooter>
            </form>
          </div>
        ) : (
          <div
            key="step-template"
            className="animate-in fade-in-0 slide-in-from-right-4 duration-150 motion-reduce:animate-none"
          >
            <DialogHeader>
              <div className="flex items-center gap-2 -ml-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0"
                  onClick={() => setStep("name")}
                  aria-label="Back to name step"
                >
                  <ArrowLeftIcon className="size-4" />
                </Button>
                <DialogTitle>Choose a template</DialogTitle>
              </div>
              <DialogDescription className="pl-8">
                Select a starting point for <span className="font-medium text-foreground">"{name}"</span>.
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 my-4 max-h-64 overflow-y-auto pr-1">
              {workflowTemplates.map((template) => {
                const isSelected = selectedTemplate?.id === template.id;
                return (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => setSelectedTemplate(template)}
                    className={cn(
                      "w-full text-left p-3.5 rounded-xl border-2 transition-all duration-150 cursor-pointer",
                      "hover:shadow-sm",
                      isSelected
                        ? "border-primary bg-primary/5 shadow-none"
                        : "border-border bg-card hover:border-zinc-300",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-xl leading-none mt-0.5 shrink-0" aria-hidden>
                        {template.icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-foreground leading-snug">
                          {template.name}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-snug line-clamp-2">
                          {template.description}
                        </p>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {template.nodeTypes.map((nt) => (
                            <span
                              key={nt}
                              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground"
                            >
                              {NODE_TYPE_LABELS[nt] ?? nt}
                            </span>
                          ))}
                        </div>
                      </div>
                      {isSelected && (
                        <CheckIcon className="size-4 text-primary shrink-0 mt-0.5" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep("name")}
                className="sm:mr-auto"
              >
                Back
              </Button>
              <Button
                type="button"
                disabled={!selectedTemplate || isPending}
                onClick={handleCreateFromTemplate}
              >
                {isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <SparklesIcon className="size-4" />
                )}
                Create from template
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
