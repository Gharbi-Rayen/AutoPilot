"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
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
import { db } from "@/lib/db";

interface CreateWorkflowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string) => void;
  isPending?: boolean;
}

export const CreateWorkflowDialog = ({
  open,
  onOpenChange,
  onCreate,
  isPending,
}: CreateWorkflowDialogProps) => {
  const [name, setName] = useState("");
  const [isTaken, setIsTaken] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!open) {
      setName("");
      setIsTaken(false);
      setChecking(false);
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onCreate(name.trim());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create workflow</DialogTitle>
          <DialogDescription>
            Give your workflow a unique name to get started.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2 py-2">
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
              <p className="text-xs text-destructive">
                This name is already taken.
              </p>
            )}
            {checking && (
              <p className="text-xs text-muted-foreground">Checking…</p>
            )}
          </div>
          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
