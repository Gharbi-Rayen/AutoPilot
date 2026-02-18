"use client";
import { CopyIcon } from "lucide-react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { generateGoogleFormScript } from "./utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const GoogleFormDialog = ({ open, onOpenChange }: Props) => {
  const params = useParams();
  const workflowId = params.workflowId as string;

  // construct the webhook url

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  const webhookUrl = `${baseUrl}/api/webhooks/google-form?workflowId=${workflowId}`;

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      toast.success("Webhook URL copied to clipboard!");
    } catch {
      toast.error("Failed to copy URL.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Google Form Trigger Configuration</DialogTitle>
          <DialogDescription>
            Use this webhook URL to connect your Google Form to this trigger.
            When a form is submitted, the workflow will be executed.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="webhook-url" className="sr-only">
              <span className="font-medium">Webhook URL</span>
            </label>
            <div className="flex gap-2">
              <Input
                id="webhook-url"
                value={webhookUrl}
                readOnly
                className="font-mono text-sm"
              />
              <Button
                variant="outline"
                type="button"
                size="icon"
                onClick={copyToClipboard}
              >
                <CopyIcon className="size-4" />
              </Button>
            </div>
          </div>
          <div className="rounded-lg bg-muted p-4 space-y-2">
            <h4 className="font-medium text-sm">Setup instructions:</h4>
            <ol className="text-sm text-muted-foreground space-y-1 list-inside list-decimal">
              <li>Open your Google Form</li>
              <li>
                Click three dots → <strong>Script editor</strong>
              </li>
              <li>Delete existing code, paste script below, save</li>
              <li>
                Click <strong>Triggers</strong> → <strong>Add Trigger</strong>
              </li>
              <li>
                Function: <strong>onFormSubmit</strong> → Event:{" "}
                <strong>On form submit</strong>
              </li>
            </ol>
          </div>

          <div className="rounded-lg bg-muted p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-sm">Google Apps Script</h4>
              <Button
                variant="outline"
                type="button"
                size="sm"
                onClick={async () => {
                  const script = generateGoogleFormScript(webhookUrl);
                  try {
                    await navigator.clipboard.writeText(script);
                    toast.success(
                      "Script copied! Paste it in Google Apps Script editor.",
                    );
                  } catch {
                    toast.error("Failed to copy script.");
                  }
                }}
              >
                <CopyIcon className="size-4 mr-2" />
                Copy Script
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              ✓ Includes webhook URL and ngrok bypass header
              <br />✓ Ready to paste - no modifications needed
            </p>
          </div>

          <div className="rounded-lg bg-muted p-4 space-y-2">
            <h4 className="font-medium text-sm">
              Available variables in workflow:
            </h4>
            <div className="text-xs text-muted-foreground space-y-1">
              <div>
                <code className="bg-background px-1 py-0.5 rounded text-xs">
                  {"{{googleFormData.respondentEmail}}"}
                </code>{" "}
                - Email
              </div>
              <div>
                <code className="bg-background px-1 py-0.5 rounded text-xs">
                  {"{{googleFormData.responses['Question']}}"}
                </code>{" "}
                - Answer
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
