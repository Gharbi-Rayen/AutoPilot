# Stripe Integration Testing Guide

## Prerequisites

Before testing, make sure you have:

- [ ] Stripe CLI installed ([Install guide](https://docs.stripe.com/stripe-cli))
- [ ] Stripe test API keys configured in `.env`
- [ ] Your Next.js dev server running (`npm run dev`)
- [ ] Inngest dev server running (`npx inngest-cli@latest dev`)

---

## Quick Start Testing

### Step 1: Start Your Development Environment

Open 3 terminals:

```bash
# Terminal 1: Next.js dev server
npm run dev

# Terminal 2: Inngest dev server
npx inngest-cli@latest dev

# Terminal 3: Stripe CLI listener (set up in Step 3)
```

### Step 2: Create a Workflow with Stripe Trigger

1. Open the app at `http://localhost:3000`
2. Create a new workflow
3. Replace the initial node with a **Stripe Trigger** node
4. (Optional) Add an **HTTP Request** node downstream to test variable passing
5. **Save the workflow**
6. Copy the **workflowId** from the URL: `http://localhost:3000/workflows/WORKFLOW_ID`

### Step 3: Start Stripe CLI Listener

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe?workflowId=YOUR_WORKFLOW_ID
```

The CLI will display a webhook signing secret:

```
> Ready! Your webhook signing secret is whsec_xxxxxxxxxxxxx
```

**Copy this secret** and add it to your `.env`:

```env
STRIPE_WEBHOOK_SECRET="whsec_xxxxxxxxxxxxx"
```

Then restart your dev server.

### Step 4: Trigger Test Events

In a new terminal:

```bash
# Test payment success
stripe trigger payment_intent.succeeded

# Test customer creation
stripe trigger customer.created

# Test invoice paid
stripe trigger invoice.paid

# Test subscription created
stripe trigger customer.subscription.created
```

### Step 5: Verify

1. Check your terminal running the Next.js server for log output:

   ```
   [Stripe Webhook] Received event: { workflowId: '...', eventId: 'evt_...', eventType: 'payment_intent.succeeded' }
   [Stripe Webhook] Inngest event sent: ...
   ```

2. Check the Inngest dev UI at `http://localhost:8288`:
   - You should see a `workflows/execute.workflow` event
   - Click it to see the execution timeline
   - Each node step should show as completed

3. Check the React Flow editor:
   - The Stripe trigger node should show a green status indicator when successful
   - A red indicator means an error occurred

---

## Test Scenarios

### Test 1: Basic Webhook Reception

**Goal**: Verify the webhook endpoint receives and processes Stripe events.

```bash
# 1. Check endpoint is active
curl http://localhost:3000/api/webhooks/stripe

# Expected response:
# { "message": "Stripe webhook endpoint is active", "method": "POST", ... }

# 2. Trigger an event
stripe trigger payment_intent.succeeded

# Expected: 200 response, log output showing event received
```

### Test 2: Missing workflowId

**Goal**: Verify error handling when workflowId is missing.

```bash
curl -X POST http://localhost:3000/api/webhooks/stripe \
  -H "Content-Type: application/json" \
  -d '{"id": "evt_test", "type": "test"}'

# Expected: 400 response
# { "success": false, "error": "Missing required query parameter: workflowId" }
```

### Test 3: Signature Verification (Production Mode)

**Goal**: Verify webhook signature verification works.

```bash
# With valid signature (through Stripe CLI):
stripe trigger payment_intent.succeeded
# Expected: 200 response

# Without valid signature (direct POST):
curl -X POST "http://localhost:3000/api/webhooks/stripe?workflowId=test123" \
  -H "Content-Type: application/json" \
  -d '{"id": "evt_test", "type": "test"}'

# Expected: 400 response (when STRIPE_WEBHOOK_SECRET is set)
# { "success": false, "error": "Webhook signature verification failed" }
```

### Test 4: Variable Passing to HTTP Request Node

**Goal**: Verify Stripe data flows correctly to downstream nodes.

1. Create workflow: `Stripe Trigger → HTTP Request`
2. Configure HTTP Request node:
   - Method: `POST`
   - Endpoint: `https://httpbin.org/post`
   - Variable Name: `apiResponse`
   - Body:
     ```json
     {
       "event_type": "{{stripeData.eventType}}",
       "amount": "{{stripeData.amount}}",
       "customer": "{{stripeData.customerId}}"
     }
     ```
3. Save workflow
4. Trigger: `stripe trigger payment_intent.succeeded`
5. Check Inngest UI for the response from httpbin showing the variables were interpolated

### Test 5: Different Event Types

**Goal**: Verify different Stripe event types are handled correctly.

```bash
# Payment events
stripe trigger payment_intent.succeeded
stripe trigger payment_intent.payment_failed

# Customer events
stripe trigger customer.created
stripe trigger customer.updated

# Subscription events
stripe trigger customer.subscription.created
stripe trigger customer.subscription.updated
stripe trigger customer.subscription.deleted

# Invoice events
stripe trigger invoice.paid
stripe trigger invoice.payment_failed

# Checkout events
stripe trigger checkout.session.completed
```

For each event, verify:

- [ ] Webhook returns 200
- [ ] Inngest event is created
- [ ] Executor runs successfully
- [ ] Node status updates in the editor (green = success)

### Test 6: Real-Time Status Updates

**Goal**: Verify the Stripe node shows real-time status in the editor.

1. Open the workflow editor with a Stripe trigger node
2. In another terminal, trigger an event
3. Watch the node in the editor:
   - Should briefly show **loading** state (blue/yellow indicator)
   - Should then show **success** state (green indicator)
   - On error, should show **error** state (red indicator)

### Test 7: Development Mode (No Signature Verification)

**Goal**: Verify the webhook works without `STRIPE_WEBHOOK_SECRET` for easy development.

1. Remove or comment out `STRIPE_WEBHOOK_SECRET` from `.env`
2. Restart dev server
3. Send a manual POST:

```bash
curl -X POST "http://localhost:3000/api/webhooks/stripe?workflowId=YOUR_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "evt_test_123",
    "type": "payment_intent.succeeded",
    "created": 1675000000,
    "livemode": false,
    "data": {
      "object": {
        "id": "pi_test_123",
        "amount": 2000,
        "currency": "usd",
        "customer": "cus_test_123",
        "status": "succeeded",
        "description": "Test payment"
      }
    }
  }'

# Expected: 200 response + console warning about missing secret
```

---

## Debugging Tips

### View Inngest Execution Logs

1. Open `http://localhost:8288` (Inngest Dev UI)
2. Go to Functions → `execute/workflow`
3. Click on a recent execution to see the full step timeline
4. Each step shows input/output data

### View Stripe CLI Events

When running `stripe listen`, events are logged in real-time:

```
2026-02-09 12:00:00 --> payment_intent.succeeded [evt_xxx]
2026-02-09 12:00:00 <-- [200] POST http://localhost:3000/api/webhooks/stripe?workflowId=xxx
```

### Check Console Logs

The webhook route and executor both log detailed information:

```
[Stripe Webhook] Received event: { workflowId, eventId, eventType, livemode }
[Stripe Webhook] Inngest event sent: { ... }
[StripeExecutor] Processing context: { nodeId, contextKeys }
[StripeExecutor] Available variable paths: ...
```

### Common Issues

| Symptom                              | Check                                                        |
| ------------------------------------ | ------------------------------------------------------------ |
| Stripe CLI says "connection refused" | Is `npm run dev` running?                                    |
| No Inngest event appears             | Is Inngest dev server running? Check `http://localhost:8288` |
| Node stays in "loading" state        | Check Inngest UI for errors in the function execution        |
| Variables show as `undefined`        | Use `{{json stripeData}}` to inspect the full data structure |
| 400 error on webhook                 | Check if `STRIPE_WEBHOOK_SECRET` matches the CLI secret      |

---

## Environment Setup Checklist

```bash
# .env file should contain:
STRIPE_SECRET_KEY="sk_test_..."       # From Stripe Dashboard → API Keys
STRIPE_WEBHOOK_SECRET="whsec_..."     # From Stripe CLI or Dashboard webhook
NEXT_PUBLIC_APP_URL="http://localhost:3000"  # Your app's base URL
```

## File Checklist

Verify all these files exist and are properly configured:

- [ ] `src/app/api/webhooks/stripe/route.ts` - Webhook endpoint
- [ ] `src/features/triggers/components/stripe-trigger/node.tsx` - React Flow node
- [ ] `src/features/triggers/components/stripe-trigger/dialog.tsx` - Config dialog
- [ ] `src/features/triggers/components/stripe-trigger/executor.ts` - Executor
- [ ] `src/features/triggers/components/stripe-trigger/actions.ts` - Server actions
- [ ] `src/inngest/channels/stripe-trigger.ts` - Realtime channel
- [ ] `src/inngest/functions.ts` - Has `StripeTriggerChannel()` in channels array
- [ ] `src/config/node-components.ts` - Has `STRIPE_TRIGGER` mapping
- [ ] `src/features/executions/components/lib/executor-registry.ts` - Has `StripeExecutor`
- [ ] `prisma/schema.prisma` - Has `STRIPE_TRIGGER` in `NodeType` enum
- [ ] `src/features/workflows/server/routers.ts` - Has `STRIPE_TRIGGER` in Zod validation
- [ ] `public/logos/stripe.svg` - Stripe logo asset
