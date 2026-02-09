import { type NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { sendWorkflowExecution } from "@/inngest/utils";

// Initialize Stripe client for signature verification
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET || "";

// GET handler for testing/debugging
export async function GET(_request: NextRequest) {
  return NextResponse.json({
    message: "Stripe webhook endpoint is active",
    method: "POST",
    requiredParams: ["workflowId"],
    supportedEvents: [
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
    ],
  });
}

export async function POST(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const workflowId = url.searchParams.get("workflowId");

    if (!workflowId) {
      return NextResponse.json(
        {
          success: false,
          error: "Missing required query parameter: workflowId",
        },
        { status: 400 },
      );
    }

    let eventData: Stripe.Event | null = null;

    // Try signature verification if webhook secret is configured
    if (endpointSecret) {
      const payload = await request.text();
      const sig = request.headers.get("stripe-signature") || "";

      try {
        eventData = stripe.webhooks.constructEvent(
          payload,
          sig,
          endpointSecret,
        );
      } catch (err) {
        console.error(
          "[Stripe Webhook] Signature verification failed:",
          err instanceof Error ? err.message : String(err),
        );
        return NextResponse.json(
          { success: false, error: "Webhook signature verification failed" },
          { status: 400 },
        );
      }
    } else {
      // Dev/testing mode: no signature verification
      const body = await request.json();
      eventData = body as Stripe.Event;
      console.warn(
        "[Stripe Webhook] No STRIPE_WEBHOOK_SECRET configured - skipping signature verification. This is insecure in production!",
      );
    }

    // Extract structured data from the Stripe event
    const rawObject = eventData.data?.object as unknown as Record<
      string,
      unknown
    >;
    const stripeData = {
      // Event metadata
      eventId: eventData.id,
      eventType: eventData.type,
      timestamp: eventData.created,
      livemode: eventData.livemode,
      // Common fields extracted from the event data object
      amount: rawObject?.amount ?? rawObject?.amount_total ?? null,
      currency: rawObject?.currency ?? null,
      customerId: rawObject?.customer ?? null,
      status: rawObject?.status ?? null,
      description: rawObject?.description ?? null,
      // Full raw event data for advanced usage
      raw: rawObject,
    };

    console.log("[Stripe Webhook] Received event:", {
      workflowId,
      eventId: stripeData.eventId,
      eventType: stripeData.eventType,
      livemode: stripeData.livemode,
    });

    // Trigger an inngest workflow execution
    const result = await sendWorkflowExecution({
      workflowId: workflowId,
      initialData: {
        stripeData: stripeData,
      },
    });

    console.log("[Stripe Webhook] Inngest event sent:", result);

    return NextResponse.json(
      { success: true, message: "Stripe webhook processed successfully" },
      { status: 200 },
    );
  } catch (error) {
    console.error(
      "[Stripe Webhook] Error:",
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.json(
      { success: false, error: "Failed to process Stripe webhook" },
      { status: 500 },
    );
  }
}
