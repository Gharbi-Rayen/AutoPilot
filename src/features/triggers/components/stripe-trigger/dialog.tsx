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

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const StripeTriggerDialog = ({ open, onOpenChange }: Props) => {
  const params = useParams();
  const workflowId = params.workflowId as string;

  // construct the webhook url

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  const webhookUrl = `${baseUrl}/api/webhooks/stripe?workflowId=${workflowId}`;

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
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Stripe Trigger Configuration</DialogTitle>
          <DialogDescription>
            Configure this webhook URL in your Stripe dashboard to trigger the
            workflow when a Stripe event occurs.
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
              <li>Open your Stripe Dashboard</li>
              <li>
                Go to <strong>Developers</strong> → <strong>Webhooks</strong>
              </li>
              <li>
                Click <strong>Add endpoint</strong> and paste the webhook URL
                above
              </li>
              <li>Select the events you want to trigger the workflow</li>
              <li>
                Save and copy the signing secret to your{" "}
                <code className="bg-background px-1 py-0.5 rounded">.env</code>{" "}
                file as{" "}
                <code className="bg-background px-1 py-0.5 rounded">
                  STRIPE_WEBHOOK_SECRET
                </code>
              </li>
            </ol>
          </div>

          <div className="rounded-lg bg-muted p-4 space-y-2">
            <h4 className="font-medium text-sm">Supported event types:</h4>
            <div className="grid grid-cols-2 gap-1">
              {[
                "payment_intent.succeeded",
                "payment_intent.payment_failed",
                "customer.created",
                "customer.updated",
                "charge.succeeded",
                "charge.refunded",
                "invoice.paid",
                "invoice.payment_failed",
                "checkout.session.completed",
                "customer.subscription.created",
                "customer.subscription.updated",
                "customer.subscription.deleted",
              ].map((eventType) => (
                <span
                  key={eventType}
                  className="text-xs text-muted-foreground font-mono"
                >
                  {eventType}
                </span>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Any Stripe event type is supported. The above are the most common
              ones.
            </p>
          </div>

          <div className="rounded-lg bg-muted p-4 space-y-2">
            <h4 className="font-medium text-sm">
              Available variables in workflow:
            </h4>
            <ul className="text-xs text-muted-foreground space-y-1">
              <li>
                <code className="bg-background px-1 py-0.5 rounded">
                  {"{{stripeData.eventId}}"}
                </code>
                : Stripe event ID (e.g. evt_xxx)
              </li>
              <li>
                <code className="bg-background px-1 py-0.5 rounded">
                  {"{{stripeData.eventType}}"}
                </code>
                : Event type (e.g. payment_intent.succeeded)
              </li>
              <li>
                <code className="bg-background px-1 py-0.5 rounded">
                  {"{{stripeData.amount}}"}
                </code>
                : Amount (in cents)
              </li>
              <li>
                <code className="bg-background px-1 py-0.5 rounded">
                  {"{{stripeData.currency}}"}
                </code>
                : Currency code (e.g. usd)
              </li>
              <li>
                <code className="bg-background px-1 py-0.5 rounded">
                  {"{{stripeData.customerId}}"}
                </code>
                : Stripe customer ID
              </li>
              <li>
                <code className="bg-background px-1 py-0.5 rounded">
                  {"{{stripeData.status}}"}
                </code>
                : Status of the object
              </li>
              <li>
                <code className="bg-background px-1 py-0.5 rounded">
                  {"{{stripeData.description}}"}
                </code>
                : Description field
              </li>
              <li>
                <code className="bg-background px-1 py-0.5 rounded">
                  {"{{stripeData.timestamp}}"}
                </code>
                : Event creation timestamp
              </li>
              <li>
                <code className="bg-background px-1 py-0.5 rounded">
                  {"{{stripeData.livemode}}"}
                </code>
                : true if live, false if test
              </li>
              <li>
                <code className="bg-background px-1 py-0.5 rounded">
                  {"{{json stripeData.raw}}"}
                </code>
                : Full raw event data object
              </li>
            </ul>
          </div>

          <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4 space-y-2">
            <h4 className="font-medium text-sm text-yellow-600">
              Local development (Stripe CLI):
            </h4>
            <p className="text-xs text-muted-foreground">
              Use the Stripe CLI to forward events to your local server:
            </p>
            <code className="text-xs text-muted-foreground block bg-background p-2 rounded font-mono break-all">
              stripe listen --forward-to {webhookUrl}
            </code>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
