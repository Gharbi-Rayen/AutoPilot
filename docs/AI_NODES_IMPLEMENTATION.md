# AI Nodes Implementation Guide

## Overview

This document covers the full implementation of the **Gemini**, **OpenAI**, and **Anthropic** AI execution nodes in AutoPilot. These nodes allow users to integrate AI text generation directly into their automation workflows using a visual drag-and-drop editor powered by React Flow.

---

## What Was Implemented

### 1. Gemini Node — Bug Fixes & Redesign

**Problem:** The original Gemini executor had multiple critical bugs that prevented it from working:

- **Syntax error in prompt compilation** — A missing ternary else branch (`?` without `:`) caused a hard crash when compiling the user prompt with Handlebars.
- **Wrong response access pattern** — The code tried to access `steps[0].content[0].text` on the `generateText` return value, but the Vercel AI SDK's `generateText` returns `{ text }` directly at the top level.
- **Copy-paste channel error** — The `actions.ts` file referenced `HttpRequestChannel` instead of `GeminiChannel`, so realtime status updates never worked.
- **Broken dialog form** — The configuration dialog had two separate `<Form>` elements, meaning the submit button in the second form was completely disconnected from the fields in the first form.

**Fixes applied:**

| File          | Fix                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `executor.ts` | Fixed ternary syntax, corrected response destructuring to `{ text }`, added prompt validation, updated default model to `gemini-2.0-flash` |
| `actions.ts`  | Replaced `HttpRequestChannel` with `GeminiChannel`                                                                                         |
| `node.tsx`    | Updated to use correct action function name, fixed type casting for form defaults                                                          |
| `dialog.tsx`  | Complete rewrite — single unified form, grid layout, model dropdown with badges, response reference box                                    |

### 2. OpenAI Node — Full Implementation

Created a complete OpenAI node following the exact same architecture as Gemini:

| File                                                    | Purpose                                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------------------ |
| `src/inngest/channels/openai.ts`                        | Realtime pub/sub channel for execution status (loading/error/success)    |
| `src/features/executions/components/openai/actions.ts`  | Server action to generate realtime subscription tokens                   |
| `src/features/executions/components/openai/executor.ts` | Server-side executor using `@ai-sdk/openai` with `createOpenAI` provider |
| `src/features/executions/components/openai/dialog.tsx`  | Configuration dialog with GPT model selection                            |
| `src/features/executions/components/openai/node.tsx`    | React Flow node component with status indicator                          |

**Available models:** GPT-4o, GPT-4o Mini, GPT-4 Turbo, GPT-3.5 Turbo, O3 Mini

**Environment variable:** `OPENAI_API_KEY`

### 3. Anthropic Node — Full Implementation

Created a complete Anthropic (Claude) node following the identical architecture:

| File                                                       | Purpose                                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `src/inngest/channels/anthropic.ts`                        | Realtime pub/sub channel for execution status                                  |
| `src/features/executions/components/anthropic/actions.ts`  | Server action for realtime tokens                                              |
| `src/features/executions/components/anthropic/executor.ts` | Server-side executor using `@ai-sdk/anthropic` with `createAnthropic` provider |
| `src/features/executions/components/anthropic/dialog.tsx`  | Configuration dialog with Claude model selection                               |
| `src/features/executions/components/anthropic/node.tsx`    | React Flow node component                                                      |

**Available models:** Claude Sonnet 4, Claude Haiku 4, Claude 3.5 Sonnet, Claude 3.5 Haiku, Claude 3 Opus

**Environment variable:** `ANTHROPIC_API_KEY`

### 4. Registration & Integration

All three nodes were registered across the application:

| File                                                          | Change                                                                                              |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/features/executions/components/lib/executor-registry.ts` | Added `GEMINI`, `OPENAI`, `ANTHROPIC` executor mappings                                             |
| `src/config/node-components.ts`                               | Added `OpenAINode` and `AnthropicNode` component mappings                                           |
| `src/components/node-selector.tsx`                            | Added OpenAI and Anthropic to the "Execution Nodes" section in the drag-and-drop selector           |
| `src/inngest/functions.ts`                                    | Added `OpenAIChannel()` and `AnthropicChannel()` to the Inngest workflow runner's realtime channels |

### 5. Brand-Themed Dialog UI/UX

Each AI node dialog has a unique visual identity:

| Node          | Theme        | Header Gradient                                       | Accent Color | Logo Icon              |
| ------------- | ------------ | ----------------------------------------------------- | ------------ | ---------------------- |
| **Gemini**    | Blue/Purple  | `from-blue-500/10 via-purple-500/10 to-pink-500/10`   | Blue         | `/logos/gemini.svg`    |
| **OpenAI**    | Emerald/Teal | `from-emerald-500/10 via-teal-500/10 to-green-500/10` | Green        | `/logos/openai.svg`    |
| **Anthropic** | Amber/Orange | `from-amber-500/10 via-orange-500/10 to-red-500/10`   | Amber        | `/logos/anthropic.svg` |

Each dialog features:

- **Branded gradient header bar** with provider logo in a colored icon container
- **Provider name + subtitle** — e.g., "Gemini — Google AI text generation"
- **Brand-colored response reference box** — shows the Handlebars variable path with a tinted background and colored text
- **Brand-colored gradient Save button** — matches the provider's color scheme
- **Edge-to-edge header** — `p-0 overflow-hidden` on `DialogContent` for a polished look

### 6. Code Quality

- All files pass **Biome 2.2.0** lint and format checks with zero errors and zero warnings
- All files pass **TypeScript** type checking with zero errors
- Removed unused imports (e.g., `refreshToken` from `use-node-status.ts`)

---

## Architecture

### File Organization

Each AI node follows a consistent 4-file structure:

```
src/features/executions/components/{provider}/
├── actions.ts    — Server action for realtime subscription tokens
├── executor.ts   — Inngest executor that calls the AI SDK
├── dialog.tsx    — Configuration dialog (model, prompts, variable name)
└── node.tsx      — React Flow node component with status indicator
```

Plus a shared channel file:

```
src/inngest/channels/{provider}.ts  — Realtime pub/sub channel definition
```

### Execution Flow

1. **User configures node** — Opens the branded dialog, selects a model, writes system/user prompts, sets a variable name
2. **Workflow runs** — Inngest picks up the workflow execution event
3. **Executor fires** — The executor registry routes to the correct provider executor based on `NodeType`
4. **Channel publishes "loading"** — Realtime channel notifies the frontend that execution started
5. **AI SDK generates text** — `step.ai.wrap()` calls `generateText()` with the configured model and prompts
6. **Handlebars interpolation** — Prompts support `{{variable}}` and `{{json variable}}` to reference outputs from previous workflow steps
7. **Channel publishes "success" or "error"** — Frontend receives the result in real time
8. **Result stored** — The generated text is saved as `{provider}Response` in the workflow context, accessible as `{{variableName.aiResponse}}` in downstream nodes

### Technology Stack

| Layer           | Technology                              |
| --------------- | --------------------------------------- |
| AI SDK          | Vercel AI SDK v6 (`ai@6.0.40`)          |
| Google          | `@ai-sdk/google@3.0.10`                 |
| OpenAI          | `@ai-sdk/openai@3.0.12`                 |
| Anthropic       | `@ai-sdk/anthropic@3.0.15`              |
| Background Jobs | Inngest v3.44.1                         |
| Realtime        | `@inngest/realtime@0.4.5`               |
| Template Engine | Handlebars                              |
| Form Validation | Zod v4 + react-hook-form v7             |
| UI Components   | shadcn/ui (Dialog, Select, Badge, etc.) |
| Workflow Editor | React Flow (`@xyflow/react@12.10.0`)    |

---

## How Users Benefit

### For Workflow Builders

- **Three AI providers in one place** — No need to write code or manage integrations. Just drag a node onto the canvas and configure it visually.
- **Model flexibility** — Each provider offers multiple models with clear labels (Recommended, Fast, Budget, Advanced, etc.) so users can pick the right balance of cost and quality.
- **Template interpolation** — Reference outputs from any previous workflow step using `{{variableName.field}}` in prompts. Chain multiple AI calls together or mix AI with HTTP requests, form triggers, etc.
- **Real-time status** — See loading, success, and error states instantly in the workflow editor thanks to Inngest realtime channels.
- **Consistent experience** — All three providers share the same dialog layout, form fields, and behavior, so learning one means you know them all.

### For Developers

- **Clean architecture** — The 4-file pattern makes it trivial to add new AI providers.
- **Type safety** — Full TypeScript coverage with Zod validation on all form inputs.
- **Biome enforced** — Consistent code style across the entire codebase with zero lint warnings.

---

## How It Could Be Enhanced

### Short-term Improvements

1. **Streaming responses** — Replace `generateText` with `streamText` from the Vercel AI SDK to show AI output as it's being generated, providing a much better UX for long responses.

2. **Temperature & max tokens controls** — Add sliders or inputs in the dialog for `temperature` (creativity), `maxTokens` (response length), and `topP` (nucleus sampling) to give users fine-grained control.

3. **Structured output (JSON mode)** — Add a toggle to enable JSON output mode with a Zod schema definition field, using the AI SDK's `generateObject` function for structured data extraction.

4. **Prompt templates library** — Pre-built prompt templates (summarize, translate, extract, classify, etc.) that users can pick from a dropdown and customize.

5. **Token usage tracking** — Display token consumption per execution in the node status, leveraging the `usage` field returned by `generateText`.

6. **Cost estimation** — Show estimated cost per execution based on the selected model's pricing and the prompt/response token counts.

### Medium-term Enhancements

7. **Multi-modal inputs** — Support image and file inputs alongside text prompts, using the AI SDK's multi-modal capabilities (e.g., GPT-4o vision, Gemini multimodal).

8. **Tool calling / Function calling** — Allow nodes to define tools that the AI can invoke, enabling agentic workflows where the AI can trigger other workflow steps.

9. **Conversation memory** — Add a "conversation history" mode where the node maintains context across multiple executions, useful for chatbot-style workflows.

10. **A/B testing** — Allow users to configure multiple models on a single node and compare outputs side by side, then pick a winner.

11. **Retry with fallback** — If the primary model fails (rate limit, downtime), automatically retry with a fallback model from the same or different provider.

12. **Rate limiting & queuing** — Add configurable rate limits per provider to avoid hitting API quotas, with automatic request queuing.

### Long-term Vision

13. **Custom model providers** — Allow users to add their own OpenAI-compatible endpoints (Ollama, vLLM, Together AI, Groq, etc.) as custom providers.

14. **Fine-tuned model support** — Let users select their own fine-tuned models from their provider accounts.

15. **Evaluation & scoring** — Built-in evaluation framework that scores AI outputs against expected results, useful for prompt engineering and regression testing.

16. **Prompt versioning** — Version control for prompts with diff view, rollback capability, and A/B deployment.

---

## Environment Variables

Make sure the following environment variables are set in your `.env` file:

```env
# Google Gemini
GOOGLE_GENERATIVE_AI_API_KEY=your_google_api_key

# OpenAI
OPENAI_API_KEY=your_openai_api_key

# Anthropic
ANTHROPIC_API_KEY=your_anthropic_api_key
```

---

## Database Schema

The Prisma schema includes these node types in the `NodeType` enum:

```prisma
enum NodeType {
  INITIAL
  MANUAL_TRIGGER
  HTTP_REQUEST
  GOOGLE_FORM_TRIGGER
  STRIPE_TRIGGER
  ANTHROPIC
  GEMINI
  OPENAI
}
```

No new migrations are needed — the AI node types were already defined in the schema.
