# AutoPilot — Global File Roadmap

> A comprehensive map of every file in the project and what it serves.

---

## Table of Contents

- [Project Overview](#project-overview)
- [Root Config Files](#root-config-files)
- [Prisma (Database)](#prisma-database)
- [Public Assets](#public-assets)
- [Source — App (Routes & Pages)](#source--app-routes--pages)
- [Source — API Routes](#source--api-routes)
- [Source — Components](#source--components)
- [Source — React Flow Components](#source--react-flow-components)
- [Source — UI Components (shadcn/ui)](#source--ui-components-shadcnui)
- [Source — Config](#source--config)
- [Source — Features](#source--features)
  - [Auth](#auth)
  - [Credentials](#credentials)
  - [Editor](#editor)
  - [Executions](#executions)
  - [Subscriptions](#subscriptions)
  - [Triggers](#triggers)
  - [Workflows](#workflows)
- [Source — Inngest (Background Jobs)](#source--inngest-background-jobs)
- [Source — Lib (Core Utilities)](#source--lib-core-utilities)
- [Source — tRPC (API Layer)](#source--trpc-api-layer)
- [Source — Hooks (Shared)](#source--hooks-shared)
- [Source — Types](#source--types)
- [Source — Instrumentation (Sentry)](#source--instrumentation-sentry)
- [Generated Code](#generated-code)
- [Docs](#docs)

---

## Project Overview

**AutoPilot** is a **Next.js 15** workflow automation platform. Users visually build workflows in a drag-and-drop React Flow editor, connecting trigger nodes (manual, Google Form, Stripe webhooks) to action nodes (HTTP requests, AI models, messaging channels, code execution). Workflows are executed server-side through **Inngest** background functions.

**Tech stack:** Next.js 15 (App Router, Turbopack) · React 19 · TypeScript · Prisma (PostgreSQL/Neon) · tRPC · Inngest · better-auth · Jotai · React Flow · shadcn/ui · Tailwind CSS 4 · Biome · Sentry · Polar (subscriptions).

---

## Root Config Files

| File                       | Purpose                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`             | Project metadata, npm scripts (`dev`, `build`, `start`, `lint`, `format`, `inngest:dev`, `dev:all`), and all dependencies.      |
| `next.config.ts`           | Next.js configuration — redirects `/` → `/workflows`, Sentry plugin (source maps, tunnel route `/monitoring`, Vercel monitors). |
| `tsconfig.json`            | TypeScript compiler options and path aliases (`@/` → `./src/`).                                                                 |
| `biome.json`               | Biome linter/formatter config — 2-space indentation, recommended rules, Next.js & React domains, import organizer.              |
| `postcss.config.mjs`       | PostCSS config — enables `@tailwindcss/postcss` plugin for Tailwind CSS 4.                                                      |
| `components.json`          | shadcn/ui config — New York style, RSC support, Lucide icons, path aliases for `@/components`, `@/lib`, `@/hooks`.              |
| `mprocs.yaml`              | Multi-process runner — starts `next dev` and `inngest dev` in parallel via `npm run dev:all`.                                   |
| `next-env.d.ts`            | Auto-generated Next.js TypeScript reference file.                                                                               |
| `sentry.server.config.ts`  | Sentry server-side init — DSN, tracing, Vercel AI SDK integration, PII sending.                                                 |
| `sentry.edge.config.ts`    | Sentry edge runtime init — DSN, tracing, logging for middleware/edge routes.                                                    |
| `.env`                     | Environment variables (database URL, API keys, secrets) — **not committed**.                                                    |
| `.env.sentry-build-plugin` | Sentry auth token for build-time source map uploads.                                                                            |
| `.gitignore`               | Files/folders excluded from git.                                                                                                |
| `README.md`                | Project readme.                                                                                                                 |

---

## Prisma (Database)

| File                                                                         | Purpose                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prisma/schema.prisma`                                                       | **Database schema** — defines all models: `User`, `Session`, `Account`, `Verification`, `Credentials`, `Workflow`, `Node`, `Connection`, `Execution`. Enums: `NodeType`, `CredentialType`, `ExecutionStatus`. Uses PostgreSQL via Neon adapter. |
| `prisma/migrations/migration_lock.toml`                                      | Locks the migration provider to `postgresql`.                                                                                                                                                                                                   |
| `prisma/migrations/20260115104301_new_auth/migration.sql`                    | Initial auth tables (`user`, `session`, `account`, `verification`).                                                                                                                                                                             |
| `prisma/migrations/20260119084702_workflows_table/migration.sql`             | Creates `Workflow` table.                                                                                                                                                                                                                       |
| `prisma/migrations/20260121213650_workflows_update/migration.sql`            | Updates to Workflow schema.                                                                                                                                                                                                                     |
| `prisma/migrations/20260125070816_react_flow_tables/migration.sql`           | Adds `Node` and `Connection` tables for the React Flow editor.                                                                                                                                                                                  |
| `prisma/migrations/20260126135231_adding_nodes/migration.sql`                | Extends node types and node model fields.                                                                                                                                                                                                       |
| `prisma/migrations/20260206042224_google_form_trigger_node/migration.sql`    | Adds `GOOGLE_FORM_TRIGGER` node type.                                                                                                                                                                                                           |
| `prisma/migrations/20260209024751_stripe_trigger_node/migration.sql`         | Adds `STRIPE_TRIGGER` node type.                                                                                                                                                                                                                |
| `prisma/migrations/20260218092235_ai_nodes_schema/migration.sql`             | Adds AI node types (`OPENAI`, `ANTHROPIC`, `GEMINI`).                                                                                                                                                                                           |
| `prisma/migrations/20260223163508_credentials_schema/migration.sql`          | Creates `Credentials` table and `CredentialType` enum.                                                                                                                                                                                          |
| `prisma/migrations/20260304074144_messaging_nodes/migration.sql`             | Adds messaging node types (`DISCORD`, `SLACK`, `TELEGRAM`).                                                                                                                                                                                     |
| `prisma/migrations/20260305111806_messaging_email_credentials/migration.sql` | Adds `EMAIL_SMTP` credential type and email node.                                                                                                                                                                                               |
| `prisma/migrations/20260309120000_whatsapp_node/migration.sql`               | Adds `WHATSAPP` node type and credential.                                                                                                                                                                                                       |
| `prisma/migrations/20260309130000_code_node/migration.sql`                   | Adds `CODE` node type.                                                                                                                                                                                                                          |
| `prisma/migrations/20260311115915_whatsapp_node/migration.sql`               | WhatsApp node refinements.                                                                                                                                                                                                                      |

---

## Public Assets

| File                          | Purpose                            |
| ----------------------------- | ---------------------------------- |
| `public/logos/auto.png`       | AutoPilot app logo.                |
| `public/logos/logo.svg`       | AutoPilot SVG logo.                |
| `public/logos/anthropic.svg`  | Anthropic brand icon (AI node).    |
| `public/logos/code.svg`       | Code node icon.                    |
| `public/logos/discord.svg`    | Discord brand icon.                |
| `public/logos/gemini.svg`     | Google Gemini brand icon.          |
| `public/logos/github.svg`     | GitHub brand icon (social login).  |
| `public/logos/gmail.svg`      | Gmail brand icon (email node).     |
| `public/logos/google.svg`     | Google brand icon (social login).  |
| `public/logos/googleform.svg` | Google Forms brand icon (trigger). |
| `public/logos/openai.svg`     | OpenAI brand icon (AI node).       |
| `public/logos/slack.svg`      | Slack brand icon.                  |
| `public/logos/stripe.svg`     | Stripe brand icon (trigger).       |
| `public/logos/telegram.svg`   | Telegram brand icon.               |
| `public/logos/whatsapp.svg`   | WhatsApp brand icon.               |
| `public/file.svg`             | Generic file icon.                 |
| `public/globe.svg`            | Globe icon.                        |
| `public/next.svg`             | Next.js logo.                      |
| `public/vercel.svg`           | Vercel logo.                       |
| `public/window.svg`           | Window icon.                       |

---

## Source — App (Routes & Pages)

| File                                                             | Purpose                                                                                                                                                                   |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/layout.tsx`                                             | **Root layout** — wraps the entire app with `ThemeProvider`, `TRPCReactProvider`, `NuqsAdapter` (URL state), Jotai `Provider`, and `Toaster` (sonner). Loads Geist fonts. |
| `src/app/globals.css`                                            | Global CSS — Tailwind CSS 4 imports, CSS custom properties for theming (light/dark), base resets.                                                                         |
| `src/app/favicon.ico`                                            | Browser tab favicon.                                                                                                                                                      |
| `src/app/global-error.tsx`                                       | Global error boundary — catches unhandled errors, reports to Sentry.                                                                                                      |
| `src/app/(auth)/layout.tsx`                                      | **Auth layout** — wraps login/signup pages with `AuthLayout` component.                                                                                                   |
| `src/app/(auth)/login/page.tsx`                                  | **Login page** — renders the login form.                                                                                                                                  |
| `src/app/(auth)/signup/page.tsx`                                 | **Sign-up page** — renders the registration form.                                                                                                                         |
| `src/app/(dashboard)/layout.tsx`                                 | **Dashboard layout** — wraps all dashboard pages with `SidebarProvider` and `AppSidebar`.                                                                                 |
| `src/app/(dashboard)/(rest)/layout.tsx`                          | **Rest layout** — adds `AppHeader` and `<main>` wrapper for non-editor dashboard pages.                                                                                   |
| `src/app/(dashboard)/(rest)/workflows/page.tsx`                  | **Workflows list page** — shows all user workflows with search/pagination.                                                                                                |
| `src/app/(dashboard)/(rest)/credentials/page.tsx`                | **Credentials list page** — shows all stored credentials.                                                                                                                 |
| `src/app/(dashboard)/(rest)/credentials/new/page.tsx`            | **New credential page** — form to create a new credential.                                                                                                                |
| `src/app/(dashboard)/(rest)/credentials/[credentialId]/page.tsx` | **Credential detail page** — view/edit a single credential.                                                                                                               |
| `src/app/(dashboard)/(rest)/executions/page.tsx`                 | **Executions list page** — shows workflow execution history.                                                                                                              |
| `src/app/(dashboard)/(rest)/executions/[executionId]/page.tsx`   | **Execution detail page** — shows a single execution's output/errors.                                                                                                     |
| `src/app/(dashboard)/(editor)/workflows/[workflowId]/page.tsx`   | **Workflow editor page** — full-screen React Flow visual editor for a specific workflow.                                                                                  |
| `src/app/sentry-example-page/page.tsx`                           | Sentry test page — manually triggers an error for Sentry verification.                                                                                                    |

---

## Source — API Routes

| File                                        | Purpose                                                                                                                                              |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/api/auth/[...all]/route.ts`        | **Auth API catch-all** — delegates all `/api/auth/*` requests to better-auth via `toNextJsHandler`. Handles login, signup, session, OAuth callbacks. |
| `src/app/api/trpc/[trpc]/route.ts`          | **tRPC API handler** — routes all `/api/trpc/*` requests to the tRPC app router using the fetch adapter.                                             |
| `src/app/api/inngest/route.ts`              | **Inngest serve endpoint** — registers the `executeWorkflow` function with Inngest. Exposes `GET`, `POST`, `PUT` for the Inngest SDK.                |
| `src/app/api/webhooks/google-form/route.ts` | **Google Form webhook** — receives form submissions via POST with `?workflowId=`, parses form data, and triggers an Inngest workflow execution.      |
| `src/app/api/webhooks/stripe/route.ts`      | **Stripe webhook** — receives Stripe events via POST with `?workflowId=`, verifies signature, and triggers an Inngest workflow execution.            |
| `src/app/api/sentry-example-api/route.ts`   | Sentry test API — throws an error for Sentry verification.                                                                                           |

---

## Source — Components

| File                                   | Purpose                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/components/app-header.tsx`        | **App header** — top bar with breadcrumbs, sidebar trigger, and navigation.                      |
| `src/components/app-sidebar.tsx`       | **App sidebar** — navigation sidebar with links to Workflows, Executions, Credentials.           |
| `src/components/entity-components.tsx` | **Shared entity UI** — reusable `LoadingView`, `ErrorView`, empty states used across list pages. |
| `src/components/initial-node.tsx`      | **Initial node** — the default starting placeholder node on the React Flow canvas.               |
| `src/components/node-selector.tsx`     | **Node selector** — dialog/popover to pick which node type to add to the workflow.               |
| `src/components/workflow-node.tsx`     | **Workflow node** — base visual card for workflow nodes in the React Flow editor.                |
| `src/components/theme-provider.tsx`    | **Theme provider** — wraps the app with `next-themes` for dark/light mode support.               |
| `src/components/theme-toggle.tsx`      | **Theme toggle** — button to switch between dark/light/system themes.                            |
| `src/components/upgrade-modal.tsx`     | **Upgrade modal** — prompts users to upgrade to a paid plan when hitting limits.                 |

---

## Source — React Flow Components

| File                                                  | Purpose                                                                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `src/components/react-flow/base-handle.tsx`           | **Base handle** — reusable connection handle component for React Flow nodes (input/output ports).                   |
| `src/components/react-flow/base-node.tsx`             | **Base node** — shared node wrapper with consistent styling, icon, title, and handles.                              |
| `src/components/react-flow/node-status-indicator.tsx` | **Node status indicator** — shows execution status (running/success/failed) on each node during workflow execution. |
| `src/components/react-flow/placeholder-node.tsx`      | **Placeholder node** — a "+" button node shown at the end of the chain to add next nodes.                           |

---

## Source — UI Components (shadcn/ui)

All files in `src/components/ui/` are **shadcn/ui primitives** built on Radix UI. Each is a self-contained, styled UI component:

| File                  | Component                      |
| --------------------- | ------------------------------ |
| `accordion.tsx`       | Collapsible accordion sections |
| `alert.tsx`           | Alert banners                  |
| `alert-dialog.tsx`    | Confirmation dialog            |
| `aspect-ratio.tsx`    | Aspect ratio container         |
| `avatar.tsx`          | User avatar                    |
| `badge.tsx`           | Status/label badges            |
| `breadcrumb.tsx`      | Navigation breadcrumbs         |
| `button.tsx`          | Button with variants           |
| `button-group.tsx`    | Grouped buttons                |
| `calendar.tsx`        | Date picker calendar           |
| `card.tsx`            | Content card container         |
| `carousel.tsx`        | Image/content carousel         |
| `chart.tsx`           | Chart wrapper                  |
| `checkbox.tsx`        | Checkbox input                 |
| `collapsible.tsx`     | Collapsible panel              |
| `command.tsx`         | Command palette (cmdk)         |
| `context-menu.tsx`    | Right-click context menu       |
| `dialog.tsx`          | Modal dialog                   |
| `drawer.tsx`          | Slide-out drawer               |
| `dropdown-menu.tsx`   | Dropdown menu                  |
| `empty.tsx`           | Empty state placeholder        |
| `field.tsx`           | Form field wrapper             |
| `form.tsx`            | React Hook Form integration    |
| `hover-card.tsx`      | Hover card popover             |
| `input.tsx`           | Text input                     |
| `input-group.tsx`     | Grouped inputs                 |
| `input-otp.tsx`       | OTP code input                 |
| `item.tsx`            | Generic list item              |
| `kbd.tsx`             | Keyboard shortcut display      |
| `label.tsx`           | Form label                     |
| `menubar.tsx`         | Menu bar                       |
| `navigation-menu.tsx` | Navigation menu                |
| `pagination.tsx`      | Pagination controls            |
| `popover.tsx`         | Popover                        |
| `progress.tsx`        | Progress bar                   |
| `radio-group.tsx`     | Radio button group             |
| `resizable.tsx`       | Resizable panels               |
| `scroll-area.tsx`     | Custom scrollbar area          |
| `select.tsx`          | Select dropdown                |
| `separator.tsx`       | Visual separator line          |
| `sheet.tsx`           | Side sheet/panel               |
| `sidebar.tsx`         | Sidebar layout primitives      |
| `skeleton.tsx`        | Loading skeleton               |
| `slider.tsx`          | Range slider                   |
| `sonner.tsx`          | Toast notifications (sonner)   |
| `spinner.tsx`         | Loading spinner                |
| `switch.tsx`          | Toggle switch                  |
| `table.tsx`           | Data table                     |
| `tabs.tsx`            | Tab navigation                 |
| `textarea.tsx`        | Multi-line text input          |
| `toggle.tsx`          | Toggle button                  |
| `toggle-group.tsx`    | Grouped toggle buttons         |
| `tooltip.tsx`         | Hover tooltip                  |

---

## Source — Config

| File                            | Purpose                                                                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/config/constants.ts`       | **App constants** — pagination defaults (`DEFAULT_PAGE`, `DEFAULT_PAGE_SIZE`, `MAX_PAGE_SIZE`).                                                               |
| `src/config/node-components.ts` | **Node component registry** — maps every `NodeType` enum value to its React Flow component. Used by the editor to render the correct component for each node. |

---

## Source — Features

Each feature follows a consistent structure: `components/` (UI), `hooks/` (React hooks), `server/` (tRPC routers, prefetch, params), `params.ts` (URL search params schema).

### Auth

| File                                             | Purpose                                                                                               |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `src/features/auth/components/auth-layout.tsx`   | Auth page layout — centered card with branding for login/signup.                                      |
| `src/features/auth/components/login-form.tsx`    | Login form — email/password fields, social login buttons (GitHub, Google), calls `authClient.signIn`. |
| `src/features/auth/components/register-form.tsx` | Registration form — name, email, password fields, calls `authClient.signUp`.                          |

### Credentials

| File                                                        | Purpose                                                                                |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `src/features/credentials/components/credentials.tsx`       | Credentials list component — table of all credentials with search/pagination.          |
| `src/features/credentials/components/credential.tsx`        | Single credential detail/edit component.                                               |
| `src/features/credentials/components/credential-picker.tsx` | Credential picker — dropdown to select an existing credential for a node.              |
| `src/features/credentials/hooks/use-credentials.ts`         | React hook — fetches credentials via tRPC with search/pagination.                      |
| `src/features/credentials/hooks/use-credentials-params.ts`  | React hook — manages URL search params for credentials list (search, page).            |
| `src/features/credentials/params.ts`                        | URL search params schema (nuqs) for credentials pages.                                 |
| `src/features/credentials/server/routers.ts`                | **tRPC router** — CRUD operations for credentials (create, list, get, update, delete). |
| `src/features/credentials/server/params-loader.ts`          | Server-side search params loader for credentials page.                                 |
| `src/features/credentials/server/prefetch.ts`               | Server-side tRPC prefetch for credentials (SSR hydration).                             |

### Editor

| File                                                         | Purpose                                                                                                                                                   |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/editor/components/editor.tsx`                  | **Workflow editor** — the main React Flow canvas. Loads workflow nodes/edges, handles drag-drop, connections, node changes. Syncs changes to the backend. |
| `src/features/editor/components/editor-header.tsx`           | Editor header — workflow name, back button, save status.                                                                                                  |
| `src/features/editor/components/add-node-button.tsx`         | "Add node" button — opens the node selector to insert a new node into the workflow.                                                                       |
| `src/features/editor/components/execute-workflow-button.tsx` | "Execute" button — triggers workflow execution via Inngest and shows real-time status.                                                                    |
| `src/features/editor/store/atoms.ts`                         | **Jotai atoms** — stores the `ReactFlowInstance` reference for cross-component access.                                                                    |

### Executions

Each node type has 4 files following a consistent pattern:

| Pattern              | Purpose                                                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `{node}/node.tsx`    | **React Flow node component** — visual card rendered on the canvas.                                                     |
| `{node}/dialog.tsx`  | **Config dialog** — modal to configure the node's parameters (prompt, URL, credentials, etc.).                          |
| `{node}/actions.ts`  | **Server actions** — tRPC mutations to save/update node configuration.                                                  |
| `{node}/executor.ts` | **Node executor** — the server-side logic that runs when the node executes (API calls, AI generation, message sending). |

**Execution node types:**

| Folder                                             | Description                                                                   |
| -------------------------------------------------- | ----------------------------------------------------------------------------- |
| `src/features/executions/components/anthropic/`    | **Anthropic AI** node — sends prompts to Claude via the AI SDK.               |
| `src/features/executions/components/gemini/`       | **Google Gemini AI** node — sends prompts to Gemini via the AI SDK.           |
| `src/features/executions/components/openai/`       | **OpenAI** node — sends prompts to GPT models via the AI SDK.                 |
| `src/features/executions/components/http-request/` | **HTTP Request** node — makes configurable HTTP requests (GET, POST, etc.).   |
| `src/features/executions/components/discord/`      | **Discord** node — sends messages to Discord channels via webhooks.           |
| `src/features/executions/components/slack/`        | **Slack** node — sends messages to Slack channels via webhooks.               |
| `src/features/executions/components/telegram/`     | **Telegram** node — sends messages to Telegram chats via Bot API.             |
| `src/features/executions/components/email/`        | **Email (SMTP)** node — sends emails via SMTP using Nodemailer.               |
| `src/features/executions/components/whatsapp/`     | **WhatsApp** node — sends messages via WhatsApp Business API.                 |
| `src/features/executions/components/code/`         | **Code** node — executes user-written JavaScript code in a sandboxed context. |

**Shared execution files:**

| File                                                          | Purpose                                                                                                                                      |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/executions/components/base-execution-node.tsx`  | **Base execution node** — shared wrapper component for all execution nodes with consistent layout/handles.                                   |
| `src/features/executions/components/types.ts`                 | **Execution types** — `NodeExecutor`, `NodeExecutorParams`, `workflowContext`, `StepTools` type definitions.                                 |
| `src/features/executions/components/lib/executor-registry.ts` | **Executor registry** — maps every `NodeType` to its server-side executor function. Used by Inngest to route execution to the right handler. |
| `src/features/executions/components/executions.tsx`           | **Executions list** component — table of past workflow executions with status, timing, errors.                                               |
| `src/features/executions/components/execution-detail.tsx`     | **Execution detail** component — detailed view of a single execution's output and error stack.                                               |
| `src/features/executions/hooks/use-executions.ts`             | React hook — fetches executions via tRPC.                                                                                                    |
| `src/features/executions/hooks/use-executions-params.ts`      | React hook — manages URL search params for executions list.                                                                                  |
| `src/features/executions/hooks/use-ai-models.ts`              | React hook — fetches available AI models for the model selector in AI node dialogs.                                                          |
| `src/features/executions/hooks/use-node-status.ts`            | React hook — subscribes to real-time node execution status from Inngest.                                                                     |
| `src/features/executions/params.ts`                           | URL search params schema for executions pages.                                                                                               |
| `src/features/executions/server/executions-router.ts`         | **tRPC router** — CRUD and query operations for executions.                                                                                  |
| `src/features/executions/server/ai-models-router.ts`          | **tRPC router** — returns available AI models for each provider.                                                                             |
| `src/features/executions/server/params-loader.ts`             | Server-side search params loader for executions page.                                                                                        |
| `src/features/executions/server/prefetch.ts`                  | Server-side tRPC prefetch for executions.                                                                                                    |

### Subscriptions

| File                                                   | Purpose                                                                                       |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `src/features/subscriptions/hooks/use-subscription.ts` | React hook — queries the user's Polar subscription state and checks for active subscriptions. |

### Triggers

Trigger nodes follow the same 4-file pattern as execution nodes (`node.tsx`, `dialog.tsx`, `actions.ts`, `executor.ts`), plus optional `utils.ts`.

| Folder                                                 | Description                                                                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `src/features/triggers/components/manual-trigger/`     | **Manual Trigger** — starts a workflow execution on-demand when the user clicks "Execute".                                           |
| `src/features/triggers/components/googleForm-trigger/` | **Google Form Trigger** — starts a workflow when a Google Form submission webhook is received. Has `utils.ts` for form data parsing. |
| `src/features/triggers/components/stripe-trigger/`     | **Stripe Trigger** — starts a workflow when a Stripe event webhook is received.                                                      |

**Shared trigger files:**

| File                                                     | Purpose                                                                                                  |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/features/triggers/components/base-trigger-node.tsx` | **Base trigger node** — shared wrapper for trigger node components with consistent trigger-style layout. |

### Workflows

| File                                                   | Purpose                                                                                                    |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `src/features/workflows/components/workflows.tsx`      | **Workflows list** component — displays all user workflows as cards with create/delete actions.            |
| `src/features/workflows/hooks/use-workflows.ts`        | React hook — fetches workflows (list and single) via tRPC, including `useSuspenseWorkflow` for the editor. |
| `src/features/workflows/hooks/use-workflows-params.ts` | React hook — manages URL search params for workflows list.                                                 |
| `src/features/workflows/params.ts`                     | URL search params schema for workflows pages.                                                              |
| `src/features/workflows/server/routers.ts`             | **tRPC router** — CRUD for workflows (create, list, get with nodes/edges, update, delete).                 |
| `src/features/workflows/server/params-loader.ts`       | Server-side search params loader for workflows page.                                                       |
| `src/features/workflows/server/prefetch.ts`            | Server-side tRPC prefetch for workflows.                                                                   |

---

## Source — Inngest (Background Jobs)

| File                       | Purpose                                                                                                                                                                                                                                                              |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/inngest/client.ts`    | **Inngest client** — initializes the Inngest SDK with app ID `"autopilot"` and realtime middleware for live status updates.                                                                                                                                          |
| `src/inngest/functions.ts` | **Workflow execution function** — the main Inngest function that orchestrates workflow execution. Fetches the workflow, performs topological sort on nodes, and executes each node sequentially using the executor registry. Publishes real-time status to channels. |
| `src/inngest/utils.ts`     | **Inngest utilities** — `topologicalSort` (orders nodes by their connections using toposort) and `sendWorkflowExecution` (dispatches workflow execution events).                                                                                                     |

**Channel handlers** — each channel is passed to the Inngest function and publishes real-time status updates per node type:

| File                                          | Purpose                                                                          |
| --------------------------------------------- | -------------------------------------------------------------------------------- |
| `src/inngest/channels/anthropic.ts`           | Anthropic AI execution channel — publishes node status during Claude API calls.  |
| `src/inngest/channels/code.ts`                | Code execution channel — publishes status during user code execution.            |
| `src/inngest/channels/discord.ts`             | Discord messaging channel — publishes status during Discord webhook sends.       |
| `src/inngest/channels/email.ts`               | Email channel — publishes status during SMTP email sends.                        |
| `src/inngest/channels/gemini.ts`              | Gemini AI execution channel — publishes status during Gemini API calls.          |
| `src/inngest/channels/google-form-trigger.ts` | Google Form trigger channel — publishes status when processing form submissions. |
| `src/inngest/channels/http-request.ts`        | HTTP request channel — publishes status during outgoing HTTP requests.           |
| `src/inngest/channels/manual-triggers.ts`     | Manual trigger channel — publishes status for manual workflow starts.            |
| `src/inngest/channels/openai.ts`              | OpenAI execution channel — publishes status during GPT API calls.                |
| `src/inngest/channels/slack.ts`               | Slack messaging channel — publishes status during Slack webhook sends.           |
| `src/inngest/channels/stripe-trigger.ts`      | Stripe trigger channel — publishes status when processing Stripe webhook events. |
| `src/inngest/channels/telegram.ts`            | Telegram messaging channel — publishes status during Telegram Bot API sends.     |
| `src/inngest/channels/whatsapp.ts`            | WhatsApp messaging channel — publishes status during WhatsApp API sends.         |

---

## Source — Lib (Core Utilities)

| File                     | Purpose                                                                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/auth.ts`        | **Auth configuration** — configures better-auth with Prisma adapter, email/password auth, GitHub & Google OAuth providers, trusted origins. Polar subscription plugin (currently disabled). |
| `src/lib/auth-client.ts` | **Auth client** — creates the better-auth React client for client-side auth operations (sign in, sign up, session).                                                                         |
| `src/lib/auth-utils.ts`  | **Auth utilities** — `requireAuth()` (redirects to `/login` if unauthenticated) and `requireUnAuth()` (redirects to `/` if already authenticated). Used in server components/layouts.       |
| `src/lib/db.ts`          | **Database client** — creates a singleton Prisma client using the Neon serverless adapter with WebSocket support. Cached globally in development to avoid hot-reload connection leaks.      |
| `src/lib/polar.ts`       | **Polar client** — initializes the Polar SDK for subscription/payment management. Switches between sandbox and production based on `NODE_ENV`.                                              |
| `src/lib/utils.ts`       | **CSS utility** — `cn()` function combining `clsx` and `tailwind-merge` for conditional class name merging.                                                                                 |

---

## Source — tRPC (API Layer)

| File                       | Purpose                                                                                                                                                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/trpc/init.ts`         | **tRPC initialization** — creates the tRPC instance with superjson transformer. Defines `baseProcedure`, `protectedProcedure` (requires auth session), and `premiumProcedure` (subscription check, currently same as protected). |
| `src/trpc/routers/_app.ts` | **Root tRPC router** — merges all feature routers: `workflows`, `aiModels`, `credentials`, `executions`. Exports `AppRouter` type for client inference.                                                                          |
| `src/trpc/client.tsx`      | **tRPC React client** — sets up tRPC with TanStack Query on the client side. Creates `TRPCProvider`, `useTRPC` hook, `QueryClientProvider`. Configures `httpBatchLink` pointing to `/api/trpc`.                                  |
| `src/trpc/server.tsx`      | **tRPC server caller** — creates server-side tRPC options proxy and `caller` for server components. Includes `prefetch()` helper for SSR query hydration.                                                                        |
| `src/trpc/query-client.ts` | **Query client factory** — `makeQueryClient()` with 30s stale time, superjson serialization for dehydration/hydration.                                                                                                           |

---

## Source — Hooks (Shared)

| File                              | Purpose                                                                                                                           |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `src/hooks/use-entity-search.tsx` | **Entity search hook** — generic debounced search with URL param sync. Used across workflows, credentials, executions list pages. |
| `src/hooks/use-mobile.ts`         | **Mobile detection hook** — `useIsMobile()` checks viewport width against 768px breakpoint.                                       |
| `src/hooks/use-upgrade-modal.tsx` | **Upgrade modal hook** — catches `FORBIDDEN` tRPC errors and shows the upgrade modal automatically.                               |

---

## Source — Types

| File                 | Purpose                                        |
| -------------------- | ---------------------------------------------- |
| `src/types/css.d.ts` | TypeScript declaration for CSS module imports. |

---

## Source — Instrumentation (Sentry)

| File                            | Purpose                                                                                                                                                                                                         |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/instrumentation.ts`        | **Server instrumentation** — Next.js instrumentation hook. Loads `sentry.server.config.ts` for Node.js runtime or `sentry.edge.config.ts` for edge runtime. Exports `onRequestError` for request error capture. |
| `src/instrumentation-client.ts` | **Client instrumentation** — Initializes Sentry on the browser. Configures DSN, replay integration, trace sampling, and session replay.                                                                         |

---

## Generated Code

| File                    | Purpose                                                                                                                                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/generated/prisma/` | **Auto-generated Prisma Client** — generated by `prisma generate`. Contains the type-safe database client (`client.js/d.ts`), query engine binary, WASM engine, runtime modules, and the copied schema. **Do not edit manually.** |

---

## Docs

| File                                           | Purpose                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------ |
| `docs/GLOBAL_ROADMAP.md`                       | This file — complete map of every file in the project.                         |
| `docs/ARCHITECTURE_CRITIQUE.md`                | Architecture strengths, risks, and recommended improvements.                   |
| `docs/FEATURES_OVERVIEW.md`                    | High-level overview of all application features.                               |
| `docs/MESSAGING_NODES_TESTING_GUIDE.md`        | Testing guide for messaging nodes (Discord, Slack, Telegram, Email, WhatsApp). |
| `docs/TESTING_INSTRUCTIONS.md`                 | General testing instructions and setup guide.                                  |
| `docs/VARIABLE_GUIDE.md`                       | Guide for using variables and Handlebars templates in workflow nodes.          |
| `docs/WORKFLOW_EXECUTION_PANEL.md`             | Workflow progress panel behavior and execution inspector documentation.        |
| `docs/WORKFLOW_EXECUTION_PERFORMANCE_GUIDE.md` | Workflow execution performance guidance and optimization notes.                |

---

## Architecture Diagram (Simplified)

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (React 19)                                             │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │ Auth Pages   │  │ Dashboard    │  │ Workflow Editor        │  │
│  │ (better-auth)│  │ (lists/CRUD) │  │ (React Flow canvas)   │  │
│  └──────┬───────┘  └──────┬───────┘  └───────────┬───────────┘  │
│         │                 │                      │              │
│         └────────┬────────┘──────────────────────┘              │
│                  │  tRPC (TanStack Query)                       │
├──────────────────┼──────────────────────────────────────────────┤
│  Next.js Server  │                                              │
│  ┌───────────────┴──────────────────────┐                       │
│  │ API Routes                           │                       │
│  │ /api/auth/*     → better-auth        │                       │
│  │ /api/trpc/*     → tRPC routers       │                       │
│  │ /api/inngest    → Inngest serve      │                       │
│  │ /api/webhooks/* → Webhook handlers   │                       │
│  └───────────────┬──────────────────────┘                       │
│                  │                                              │
│  ┌───────────────┴──────┐  ┌────────────────────────────────┐   │
│  │ Prisma (Neon PG)     │  │ Inngest (Background Execution) │   │
│  │ Users, Workflows,    │  │ topologicalSort → executor per  │   │
│  │ Nodes, Connections,  │  │ node → real-time status publish │   │
│  │ Credentials,         │  └────────────────────────────────┘   │
│  │ Executions           │                                       │
│  └──────────────────────┘                                       │
└─────────────────────────────────────────────────────────────────┘
```
