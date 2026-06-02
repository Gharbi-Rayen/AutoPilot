"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { ArrowLeftIcon, CheckIcon, CopyIcon, Loader2, PlusIcon } from "lucide-react";
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
import type { WorkflowRecord } from "@/lib/db";

interface CreateWorkflowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string, copyFromId?: string) => void;
  isPending?: boolean;
}

type Step = "name" | "copy";

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
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);

  const { data: existingWorkflows = [] } = useQuery<WorkflowRecord[]>({
    queryKey: ["workflows", "all-for-copy"],
    queryFn: () => db.workflows.orderBy("createdAt").reverse().toArray(),
    enabled: open,
  });

  useEffect(() => {
    if (!open) {
      setName("");
      setIsTaken(false);
      setChecking(false);
      setStep("name");
      setSelectedWorkflowId(null);
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
  const hasExisting = existingWorkflows.length > 0;

  const handleStartBlank = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onCreate(name.trim());
  };

  const handleGoToCopy = () => {
    if (!canSubmit) return;
    setStep("copy");
  };

  const handleCopyWorkflow = () => {
    if (!selectedWorkflowId || isPending) return;
    onCreate(name.trim(), selectedWorkflowId);
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
                Give your workflow a unique name, then start blank or copy an existing one.
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
                {hasExisting && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!canSubmit}
                    onClick={handleGoToCopy}
                  >
                    <CopyIcon className="size-4" />
                    Copy existing
                  </Button>
                )}
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
            key="step-copy"
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
                <DialogTitle>Copy a workflow</DialogTitle>
              </div>
              <DialogDescription className="pl-8">
                Select a workflow to copy as a starting point for{" "}
                <span className="font-medium text-foreground">"{name}"</span>.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-2 my-4 max-h-64 overflow-y-auto pr-1">
              {existingWorkflows.map((workflow) => {
                const isSelected = selectedWorkflowId === workflow.id;
                return (
                  <button
                    key={workflow.id}
                    type="button"
                    onClick={() => setSelectedWorkflowId(workflow.id)}
                    className={cn(
                      "w-full text-left px-3.5 py-3 rounded-xl border-2 transition-all duration-150 cursor-pointer",
                      "hover:shadow-sm",
                      isSelected
                        ? "border-primary bg-primary/5 shadow-none"
                        : "border-border bg-card hover:border-zinc-300",
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-foreground leading-snug truncate">
                          {workflow.name}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Created {formatDistanceToNow(new Date(workflow.createdAt), { addSuffix: true })}
                        </p>
                      </div>
                      {isSelected && (
                        <CheckIcon className="size-4 text-primary shrink-0" />
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
                disabled={!selectedWorkflowId || isPending}
                onClick={handleCopyWorkflow}
              >
                {isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <CopyIcon className="size-4" />
                )}
                Copy workflow
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
