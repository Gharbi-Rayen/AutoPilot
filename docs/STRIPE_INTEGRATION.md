# Stripe Integration Guide

## Overview

AutoPilot supports Stripe as a trigger node in your workflow automation. When a Stripe event occurs (e.g., a payment succeeds, a customer is created, a subscription changes), your workflow is automatically triggered with the event data available as variables.

## Architecture

```
Stripe Dashboard → Webhook Event → /api/webhooks/stripe?workflowId=xxx
                                         ↓
                                    Verify Signature (production)
                                         ↓
                                    Extract Event Data
                                         ↓
                                    Inngest (sendWorkflowExecution)
                                         ↓
                                    StripeExecutor → Next Nodes...
```

### Components

| Component             | Path                                                          | Purpose                                                          |
| --------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Webhook Route**     | `src/app/api/webhooks/stripe/route.ts`                        | Receives POST from Stripe, verifies signature, triggers workflow |
| **Stripe Node UI**    | `src/features/triggers/components/stripe-trigger/node.tsx`    | React Flow node component with real-time status                  |
| **Stripe Dialog**     | `src/features/triggers/components/stripe-trigger/dialog.tsx`  | Configuration dialog showing webhook URL and setup instructions  |
| **Stripe Executor**   | `src/features/triggers/components/stripe-trigger/executor.ts` | Server-side executor that processes Stripe data in the workflow  |
| **Stripe Channel**    | `src/inngest/channels/stripe-trigger.ts`                      | Inngest real-time channel for status updates                     |
| **Stripe Actions**    | `src/features/triggers/components/stripe-trigger/actions.ts`  | Server actions for fetching real-time tokens                     |
| **Executor Registry** | `src/features/executions/components/lib/executor-registry.ts` | Maps `STRIPE_TRIGGER` to `StripeExecutor`                        |
| **Node Components**   | `src/config/node-components.ts`                               | Maps `STRIPE_TRIGGER` to `StripeTriggerNode` React component     |
| **Prisma Schema**     | `prisma/schema.prisma`                                        | Defines `STRIPE_TRIGGER` in the `NodeType` enum                  |

---

## Environment Variables

Add these to your `.env` file:

```env
# Stripe
STRIPE_SECRET_KEY="sk_test_YOUR_STRIPE_SECRET_KEY"
STRIPE_WEBHOOK_SECRET="whsec_YOUR_WEBHOOK_SECRET"
```

### How to get these values

1. **STRIPE_SECRET_KEY**: Go to [Stripe Dashboard](https://dashboard.stripe.com/apikeys) → Developers → API Keys → Secret key
2. **STRIPE_WEBHOOK_SECRET**: This is generated when you create a webhook endpoint in Stripe Dashboard → Developers → Webhooks → Add endpoint → After saving, reveal the signing secret

> **Note**: For local development with Stripe CLI, the webhook secret is displayed when you run `stripe listen`.

---

## Setup Instructions

### 1. Add Stripe Trigger to Your Workflow

1. Open a workflow in the editor
2. Click the **Add Node** button
3. Select **Stripe Trigger** from the trigger nodes
4. Double-click the Stripe node to open settings
5. Copy the webhook URL displayed in the dialog

### 2. Configure Stripe Dashboard (Production)

1. Go to [Stripe Dashboard](https://dashboard.stripe.com/webhooks)
2. Click **Add endpoint**
3. Paste your webhook URL: `https://your-domain.com/api/webhooks/stripe?workflowId=YOUR_WORKFLOW_ID`
4. Select the events you want to listen for
5. Click **Add endpoint**
6. Copy the **Signing secret** and add it to your `.env` as `STRIPE_WEBHOOK_SECRET`

### 3. Local Development with Stripe CLI

```bash
# Install Stripe CLI (if not already installed)
# Windows: scoop install stripe
# macOS: brew install stripe/stripe-cli/stripe

# Login to Stripe
stripe login

# Forward events to your local server
stripe listen --forward-to localhost:3000/api/webhooks/stripe?workflowId=YOUR_WORKFLOW_ID

# In another terminal, trigger test events
stripe trigger payment_intent.succeeded
stripe trigger customer.created
stripe trigger invoice.paid
```

### 4. Local Development with ngrok

If using ngrok for external access:

```bash
# Start ngrok
ngrok http 3000

# Use the ngrok URL in Stripe Dashboard
# https://your-id.ngrok.io/api/webhooks/stripe?workflowId=YOUR_WORKFLOW_ID
```

---

## Supported Event Types

The Stripe trigger supports **any** Stripe event type. Common ones include:

### Payment Events

| Event                           | Description                    |
| ------------------------------- | ------------------------------ |
| `payment_intent.succeeded`      | Payment completed successfully |
| `payment_intent.payment_failed` | Payment attempt failed         |
| `charge.succeeded`              | Charge was successful          |
| `charge.refunded`               | Charge was refunded            |

### Customer Events

| Event              | Description              |
| ------------------ | ------------------------ |
| `customer.created` | New customer created     |
| `customer.updated` | Customer details updated |
| `customer.deleted` | Customer deleted         |

### Subscription Events

| Event                           | Description              |
| ------------------------------- | ------------------------ |
| `customer.subscription.created` | New subscription started |
| `customer.subscription.updated` | Subscription changed     |
| `customer.subscription.deleted` | Subscription cancelled   |

### Invoice Events

| Event                    | Description               |
| ------------------------ | ------------------------- |
| `invoice.paid`           | Invoice payment succeeded |
| `invoice.payment_failed` | Invoice payment failed    |
| `invoice.created`        | New invoice created       |

### Checkout Events

| Event                        | Description               |
| ---------------------------- | ------------------------- |
| `checkout.session.completed` | Checkout session finished |

---

## Available Workflow Variables

When a Stripe event triggers a workflow, these variables are available to downstream nodes (e.g., HTTP Request node):

| Variable                     | Description                     | Example                    |
| ---------------------------- | ------------------------------- | -------------------------- |
| `{{stripeData.eventId}}`     | Stripe event ID                 | `evt_1MoC0...`             |
| `{{stripeData.eventType}}`   | Event type string               | `payment_intent.succeeded` |
| `{{stripeData.amount}}`      | Amount in smallest unit (cents) | `2000`                     |
| `{{stripeData.currency}}`    | Currency code                   | `usd`                      |
| `{{stripeData.customerId}}`  | Stripe customer ID              | `cus_Nh1...`               |
| `{{stripeData.status}}`      | Object status                   | `succeeded`                |
| `{{stripeData.description}}` | Description field               | `Payment for order #123`   |
| `{{stripeData.timestamp}}`   | Unix timestamp of event         | `1675000000`               |
| `{{stripeData.livemode}}`    | Live or test mode               | `false`                    |
| `{{json stripeData.raw}}`    | Full raw event data object      | `{ "id": "pi_...", ... }`  |

### Using Variables in HTTP Request Node

In the HTTP Request node body, use Handlebars syntax:

```json
{
  "message": "Payment of {{stripeData.amount}} {{stripeData.currency}} received!",
  "customer": "{{stripeData.customerId}}",
  "event": "{{stripeData.eventType}}",
  "full_data": {{{json stripeData.raw}}}
}
```

---

## Security

### Webhook Signature Verification

In production, the webhook route verifies the `Stripe-Signature` header using your `STRIPE_WEBHOOK_SECRET`. This ensures:

- Only Stripe can trigger your workflows
- Payloads haven't been tampered with
- Replay attacks are prevented

**If `STRIPE_WEBHOOK_SECRET` is not set**, the route runs in development mode and accepts any POST request (with a console warning).

### Best Practices

1. **Always set `STRIPE_WEBHOOK_SECRET` in production**
2. Use Stripe's test mode keys during development
3. Use the Stripe CLI for local testing instead of exposing your local server
4. Monitor your Stripe Dashboard for failed webhook deliveries
5. Keep your Stripe SDK updated

---

## Workflow Examples

### Example 1: Notify on Payment Success

```
[Stripe Trigger] → [HTTP Request: POST to Slack webhook]
                    Body: { "text": "Payment of {{stripeData.amount}} {{stripeData.currency}} received from {{stripeData.customerId}}" }
```

### Example 2: Log All Events

```
[Stripe Trigger] → [HTTP Request: POST to logging API]
                    Body: { "event": "{{stripeData.eventType}}", "data": {{{json stripeData.raw}}} }
```

### Example 3: Handle Subscription Changes

```
[Stripe Trigger (customer.subscription.updated)] → [HTTP Request: PUT to your API]
                                                      Body: { "customerId": "{{stripeData.customerId}}", "status": "{{stripeData.status}}" }
```

---

## Troubleshooting

### Webhook not triggering

1. Check that the webhook URL is correct and includes `?workflowId=YOUR_ID`
2. Verify the Stripe CLI is running and forwarding events
3. Check the terminal/console for error logs
4. Ensure the workflow is saved in the editor

### Signature verification failing

1. Make sure `STRIPE_WEBHOOK_SECRET` matches the secret from your Stripe webhook endpoint
2. For Stripe CLI, use the `whsec_...` value displayed when you run `stripe listen`
3. Restart your dev server after updating `.env`

### Variables not resolving

1. Check variable names are exact (case-sensitive): `stripeData.eventId` not `stripeData.EventId`
2. Use `{{json stripeData}}` to see the full data structure
3. Check Inngest logs for the executor output

### Common Errors

| Error                                          | Cause                              | Solution                                        |
| ---------------------------------------------- | ---------------------------------- | ----------------------------------------------- |
| "Missing required query parameter: workflowId" | URL doesn't have `?workflowId=xxx` | Add the workflowId parameter to the webhook URL |
| "Webhook signature verification failed"        | Wrong webhook secret               | Update `STRIPE_WEBHOOK_SECRET` in `.env`        |
| "Failed to process Stripe webhook"             | Server error                       | Check console logs for details                  |
