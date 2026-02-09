import type { NodeExecutor } from "@/features/executions/components/types";
import { StripeTriggerChannel } from "@/inngest/channels/stripe-trigger";

type StripeTriggerData = Record<string, unknown>;

export const StripeExecutor: NodeExecutor<StripeTriggerData> = async ({
  nodeId,
  context,
  step,
  publish,
}) => {
  const updateStatePublish = async (state: "loading" | "error" | "success") => {
    const result = await publish(
      StripeTriggerChannel().status({
        nodeId,
        status: state,
      }),
    );
    return result;
  };

  // publish "loading" state for Stripe trigger node
  await updateStatePublish("loading");

  try {
    const result = await step.run("stripe-trigger", async () => {
      console.log("[StripeExecutor] Processing context:", {
        nodeId,
        contextKeys: Object.keys(context),
      });

      // Log the available variable paths for debugging
      if (context.stripeData) {
        const stripe = context.stripeData as Record<string, unknown>;
        console.log("[StripeExecutor] Available variable paths:");
        console.log("  - {{stripeData.eventId}}:", stripe.eventId);
        console.log("  - {{stripeData.eventType}}:", stripe.eventType);
        console.log("  - {{stripeData.customerId}}:", stripe.customerId);
        console.log("  - {{stripeData.amount}}:", stripe.amount);
        console.log("  - {{stripeData.currency}}:", stripe.currency);
        console.log("  - {{stripeData.status}}:", stripe.status);
        console.log(
          "  - To access raw fields, use: {{stripeData.raw.fieldName}}",
        );
      }

      return context;
    });

    // publish "completed" in success state for Stripe trigger node
    await updateStatePublish("success");
    return result;
  } catch (error) {
    console.error("[StripeExecutor] Error:", { nodeId, error });
    await updateStatePublish("error");
    throw error;
  }
};
