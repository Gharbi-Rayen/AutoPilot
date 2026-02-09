# AutoPilot Features Overview

## Node Types

AutoPilot supports the following node types in workflow automation:

### Trigger Nodes

Trigger nodes start your workflow when an event occurs.

| Node                    | Type                  | Description                                | Status      |
| ----------------------- | --------------------- | ------------------------------------------ | ----------- |
| **Manual Trigger**      | `MANUAL_TRIGGER`      | Start workflow manually via Execute button | ✅ Complete |
| **Google Form Trigger** | `GOOGLE_FORM_TRIGGER` | Runs when a Google Form is submitted       | ✅ Complete |
| **Stripe Trigger**      | `STRIPE_TRIGGER`      | Runs when a Stripe event occurs            | ✅ Complete |

### Execution Nodes

Execution nodes perform actions in your workflow.

| Node             | Type           | Description                         | Status      |
| ---------------- | -------------- | ----------------------------------- | ----------- |
| **HTTP Request** | `HTTP_REQUEST` | Make HTTP requests to external APIs | ✅ Complete |

---

## Stripe Trigger Features

### What's Implemented

- [x] **Webhook Endpoint** - Receives Stripe events at `/api/webhooks/stripe`
- [x] **Signature Verification** - Production-ready webhook signature verification
- [x] **Development Mode** - Works without signature secret for local testing
- [x] **Real-time Status** - Node shows loading/success/error states in the editor
- [x] **Event Data Extraction** - Extracts common fields (amount, currency, customerId, etc.)
- [x] **Variable Passing** - Stripe data available as Handlebars variables in downstream nodes
- [x] **UI Configuration Dialog** - Shows webhook URL, setup instructions, available variables
- [x] **Stripe CLI Support** - Works with `stripe listen` for local development
- [x] **GET Endpoint** - Health check endpoint for testing
- [x] **All Event Types** - Supports any Stripe event type
- [x] **Inngest Integration** - Full real-time channel for status broadcasting

### Stripe Variables Available

| Variable                     | Description                                |
| ---------------------------- | ------------------------------------------ |
| `{{stripeData.eventId}}`     | Stripe event ID                            |
| `{{stripeData.eventType}}`   | Event type (e.g. payment_intent.succeeded) |
| `{{stripeData.amount}}`      | Amount in smallest currency unit           |
| `{{stripeData.currency}}`    | Currency code                              |
| `{{stripeData.customerId}}`  | Customer ID                                |
| `{{stripeData.status}}`      | Object status                              |
| `{{stripeData.description}}` | Description                                |
| `{{stripeData.timestamp}}`   | Unix timestamp                             |
| `{{stripeData.livemode}}`    | Live or test mode                          |
| `{{json stripeData.raw}}`    | Full raw data object                       |

---

## Google Form Trigger Features

### What's Implemented

- [x] **Webhook Endpoint** - Receives form submissions at `/api/webhooks/google-form`
- [x] **Real-time Status** - Node shows loading/success/error states
- [x] **Google Apps Script Generator** - Auto-generates the Apps Script for form integration
- [x] **UI Configuration Dialog** - Shows webhook URL and setup instructions
- [x] **Variable Passing** - Form data available as Handlebars variables

### Google Form Variables Available

| Variable                             | Description          |
| ------------------------------------ | -------------------- |
| `{{googleFormData.formId}}`          | Google Form ID       |
| `{{googleFormData.formTitle}}`       | Form title           |
| `{{googleFormData.responseId}}`      | Response ID          |
| `{{googleFormData.timestamp}}`       | Submission timestamp |
| `{{googleFormData.respondentEmail}}` | Respondent email     |
| `{{googleFormData.responses}}`       | All form responses   |
| `{{json googleFormData.raw}}`        | Full raw payload     |

---

## HTTP Request Node Features

### What's Implemented

- [x] **All HTTP Methods** - GET, POST, PUT, PATCH, DELETE
- [x] **Variable Interpolation** - Handlebars templates in URL and body
- [x] **JSON Helper** - `{{json variable}}` for serializing objects
- [x] **Custom Variable Names** - Store response under a custom variable name
- [x] **Error Handling** - Validation for endpoint, method, and variable name
- [x] **Response Parsing** - Auto-detects JSON vs text responses
- [x] **Real-time Status** - Loading/success/error states

---

## Architecture

### Data Flow

```
Trigger Event → Webhook Route → Inngest (sendWorkflowExecution)
                                       ↓
                                 Topological Sort (nodes)
                                       ↓
                                 For each node:
                                   → Get Executor from Registry
                                   → Execute with context
                                   → Publish real-time status
                                   → Pass context to next node
```

### Key Technologies

| Technology     | Purpose                                  |
| -------------- | ---------------------------------------- |
| **Next.js 15** | App Router, API routes                   |
| **React Flow** | Visual workflow editor                   |
| **Prisma**     | Database ORM (PostgreSQL)                |
| **Inngest**    | Workflow execution engine with real-time |
| **tRPC**       | Type-safe API layer                      |
| **Jotai**      | State management                         |
| **Handlebars** | Variable interpolation in node data      |
| **Stripe SDK** | Webhook signature verification           |

### File Structure

```
src/
├── app/api/webhooks/          # Webhook endpoints
│   ├── google-form/route.ts
│   └── stripe/route.ts
├── config/
│   └── node-components.ts     # Node type → React component mapping
├── features/
│   ├── editor/                # Workflow editor
│   ├── executions/            # Execution system
│   │   ├── components/
│   │   │   ├── http-request/  # HTTP Request executor
│   │   │   ├── lib/
│   │   │   │   └── executor-registry.ts
│   │   │   └── types.ts       # NodeExecutor type definitions
│   │   └── hooks/
│   │       └── use-node-status.ts
│   ├── triggers/              # Trigger nodes
│   │   └── components/
│   │       ├── base-trigger-node.tsx
│   │       ├── manual-trigger/
│   │       ├── googleForm-trigger/
│   │       └── stripe-trigger/
│   └── workflows/             # Workflow CRUD
├── inngest/
│   ├── client.ts
│   ├── functions.ts           # Main workflow executor
│   ├── utils.ts               # Topological sort, sendWorkflowExecution
│   └── channels/              # Real-time channels
│       ├── http-request.ts
│       ├── manual-triggers.ts
│       ├── google-form-trigger.ts
│       └── stripe-trigger.ts
└── components/
    └── node-selector.tsx      # Node type picker
```
