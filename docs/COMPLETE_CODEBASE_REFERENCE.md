# AutoPilot — Complete Codebase Reference

> **Audience:** Intermediate / beginner developers who want to understand every single thing about this project — no shortcuts, no handwaving. If you read this document cover to cover you will understand the full system: why every file exists, what every algorithm does, and why every technology was chosen.

---

## Table of Contents

- [Part 0 — The Big Picture](#part-0--the-big-picture)
- [Part 1 — Project Root & Configuration](#part-1--project-root--configuration)
- [Part 2 — Technology Deep-Dives](#part-2--technology-deep-dives)
- [Part 3 — Source Code: Folder by Folder](#part-3--source-code-folder-by-folder)
  - [3.1 src/types/](#31-srctypes)
  - [3.2 src/config/](#32-srcconfig)
  - [3.3 src/lib/ — The Engine Room](#33-srclib--the-engine-room)
  - [3.4 src/workers/ — Every Worker Explained](#34-srcworkers--every-worker-explained)
  - [3.5 src/store/](#35-srcstore)
  - [3.6 src/features/](#36-srcfeatures)
  - [3.7 src/components/](#37-srccomponents)
  - [3.8 src/hooks/](#38-srchooks)
  - [3.9 src/app/ — All Pages & Layouts](#39-srcapp--all-pages--layouts)
- [Part 4 — Complete Data Flow Walkthroughs](#part-4--complete-data-flow-walkthroughs)
- [Part 5 — Architecture Decisions & Trade-offs](#part-5--architecture-decisions--trade-offs)
- [Part 6 — Performance Architecture](#part-6--performance-architecture)
- [Part 7 — Build & Deployment](#part-7--build--deployment)

---

# Part 0 — The Big Picture

## What is AutoPilot?

AutoPilot is a **workflow automation tool for CSV and PDF files that runs 100% inside the browser**. You drag nodes onto a canvas, connect them together like a flowchart, click Run, and the data flows through each step automatically — no server, no internet connection required, no account needed.

Think of it like a visual version of writing a bash pipeline:

```
cat data.csv | filter "age > 30" | sort by "name" | deduplicate > output.csv
```

But instead of typing commands, you drag visual blocks onto a canvas. Each block is a "node." Connecting two nodes with a line means "send the output of node A as the input to node B."

## Why Is It Built This Way?

The original version of AutoPilot used a traditional server architecture: Next.js frontend, Node.js backend, PostgreSQL database, Redis queue, BullMQ workers. Files were uploaded to a server, processed there, and results sent back.

The team decided to make a "Grand Shift" to a **100% offline Progressive Web App (PWA)**:

- **Privacy**: Your CSV files never leave your machine. A payroll CSV with 50,000 employee salaries should never travel over the internet.
- **No infrastructure cost**: No servers to pay for, no databases to maintain, no Redis instances.
- **Works offline**: Once the app is loaded (cached by the Service Worker), it works forever without internet.
- **No auth needed**: If there's no server, there's nothing to log in to.

The technical challenge: CSV files can be **gigabytes large**. How do you sort 40 million rows inside a browser tab without crashing it? That's the core engineering problem this codebase solves.

## The Answer: Workers + OPFS + Streaming

The solution has three pillars:

1. **Web Workers** — Move CPU-intensive work off the main thread (which controls the UI) so the page doesn't freeze.
2. **OPFS (Origin Private File System)** — Store large datasets as files on disk inside the browser, so they never have to fit in RAM all at once.
3. **Streaming Algorithms** — Process data one chunk at a time (10,000 rows at a time by default) instead of loading everything at once.

## System Architecture Bird's-Eye View

```
┌─────────────────────────────────────────────────────────────────────┐
│                          BROWSER TAB                                 │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    REACT UI (Main Thread)                     │  │
│  │                                                              │  │
│  │  ┌──────────────┐  ┌─────────────────┐  ┌────────────────┐  │  │
│  │  │  ReactFlow   │  │  Jotai Atoms    │  │  React Query   │  │  │
│  │  │  Canvas      │  │  (Live Status)  │  │  (DB Queries)  │  │  │
│  │  └──────────────┘  └─────────────────┘  └────────────────┘  │  │
│  └──────────────────────┬───────────────────────────────────────┘  │
│                         │ dispatchWorkerJob()                       │
│  ┌──────────────────────▼───────────────────────────────────────┐  │
│  │                  EXECUTION ENGINE                             │  │
│  │  (execution-engine.ts + worker-manager.ts)                   │  │
│  └──────┬──────────┬──────────┬──────────┬──────────┬───────────┘  │
│         │          │          │          │          │               │
│  ┌──────▼──┐ ┌─────▼──┐ ┌────▼───┐ ┌────▼───┐ ┌────▼───┐          │
│  │csv-parse│ │csv-sort│ │csv-join│ │csv-dedup│ │csv-agg │  ...     │
│  │.worker  │ │.worker │ │.worker │ │.worker  │ │.worker │          │
│  └──────┬──┘ └─────┬──┘ └────┬───┘ └────┬───┘ └────┬───┘          │
│         └──────────┴──────────┴──────────┴──────────┘               │
│                         │ read/write chunks                         │
│  ┌──────────────────────▼───────────────────────────────────────┐  │
│  │                        OPFS                                   │  │
│  │  autopilot/executions/<execId>/<datasetId>/chunk-000000.json  │  │
│  │  autopilot/executions/<execId>/<datasetId>/chunk-000001.json  │  │
│  │  ...                                                          │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                     IndexedDB (Dexie)                         │  │
│  │  workflows | executions | datasets (manifests) | node outputs │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────▼──────────────┐
              │         Service Worker        │
              │  Caches app shell + assets    │
              │  Enables full offline use     │
              └───────────────────────────────┘
```

---

# Part 1 — Project Root & Configuration

## Full Directory Tree

```
autopilot/
├── .agents/                  # AI agent configurations (Claude)
├── .claude/                  # Claude Code IDE settings
├── .git/                     # Git version control
├── .next/                    # Next.js production build output
├── .next-dev/                # Next.js development build output
├── docs/                     # Architecture documentation (30+ .md files)
├── node_modules/             # npm dependencies
├── out/                      # Static HTML export (after `npm run build`)
├── public/                   # Files served as-is to the browser
│   ├── manifest.json         # PWA manifest
│   ├── sw.js                 # Service Worker (offline caching)
│   ├── sw-register.js        # Script that registers the Service Worker
│   ├── pdf.worker.min.mjs    # PDF.js worker (3MB, vendored)
│   ├── workers/              # Bundled Web Worker JS files
│   │   ├── csv-parse.worker.js
│   │   ├── csv-sort.worker.js
│   │   └── ... (one file per worker)
│   ├── icons/                # App icons (icon.svg, icon-192.png, icon-512.png)
│   └── logos/                # Logo assets
├── scripts/
│   └── build-workers.mjs     # esbuild script to bundle workers
├── src/                      # ALL source code lives here
│   ├── app/                  # Next.js App Router (pages + layouts)
│   ├── components/           # Shared React components
│   ├── config/               # Constants and node-to-component mappings
│   ├── features/             # Feature modules (editor, executions, workflows, settings)
│   ├── hooks/                # Shared custom React hooks
│   ├── lib/                  # Core business logic (engine, workers, DB, OPFS)
│   ├── store/                # Global state (Jotai atoms)
│   ├── types/                # TypeScript type definitions
│   └── workers/              # Web Worker source files (TypeScript)
├── biome.json                # Linter + formatter config
├── components.json           # shadcn/ui configuration
├── Dockerfile                # Multi-stage container build
├── ecosystem.config.js       # PM2 process manager config
├── mprocs.yaml               # Multi-process dev runner config
├── next.config.ts            # Next.js configuration
├── package.json              # Dependencies + scripts
├── postcss.config.mjs        # PostCSS (needed for Tailwind CSS v4)
├── railway.toml              # Railway.app deployment config
└── tsconfig.json             # TypeScript compiler config
```

## `package.json` — Every Dependency Explained

### Core Framework

| Package | Version | What it does |
|---|---|---|
| `next` | 15.5.11 | The React framework. Handles routing, bundling, static export. |
| `react` | 19.1.0 | The UI library. Renders components, manages re-renders. |
| `react-dom` | 19.1.0 | The browser-specific renderer for React. |

### UI & Components

| Package | What it does |
|---|---|
| `@radix-ui/react-*` (24 packages) | Headless, accessible UI primitives: Dialog, Select, Popover, Tabs, Slider, etc. No visual styling — just logic and accessibility. shadcn/ui wraps these. |
| `lucide-react` | Icon library. SVG icons as React components. |
| `@xyflow/react` | ReactFlow — the node-graph canvas. Renders draggable nodes and edges. |
| `recharts` | Charting library. Used for execution timeline visualizations. |
| `vaul` | Drawer/sheet component (slides up from bottom). |
| `tw-animate-css` | CSS animation utilities for Tailwind. |
| `next-themes` | Dark/light theme switching. |
| `cmdk` | Command palette component (used inside shadcn Command). |

### State Management & Data Fetching

| Package | What it does |
|---|---|
| `jotai` | Atomic state management. Each piece of state is an "atom." Very lightweight. |
| `@tanstack/react-query` | Async data fetching with automatic caching, loading states, and mutation tracking. |
| `nuqs` | Sync UI state (search, filters, pagination) to the URL query string. |

### Forms & Validation

| Package | What it does |
|---|---|
| `react-hook-form` | Form state management. Tracks field values, errors, submit state. |
| `zod` | Schema validation library. Define what valid data looks like, then parse/validate against it. |
| `@hookform/resolvers` | Connects Zod schemas to react-hook-form's validation. |

### CSV / Data Processing

| Package | What it does |
|---|---|
| `papaparse` | Browser-native CSV parser. Supports streaming via the `step` callback. Used inside the CSV parse worker. |
| `csv-parse` | Node.js CSV parser (used in scripts/legacy code). |
| `fast-csv` | Alternative CSV library (available but PapaParse is primary). |
| `xlsx` | Excel file reading/writing. |

### PDF Processing

| Package | What it does |
|---|---|
| `pdf-lib` | Create and modify PDF files in the browser. Used for PDF generation, merging, signing. |
| `pdfjs-dist` | Mozilla's PDF.js — renders PDFs, extracts text and tables. Runs in a separate worker thread. |

### Storage & IDs

| Package | What it does |
|---|---|
| `dexie` | A friendly wrapper around IndexedDB. Provides a clean API for reading/writing structured data. |
| `@paralleldrive/cuid2` | Generates unique IDs. Used for execution IDs, dataset IDs, node IDs. More collision-resistant than UUID. |

### Utilities

| Package | What it does |
|---|---|
| `date-fns` | Date formatting and manipulation. |
| `clsx` | Conditionally join CSS class names. |
| `tailwind-merge` | Merge Tailwind classes without conflicts (e.g., `text-red-500` overrides `text-blue-500`). |
| `superjson` | Serializes JavaScript objects that `JSON.stringify` can't handle (Dates, Maps, Sets). |
| `ky` | A nicer `fetch` wrapper. |
| `@dagrejs/dagre` | Graph layout algorithm. Auto-positions nodes in the ReactFlow canvas. |

### Dev Dependencies

| Package | What it does |
|---|---|
| `esbuild` | Ultra-fast JavaScript bundler. Used to bundle worker TypeScript → worker JS. |
| `tsx` | Run TypeScript files directly in Node (for worker watchers in dev). |
| `@biomejs/biome` | Combined linter + formatter (replaces ESLint + Prettier). |
| `tailwindcss` v4 | CSS utility framework. |
| `@tailwindcss/postcss` | Tailwind's PostCSS plugin (required for Tailwind v4). |
| `concurrently` | Run multiple npm scripts in parallel (for `dev:all`). |
| `@faker-js/faker` | Generate fake data (used for testing/benchmarking). |
| `cross-env` | Set environment variables in a cross-platform way (works on Windows + Mac). |
| `mprocs` | Multi-process runner with a nice terminal UI. Alternative to `concurrently`. |

### npm Scripts

```json
"scripts": {
  "dev": "next dev --turbopack",
  "prebuild": "node scripts/build-workers.mjs",
  "build": "next build --turbopack",
  "start": "next start",
  "lint": "biome check .",
  "format": "biome format --write .",
  "worker:parse": "tsx watch src/workers/csv-parse.worker.ts",
  "worker:sort": "tsx watch src/workers/csv-sort.worker.ts",
  ... (one per worker)
  "dev:all": "concurrently \"npm run dev\" \"npm run worker:parse\" ..."
}
```

- `prebuild` runs **before** `build` automatically (npm lifecycle hook). This ensures workers are bundled before the Next.js build starts.
- `worker:*` scripts use `tsx watch` which hot-reloads the worker TypeScript on save — but note: in dev, the pre-built `.js` files in `public/workers/` are what the browser actually loads, so you need `build-workers.mjs` to run to pick up changes.
- `dev:all` is the full dev experience: Next.js + all 9 worker watchers running simultaneously.

## `next.config.ts`

```typescript
const nextConfig = {
  output: "export",           // Build as static HTML/JS/CSS — no Node.js server needed
  trailingSlash: true,        // /workflows → /workflows/ (needed for static hosting)
  devIndicators: false,       // Hide the Next.js dev toolbar overlay
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  images: { unoptimized: true }, // Disable Image Optimization (no server to run it)
};
```

`output: "export"` is the most important setting. It means the build process generates static HTML, CSS, and JavaScript files. There's no Node.js server. The app is just files that any web server (or even `file://`) can serve. This is what enables offline use.

## `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2017",           // Output modern JS (async/await, etc.) — all browsers support this
    "lib": ["dom", "dom.iterable", "esnext"],
    "strict": true,               // Enable ALL strict type checks
    "moduleResolution": "bundler", // Let the bundler (webpack/turbopack) handle imports
    "jsx": "preserve",            // Don't transform JSX — let Next.js handle it
    "paths": {
      "@/*": ["./src/*"]          // "@/lib/db" → "src/lib/db.ts"
    }
  }
}
```

`strict: true` enables: `strictNullChecks` (can't use `null` where `string` is expected), `noImplicitAny`, `strictFunctionTypes`, and several other checks. This catches bugs at compile time rather than runtime.

The `@/*` path alias means you can write `import { db } from "@/lib/db"` instead of `import { db } from "../../lib/db"`. Much cleaner, and refactor-safe.

## `biome.json`

Biome replaces both ESLint (linting) and Prettier (formatting) with a single, much faster tool written in Rust.

```json
{
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "formatter": { "indentStyle": "space", "indentWidth": 2 },
  "linter": {
    "rules": {
      "recommended": true,
      "correctness": { ... },
      "suspicious": { ... }
    }
  }
}
```

2-space indentation. Recommended lint rules plus some custom ones. The `vcs.useIgnoreFile: true` means it respects `.gitignore`.

## `postcss.config.mjs`

```javascript
export default { plugins: { "@tailwindcss/postcss": {} } };
```

Tailwind CSS v4 is applied as a PostCSS plugin. PostCSS is a CSS transformation pipeline — it takes your CSS, passes it through plugins, and outputs final CSS. The `@tailwindcss/postcss` plugin scans your TypeScript/HTML files for Tailwind class names and generates only the CSS rules you actually use.

## `public/manifest.json` — PWA Manifest

```json
{
  "name": "AutoPilot",
  "short_name": "AutoPilot",
  "display": "standalone",
  "start_url": "/workflows/",
  "background_color": "#09090b",
  "theme_color": "#09090b",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

This file tells the browser "this website can be installed as an app." `display: "standalone"` means it opens in its own window without the browser's address bar. `start_url: "/workflows/"` is the page opened when the user launches the installed app.

---

# Part 2 — Technology Deep-Dives

## 2.1 Next.js 15 App Router

### What is Next.js?

Next.js is a React framework that adds:
- **File-based routing**: create `src/app/workflows/page.tsx` and the URL `/workflows` automatically exists
- **Layouts**: wrap multiple pages in a shared layout without repeating code
- **Built-in bundling**: webpack or turbopack handles imports, code splitting, CSS
- **Static export**: generate plain HTML/CSS/JS with no server required

### App Router Explained

The "App Router" (introduced in Next.js 13, default in 15) organizes files inside `src/app/`. The rules:
- `page.tsx` = a route that users can navigate to
- `layout.tsx` = a wrapper component that stays mounted when navigating between child routes
- `(folder)` (parentheses) = a "route group" — it organizes files but **doesn't appear in the URL**

So this structure:
```
src/app/
  (dashboard)/
    (rest)/
      workflows/
        page.tsx      → URL: /workflows/
      executions/
        page.tsx      → URL: /executions/
    (editor)/
      workflows/editor/
        page.tsx      → URL: /workflows/editor/
```

The `(dashboard)` and `(rest)` folders exist purely to organize code and apply different layouts — they don't add path segments.

### Static Export Mode

Because `output: "export"` is set, Next.js generates static files. All routes become HTML files. There's no server rendering. React runs entirely in the browser (Client-Side Rendering). This is fine for AutoPilot because all data is in IndexedDB/OPFS — there's no server data to fetch at render time.

### Turbopack

The `--turbopack` flag enables Next.js's new Rust-based bundler. It's dramatically faster than webpack for development (instant HMR) and also faster for production builds.

## 2.2 React 19

### What is React?

React is a JavaScript library for building UIs. The core idea: describe what the UI should look like given the current data (state), and React figures out the minimum DOM changes needed when data changes.

```tsx
// Instead of: document.getElementById('count').textContent = count
// You write:
function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
}
```

### Components

Everything in React is a component — a function that returns JSX (HTML-like syntax). Components can accept props (like function arguments) and maintain local state.

### React 19 Features Used

- **`use` hook**: Unwrap promises inside components (experimental, used with Suspense)
- **Server Components**: In static export mode, all components are effectively client components (they run in the browser)
- **Improved `useRef`**: No `forwardRef` needed in React 19

### Why Client Components Only?

With `output: "export"`, Next.js renders pages to static HTML at build time. Server Components that fetch data from a database can't work (there's no server at runtime). Every interactive component uses `"use client"` or is a pure Client Component.

## 2.3 TypeScript

### What is TypeScript?

TypeScript is JavaScript with a type system on top. You annotate variables, function parameters, and return values with types. The TypeScript compiler (`tsc`) checks your code before it runs and catches errors like:

```typescript
function add(a: number, b: number): number {
  return a + b;
}
add("hello", 5); // ❌ TypeScript error: Argument of type 'string' is not assignable to type 'number'
```

### Key TypeScript Patterns Used in AutoPilot

**Interfaces** define the shape of objects:
```typescript
export interface DatasetRef {
  kind: "dataset";
  datasetId: string;
  executionId: string;
  variableName: string;
  rowCount: number;
  chunkCount: number;
  byteSize: number;
  schema?: DatasetSchema;   // ? means optional
}
```

**Enums** define a fixed set of named values:
```typescript
export enum NodeType {
  CSV_PARSE = "CSV_PARSE",
  CSV_SORT = "CSV_SORT",
  // ...
}
```

Why use an enum instead of plain strings? Two reasons:
1. **Autocomplete**: your editor knows all valid values
2. **Refactoring safety**: if you rename `CSV_PARSE` to `CSV_PARSER`, TypeScript finds every usage

**Generic types** allow functions to work with different types while remaining type-safe:
```typescript
function dispatchWorkerJob<TInput, TOutput>(
  type: WorkerJobType,
  input: TInput,
): Promise<TOutput> { ... }
```

The `<TInput, TOutput>` says: "this function works with any input type and any output type, and the caller decides what those are."

**`Record<K, V>`** is a TypeScript utility for objects whose keys are all the same type and values are all the same type:
```typescript
const nodeStatusMap: Record<string, NodeStatus> = {};
// Equivalent to: { [nodeId: string]: NodeStatus }
```

**Type guards** narrow types at runtime:
```typescript
export const isDatasetRef = (value: unknown): value is DatasetRef =>
  typeof value === "object" &&
  value !== null &&
  (value as DatasetRef).kind === "dataset";
```

After calling `isDatasetRef(x)` in an `if`, TypeScript knows `x` is a `DatasetRef`.

## 2.4 Tailwind CSS v4

### What is Tailwind?

Tailwind is a "utility-first" CSS framework. Instead of writing custom CSS rules, you compose pre-defined utility classes directly in your HTML/JSX:

```tsx
// Without Tailwind:
<div className="container">...</div>
// CSS: .container { display: flex; padding: 16px; gap: 8px; ... }

// With Tailwind:
<div className="flex p-4 gap-2 rounded-lg bg-zinc-900 text-white">...</div>
```

### Tailwind v4 Changes

Tailwind v4 is a major rewrite. Instead of a `tailwind.config.js`, configuration lives in CSS files. The `@tailwindcss/postcss` PostCSS plugin scans source files for class names and generates CSS on demand. This is faster and requires less boilerplate.

### How AutoPilot Uses Tailwind

The `src/app/globals.css` file imports Tailwind:
```css
@import "tailwindcss";
```

Components use utility classes everywhere. The `cn()` utility (from `lib/utils.ts`) combines `clsx` + `tailwind-merge`:
```typescript
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

`clsx` joins class strings conditionally. `tailwind-merge` resolves conflicts — if you pass both `text-red-500` and `text-blue-500`, it keeps the last one instead of both being in the class string.

## 2.5 OPFS — Origin Private File System

### The Problem OPFS Solves

Imagine you need to process a CSV with 10 million rows. Each row is ~100 bytes. That's 1 GB of data. You can't hold 1 GB in JavaScript variables (RAM) — the browser tab will crash.

You need to store it on disk. But browsers don't let JavaScript write arbitrary files to the user's disk (that would be a security nightmare). So where do you put it?

Before OPFS, the main option was IndexedDB. But IndexedDB is designed for structured data (objects), not large sequential files. Reading and writing blobs through IndexedDB is slow and has practical size limits.

### What is OPFS?

OPFS (Origin Private File System) is a browser API that gives each website its own private directory on the user's disk. The files are invisible to the user (they can't browse them with File Explorer), but the website can create, read, write, and delete files at near-native speed.

```
User's disk:
  C:/Users/user/AppData/Local/...browser.../autopilot.com/OPFS/
    autopilot/
      executions/
        abc123/          ← executionId
          def456/        ← datasetId
            chunk-000000.json   ← 10,000 rows as JSON
            chunk-000001.json
            chunk-000002.json
```

### OPFS API Basics

```javascript
// Get your private root directory
const opfsRoot = await navigator.storage.getDirectory();

// Create a subdirectory
const dir = await opfsRoot.getDirectoryHandle("mydir", { create: true });

// Create a file and write to it
const fileHandle = await dir.getFileHandle("data.json", { create: true });
const writable = await fileHandle.createWritable();
await writable.write(new TextEncoder().encode('{"hello": "world"}'));
await writable.close();

// Read it back
const file = await fileHandle.getFile();
const text = await file.text();
```

### Why OPFS is Perfect for AutoPilot

1. **Large file support**: Can store gigabytes of data
2. **Fast sequential access**: Reading chunks one after another is very fast
3. **Worker-accessible**: Web Workers can access OPFS directly (critical — the workers do all the processing)
4. **Persistent**: Data survives page refreshes and browser restarts
5. **Private**: Other websites can't access your data

### OPFS vs IndexedDB for Row Data

| Feature | OPFS | IndexedDB |
|---|---|---|
| Large binary data | Excellent | Poor (slow, size limits) |
| Sequential read speed | Fast (file I/O) | Slow (query overhead) |
| Structured queries | No | Yes |
| Accessible in Workers | Yes | Yes |
| Use in AutoPilot | Row data (JSON chunks) | Metadata, manifests |

The two work **together**: OPFS stores the actual row data (large, binary-ish), and IndexedDB stores the **metadata** about that data (small, structured) — how many rows, where the chunks are, what columns exist.

## 2.6 Dexie / IndexedDB

### What is IndexedDB?

IndexedDB is a browser database — like SQLite but built into every browser. It stores JavaScript objects and allows querying by indexed fields.

The raw IndexedDB API is famously painful to use:
```javascript
// Raw IndexedDB — tedious and error-prone
const request = indexedDB.open("mydb", 1);
request.onupgradeneeded = (event) => {
  const db = event.target.result;
  const store = db.createObjectStore("items", { keyPath: "id" });
  store.createIndex("name", "name", { unique: false });
};
request.onsuccess = (event) => {
  const db = event.target.result;
  const transaction = db.transaction("items", "readwrite");
  const store = transaction.objectStore("items");
  store.add({ id: 1, name: "hello" });
};
```

### What is Dexie?

Dexie wraps IndexedDB with a clean, promise-based API:
```typescript
// Dexie — clean and readable
const db = new Dexie("mydb");
db.version(1).stores({ items: "id, name" });
await db.items.add({ id: 1, name: "hello" });
const item = await db.items.get(1);
const results = await db.items.where("name").equals("hello").toArray();
```

### AutoPilot's Database Schema

```typescript
export class AutoPilotDB extends Dexie {
  workflows!: Table<WorkflowRecord, string>;
  workflowNodes!: Table<WorkflowNodeRecord, string>;
  workflowConnections!: Table<WorkflowConnectionRecord, string>;
  executions!: Table<ExecutionRecord, string>;
  executionNodeOutputs!: Table<ExecutionNodeOutputRecord, string>;
  datasets!: Table<DatasetRecord, string>;

  constructor() {
    super("autopilot");  // Database name
    this.version(1).stores({
      workflows: "id, name, createdAt, updatedAt",
      workflowNodes: "id, workflowId, type",
      workflowConnections: "id, workflowId, fromNodeId, toNodeId",
      executions: "id, workflowId, status, startedAt",
      executionNodeOutputs: "id, executionId, nodeId, status",
      datasets: "id, executionId, variableName",
    });
  }
}

export const db = new AutoPilotDB();
```

The string `"id, name, createdAt, updatedAt"` defines the primary key (`id`) and indexes (`name`, `createdAt`, `updatedAt`). You can only query by indexed fields efficiently.

### What Each Table Stores

| Table | What's in it |
|---|---|
| `workflows` | Workflow definitions: id, name, created/updated timestamps |
| `workflowNodes` | Each node in a workflow: position (x,y), type, config data |
| `workflowConnections` | Each edge in a workflow: which nodes are connected |
| `executions` | Each time a workflow is run: status, start time, end time, error |
| `executionNodeOutputs` | What each node produced: variable name, dataset ID, timing, errors |
| `datasets` | The manifest for each dataset: row count, chunk list, schema |

### The Key Relationship: IndexedDB + OPFS

```
IndexedDB: datasets table
  { id: "def456", executionId: "abc123", variableName: "parsedData",
    manifest: {
      rowCount: 1_500_000,
      chunkCount: 150,
      chunks: [
        { chunkIndex: 0, fileName: "chunk-000000.json", rowCount: 10000, ... },
        { chunkIndex: 1, fileName: "chunk-000001.json", rowCount: 10000, ... },
        ...
      ]
    }
  }

OPFS: actual data
  autopilot/executions/abc123/def456/chunk-000000.json  ← [{ row1 }, { row2 }, ...]
  autopilot/executions/abc123/def456/chunk-000001.json
  ...
```

When you need to read a dataset:
1. Look up the manifest in IndexedDB (fast: it's just metadata)
2. Use the manifest's chunk list to find which OPFS files to read
3. Read only the OPFS files you need (for pagination, skip most chunks)

## 2.7 Jotai

### The Problem with State

React's built-in state (`useState`) is local to a component. When many components need to share state (like "which node is currently running"), you have two options:

1. **Prop drilling**: pass state down through every component in the tree (messy)
2. **Global state library**: store state outside React, any component can read/write it

### What is Jotai?

Jotai takes an **atomic** approach to global state. An "atom" is the smallest unit of state — a single piece of data.

```typescript
import { atom, useAtom } from "jotai";

// Define an atom — just a piece of state
const countAtom = atom(0);

// Use it in any component
function Counter() {
  const [count, setCount] = useAtom(countAtom);
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
}

// Multiple components can share the same atom
function Display() {
  const [count] = useAtom(countAtom);
  return <div>Count: {count}</div>;
}
```

When `count` changes, **only components that use `countAtom` re-render** — not the whole tree. This is very efficient.

### Write-Only Atoms

Jotai supports a special atom pattern for "actions" — atoms you can only write to (never read):

```typescript
export const resetWorkflowExecutionStateAtom = atom(null, (_get, set) => {
  set(nodeStatusMapAtom, {});
  set(nodeProgressMapAtom, {});
  set(nodeTimingsAtom, {});
  set(workflowExecutionStateAtom, "idle");
  // ... reset everything
});

// Usage:
const reset = useSetAtom(resetWorkflowExecutionStateAtom);
reset(); // resets all atoms in one call
```

This is like a Redux action — it batches multiple state updates.

### Why Jotai Over Redux or Zustand?

- **Redux**: Too much boilerplate. Requires actions, reducers, selectors.
- **Zustand**: Good, but stores are flat objects. Can cause unnecessary re-renders.
- **Jotai**: Atoms are composable, minimal boilerplate, and component subscriptions are granular (only re-render when the specific atom you use changes).

### AutoPilot's Atoms

```typescript
// Real-time execution status for the progress panel
export const nodeStatusMapAtom = atom<Record<string, NodeStatus>>({});
export const nodeProgressMapAtom = atom<Record<string, { progress: number; message?: string }>>({});
export const nodeTimingsAtom = atom<Record<string, { startMs: number; endMs?: number }>>({});
export const workflowExecutionStateAtom = atom<WorkflowExecutionState>("idle");
export const activeExecutionIdAtom = atom<string | null>(null);
export const executionStartedAtAtom = atom<number | null>(null);
export const workflowExecutionResultAtom = atom<unknown | null>(null);
export const workflowExecutionErrorAtom = atom<string | null>(null);
export const workflowProgressPanelOpenAtom = atom(false);
export const workflowProgressPanelCollapsedAtom = atom(false);

// Editor-specific
export const editorAtom = atom<ReactFlowInstance | null>(null);
export const workflowIdAtom = atom<string | null>(null);
export const pendingConnectionAtom = atom<string | null>(null);
export const quickConnectOpenAtom = atom<boolean>(false);
```

The progress panel in the editor subscribes to `nodeStatusMapAtom` and `nodeProgressMapAtom`. The execution engine updates these atoms as nodes run. React automatically re-renders the progress panel to show live status.

## 2.8 TanStack React Query

### What is React Query?

React Query manages "async server state" — data that comes from an async source (in this case, IndexedDB) and needs to be cached, refreshed, and kept in sync with the UI.

Without React Query, you'd write this manually in every component:
```typescript
const [workflows, setWorkflows] = useState([]);
const [loading, setLoading] = useState(true);
const [error, setError] = useState(null);

useEffect(() => {
  setLoading(true);
  db.workflows.toArray()
    .then(setWorkflows)
    .catch(setError)
    .finally(() => setLoading(false));
}, []);
```

With React Query:
```typescript
const { data: workflows, isLoading, error } = useQuery({
  queryKey: ["workflows"],
  queryFn: () => db.workflows.toArray(),
});
```

### Query Keys

A query key is a unique identifier for a piece of data. React Query uses it to cache results and decide when to re-fetch.

```typescript
// From use-workflows.ts
export const workflowKeys = {
  all: ["workflows"] as const,
  list: (params: WorkflowListParams) => ["workflows", "list", params] as const,
  detail: (id: string) => ["workflows", "detail", id] as const,
};
```

When a workflow is created or deleted, the mutation calls `queryClient.invalidateQueries({ queryKey: workflowKeys.all })` — this tells React Query to re-fetch all workflow queries, so the list updates automatically.

### Suspense Queries

`useSuspenseQuery` integrates with React's `<Suspense>` component:
```tsx
// The loading spinner is shown by the Suspense boundary
// No need to check isLoading manually
function WorkflowList() {
  const { data } = useSuspenseWorkflows(params);
  return <div>{data.map(w => <WorkflowCard key={w.id} workflow={w} />)}</div>;
}

// In the page:
<Suspense fallback={<Spinner />}>
  <WorkflowList />
</Suspense>
```

## 2.9 Radix UI & shadcn/ui

### What is Radix UI?

Radix UI provides **headless** UI components — they handle all the logic and accessibility (keyboard navigation, ARIA attributes, focus management) but have **zero styling**. You bring your own CSS.

For example, `@radix-ui/react-dialog`:
- Opens/closes on trigger click
- Traps focus inside the modal
- Closes on Escape key
- Sets `aria-modal="true"` and `role="dialog"`
- Works with screen readers

But it looks completely unstyled out of the box.

### What is shadcn/ui?

shadcn/ui takes Radix primitives and adds Tailwind CSS styling. It's not an npm package — it's a **code generator**. You run `npx shadcn-ui add button` and it copies the component source code into your project. You own the code and can modify it.

All the files in `src/components/ui/` are shadcn components: Button, Dialog, Select, Tabs, Slider, etc.

### How They're Used

```tsx
// src/components/ui/dialog.tsx (shadcn, owned by the project)
import * as DialogPrimitive from "@radix-ui/react-dialog";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogContent = React.forwardRef<...>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 bg-black/50 ..." />
    <DialogPrimitive.Content
      ref={ref}
      className={cn("fixed left-[50%] top-[50%] ...", className)}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
```

## 2.10 Zod

### What is Zod?

Zod is a schema validation library. You define what valid data looks like, then parse unknown data against that schema.

```typescript
import { z } from "zod";

const UserSchema = z.object({
  name: z.string().min(1, "Name is required"),
  age: z.number().int().positive(),
  email: z.string().email().optional(),
});

// Parse and validate:
const result = UserSchema.safeParse({ name: "Alice", age: 30 });
if (result.success) {
  result.data; // TypeScript knows this is { name: string, age: number, email?: string }
} else {
  result.error.issues; // Array of validation errors
}
```

### How AutoPilot Uses Zod

Every node configuration form is validated with Zod. For example, the CSV Sort node:

```typescript
const sortSchema = z.object({
  inputVariable: z.string().min(1, "Select an input dataset"),
  sortColumns: z.array(z.object({
    field: z.string().min(1),
    direction: z.enum(["asc", "desc"]),
  })).min(1, "Add at least one sort column"),
  compareAs: z.enum(["string", "number", "date"]),
  nulls: z.enum(["first", "last"]),
  variableName: z.string().min(1, "Output variable name required"),
});
```

The schema connects to `react-hook-form` via `@hookform/resolvers/zod`:
```typescript
const form = useForm<z.infer<typeof sortSchema>>({
  resolver: zodResolver(sortSchema),
  defaultValues: { ... },
});
```

`z.infer<typeof sortSchema>` automatically derives the TypeScript type from the Zod schema — you don't have to define both separately.

## 2.11 React Flow (XYFlow)

### What is React Flow?

React Flow (`@xyflow/react`) is a library for building node-based editors: flowcharts, workflow builders, diagram editors.

It provides:
- A canvas with pan + zoom
- Draggable nodes
- Connectable handles (the small dots on nodes)
- Edges (lines between nodes) with various styles
- Built-in minimap and controls

### How AutoPilot Uses React Flow

The entire workflow editor canvas is a `<ReactFlow>` component:

```tsx
<ReactFlow
  nodes={nodes}           // Array of { id, type, position, data }
  edges={edges}           // Array of { id, source, target }
  nodeTypes={nodeTypes}   // Map of type string → React component
  onConnect={onConnect}   // Called when user drags a connection
  onNodesChange={...}     // Called on drag/select/delete
  onEdgesChange={...}
>
  <Background />
  <Controls />
  <MiniMap />
</ReactFlow>
```

Custom nodes are registered in `src/config/node-components.ts`:
```typescript
export const nodeTypes: Record<NodeType, ComponentType> = {
  [NodeType.CSV_PARSE]: lazy(() => import("@/features/executions/components/csv-parse/node")),
  [NodeType.CSV_SORT]: lazy(() => import("@/features/executions/components/csv-sort/node")),
  // ...
};
```

Using `lazy()` means each node component is only downloaded when that node type is first used — code splitting.

## 2.12 PapaParse

### What is PapaParse?

PapaParse is the most popular CSV parser for JavaScript. It handles:
- Auto-detection of delimiter (comma, semicolon, tab)
- Quoted fields with embedded commas
- Different line endings (CRLF, LF)
- Streaming via `step` callback (process rows as they're parsed, without loading the whole file)

### The Critical `step` Pattern

The normal way to parse CSV loads everything into memory:
```javascript
Papa.parse(file, {
  complete: (results) => {
    // results.data has ALL rows — could be gigabytes!
    processAll(results.data);
  }
});
```

The streaming way processes one row at a time:
```javascript
Papa.parse(file, {
  step: (result, parser) => {
    const row = result.data; // Just one row
    buffer.push(row);

    if (buffer.length >= 10_000) {
      parser.pause(); // Stop parsing temporarily
      writeChunkToOPFS(buffer).then(() => {
        buffer = [];
        parser.resume(); // Continue parsing
      });
    }
  },
  complete: async () => {
    if (buffer.length > 0) await writeChunkToOPFS(buffer);
  }
});
```

This is exactly how `csv-parse.worker.ts` works. By pausing the parser while writing to OPFS, the row buffer never grows beyond `chunkSize` rows. Memory usage stays flat no matter how big the file is.

## 2.13 Web Workers

### The Problem: JavaScript is Single-Threaded

Normal JavaScript runs on a single thread — the **main thread**. This thread also handles:
- Rendering the page
- Responding to user clicks
- Running your JavaScript code

If your code does something CPU-intensive (like sorting 1 million rows), it **blocks** the main thread. The page freezes. Buttons don't respond. The browser might show "Page not responding."

### What Are Web Workers?

Web Workers are separate JavaScript threads that run in the background. They:
- Run concurrently with the main thread
- Can't access the DOM (no `document.getElementById`)
- Communicate with the main thread via messages (`postMessage` / `onmessage`)
- Can access OPFS, IndexedDB, and fetch

```javascript
// Main thread: create a worker
const worker = new Worker("/workers/csv-sort.worker.js", { type: "module" });

// Send a message to the worker
worker.postMessage({ jobId: "abc", type: "csv-sort", input: { ... } });

// Receive results back
worker.onmessage = (event) => {
  const { kind, jobId, output } = event.data;
  if (kind === "result") console.log("Done!", output);
};
```

### Transferable Objects

When you `postMessage` data, it gets **copied** (serialized, then deserialized). For large ArrayBuffers (like a CSV file loaded into memory), copying is expensive.

The solution: **transfer** the buffer instead of copying it:
```javascript
const buffer = await file.arrayBuffer(); // 50MB file
// Transfer: no copying — the buffer is "moved" to the worker
worker.postMessage({ buffer }, [buffer]); // Second arg = list of transferables
// After this, 'buffer' is empty in the main thread — ownership transferred
```

AutoPilot uses this in the upload-file executor to hand the file buffer to the CSV parse worker without copying.

### Module Workers

```javascript
new Worker("/workers/csv-sort.worker.js", { type: "module" })
```

The `{ type: "module" }` flag enables ES module syntax (`import`/`export`) inside the worker. This is why the worker TypeScript files can use `import` statements.

## 2.14 Service Workers

### What is a Service Worker?

A Service Worker is a special JavaScript file that runs in the background and acts as a **proxy** between the app and the network. It intercepts all network requests the page makes and can decide to:
- Return a cached response (offline)
- Fetch from the network and cache the response
- Fall back to a cached version if the network fails

### AutoPilot's Service Worker (`public/sw.js`)

The service worker uses two caches:
- `autopilot-v4-shell`: HTML pages and critical app URLs
- `autopilot-v4-assets`: JS, CSS, fonts, images, worker files

**Three strategies for three types of requests:**

1. **Navigation (HTML pages)**: Network first, fall back to cached shell
   ```javascript
   if (request.mode === "navigate") {
     event.respondWith(
       fetch(request).catch(() => caches.match("/workflows/"))
     );
   }
   ```

2. **Static assets (JS, CSS, fonts, workers)**: Cache first
   ```javascript
   if (isStaticAsset) {
     const cached = await cache.match(request);
     if (cached) return cached;  // Return from cache immediately
     const network = await fetch(request);
     cache.put(request, network.clone()); // Cache for next time
     return network;
   }
   ```

3. **Everything else**: Network first, cache as backup
   ```javascript
   fetch(request).then(response => {
     cache.put(request, response.clone());
     return response;
   }).catch(() => caches.match(request));
   ```

### Service Worker Lifecycle

1. **Install**: Service worker is downloaded and installed. Pre-caches the app shell URLs.
2. **Activate**: Service worker takes control. Deletes old caches (any cache not named `autopilot-v4-*`).
3. **Fetch**: Intercepts all network requests.

`self.skipWaiting()` on install and `self.clients.claim()` on activate ensure the new service worker takes effect immediately without waiting for the user to close all tabs.

---

---

# Part 3 — Source Code: Folder by Folder

## 3.1 `src/types/`

These files define the shared "language" the entire codebase speaks. TypeScript types have zero runtime cost — they exist only during development to catch bugs.

### `src/types/node-type.ts`

```typescript
export enum NodeType {
  INITIAL = "INITIAL",
  MANUAL_TRIGGER = "MANUAL_TRIGGER",
  UPLOAD_FILE = "UPLOAD_FILE",
  CSV_PARSE = "CSV_PARSE",
  CSV_FILTER = "CSV_FILTER",
  CSV_SORT = "CSV_SORT",
  CSV_JOIN = "CSV_JOIN",
  CSV_AGGREGATE = "CSV_AGGREGATE",
  CSV_DEDUPLICATE = "CSV_DEDUPLICATE",
  CSV_COMPARE = "CSV_COMPARE",
  CSV_CONSECUTIVE_SEQUENCE_ANALYZER = "CSV_CONSECUTIVE_SEQUENCE_ANALYZER",
  CSV_TRANSFORM = "CSV_TRANSFORM",
  CSV_COLUMN_TRANSFORM = "CSV_COLUMN_TRANSFORM",
  CSV_RESTRUCTURE = "CSV_RESTRUCTURE",
  CSV_GENERATE = "CSV_GENERATE",
  PDF_EXTRACT_TEXT = "PDF_EXTRACT_TEXT",
  PDF_EXTRACT_TABLES = "PDF_EXTRACT_TABLES",
  PDF_SPLIT = "PDF_SPLIT",
  PDF_MERGE = "PDF_MERGE",
  PDF_FILL_FORM = "PDF_FILL_FORM",
  PDF_GENERATE = "PDF_GENERATE",
  PDF_SIGN = "PDF_SIGN",
  FILE_EXPORT = "FILE_EXPORT",
}
```

**Why an enum and not plain strings?**

If you used plain strings, you could type `"csv_parse"` (lowercase) by accident and get no error. With the enum, TypeScript forces you to write `NodeType.CSV_PARSE` — the compiler catches typos. The enum values are strings (e.g. `"CSV_PARSE"`) so they serialize to/from JSON and IndexedDB cleanly.

**The three categories:**
- **Control flow nodes** (`INITIAL`, `MANUAL_TRIGGER`): Don't process data; they just signal the start of a workflow.
- **CSV nodes** (10 types): Process tabular data row by row.
- **PDF nodes** (7 types): Work with PDF documents.
- **File nodes** (`UPLOAD_FILE`, `FILE_EXPORT`): Move data in and out of the system.

### `src/types/dataset.ts`

This is the most important type file. Every piece of data flowing between nodes is described by these types.

```typescript
// A single row in a dataset — just a plain object
export type DatasetRow = Record<string, unknown>;
// Example: { name: "Alice", age: "30", city: "Paris" }

// The possible types a field can contain
export type DatasetFieldType =
  | "string" | "number" | "boolean" | "date" | "null" | "unknown";

// Description of a single column
export interface DatasetFieldSchema {
  type: DatasetFieldType;
  nullable: boolean;          // Can this column contain empty/null values?
  sampleValues?: string[];    // Up to 5 example values (for UI hints)
}

// Description of all columns in a dataset
export type DatasetSchema = Record<string, DatasetFieldSchema>;
// Example: { name: { type: "string", nullable: false }, age: { type: "number", nullable: true } }
```

```typescript
// Metadata about a single chunk (one OPFS file)
export interface DatasetChunkMetadata {
  chunkIndex: number;           // 0, 1, 2, ...
  fileName: string;             // "chunk-000000.json"
  rowStart: number;             // First row index in this chunk (absolute)
  rowEnd: number;               // Last row index in this chunk (absolute)
  rowCount: number;             // How many rows in this chunk
  cumulativeRowCount: number;   // Total rows written up to and including this chunk
  byteSize: number;             // Size of this chunk file in bytes
  createdAt: string;            // ISO timestamp
}
```

```typescript
// The full manifest for a dataset — stored in IndexedDB
export interface DatasetManifest {
  version: 1;                   // Schema version for future compatibility
  datasetId: string;            // Unique ID (cuid2)
  executionId: string;          // Which execution produced this
  variableName: string;         // The variable name in the execution context
  createdAt: string;
  updatedAt: string;
  rowCount: number;             // Total rows across all chunks
  chunkCount: number;           // Number of chunk files
  byteSize: number;             // Total bytes across all chunks
  schema?: DatasetSchema;       // Column type information
  chunks: DatasetChunkMetadata[]; // List of all chunks
}
```

```typescript
// A lightweight REFERENCE to a dataset — passed between nodes in the context
export interface DatasetRef {
  kind: "dataset";              // Type discriminator — lets you check if something is a DatasetRef
  datasetId: string;
  executionId: string;
  variableName: string;
  rowCount: number;
  chunkCount: number;
  byteSize: number;
  schema?: DatasetSchema;
}
```

**The Ref pattern is critical.** When a node outputs 10 million rows, it doesn't pass 10 million rows to the next node. It passes a `DatasetRef` — a tiny ~100-byte object that says "the data is in OPFS, here's where to find it." The next node reads it from OPFS when it needs it. This is like a database foreign key — you pass the ID, not the full record.

```typescript
// What comes back when you request a page of rows for the viewer
export interface DatasetPageRowsResult {
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
  rows: DatasetRow[];
}
```

---

## 3.2 `src/config/`

### `src/config/constants.ts`

```typescript
export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_PAGE_SIZE: 10,
  MAX_PAGE_SIZE: 100,
  MIN_PAGE_SIZE: 1,
};

export const MAX_IN_MEMORY_ROWS = 200_000;      // Above this, spill to OPFS
export const DATASET_CHUNK_SIZE_ROWS = 10_000;  // Default rows per OPFS chunk
export const DATASET_PREVIEW_ROWS = 10;         // Rows shown in inline previews
export const DATASET_PAGE_SIZE = 100;           // Rows per page in dataset viewer
```

`MAX_IN_MEMORY_ROWS = 200_000` is a guideline used in some executors. If a dataset has fewer rows than this, it might be safe to hold it in memory. Workers use the user-configurable `chunkSize` from performance settings instead of this constant.

### `src/config/node-components.ts`

This file maps each `NodeType` to its React component:

```typescript
export const nodeComponents: Record<NodeType, ComponentType> = {
  [NodeType.INITIAL]: lazy(() => import("@/components/initial-node")),
  [NodeType.MANUAL_TRIGGER]: lazy(() => import("@/components/manual-trigger-node")),
  [NodeType.CSV_PARSE]: lazy(() => import("@/features/executions/components/csv-parse/node")),
  [NodeType.CSV_SORT]: lazy(() => import("@/features/executions/components/csv-sort/node")),
  // ... one entry per NodeType
};
```

`lazy()` from React creates a "lazy" component — the code is downloaded on demand (only when that node type is first rendered). This is **code splitting**: instead of downloading all 23 node components upfront, only the ones actually used in the current workflow are downloaded.

---

## 3.3 `src/lib/` — The Engine Room

This folder contains the four core systems that make everything work.

### `src/lib/db.ts` — The Database Layer

Full file already shown in the Technology section. Key points:

- **Single exported instance**: `export const db = new AutoPilotDB()` — the whole app imports this one `db` object
- **Dexie version system**: `this.version(1).stores(...)` defines the schema. If you add a new table in the future, you'd add `this.version(2).stores(...)` — Dexie automatically migrates the database
- **TypeScript generics**: `Table<WorkflowRecord, string>` means "a table where each record is a `WorkflowRecord` and the primary key is a `string`"

### `src/lib/opfs.ts` — The File Storage Layer

This file manages all OPFS I/O from the main thread. Workers have their own OPFS helpers in `_opfs-helpers.ts`.

**Directory helpers:**

```typescript
const ROOT_DIR = "autopilot";

async function getRoot(): Promise<FileSystemDirectoryHandle> {
  const opfsRoot = await navigator.storage.getDirectory();
  return opfsRoot.getDirectoryHandle(ROOT_DIR, { create: true });
}

async function getExecutionDir(executionId: string) {
  const root = await getRoot();
  const execs = await root.getDirectoryHandle("executions", { create: true });
  return execs.getDirectoryHandle(executionId, { create: true });
}

async function getDatasetDir(executionId: string, datasetId: string) {
  const execDir = await getExecutionDir(executionId);
  return execDir.getDirectoryHandle(datasetId, { create: true });
}
```

`{ create: true }` means: create this directory if it doesn't exist, otherwise open the existing one. It's idempotent.

**`writeDataset()` — Writing rows to OPFS:**

```typescript
export async function writeDataset(opts: {
  executionId: string;
  variableName: string;
  rows: DatasetRow[];
  schema?: DatasetManifest["schema"];
  datasetId?: string;
}): Promise<DatasetManifest> {
  const { executionId, variableName, rows, schema } = opts;
  const datasetId = opts.datasetId ?? createId();
  const dir = await getDatasetDir(executionId, datasetId);
  const now = new Date().toISOString();

  const chunks: DatasetChunkMetadata[] = [];
  let cumulativeRows = 0;
  let totalBytes = 0;

  // Loop: write 10,000 rows at a time
  for (let i = 0; i * CHUNK_SIZE_ROWS < rows.length || i === 0; i++) {
    const start = i * CHUNK_SIZE_ROWS;
    const chunkRows = rows.slice(start, start + CHUNK_SIZE_ROWS);
    if (chunkRows.length === 0) break;

    const fileName = `chunk-${String(i).padStart(6, "0")}.json`;
    // padStart(6, "0") → "000000", "000001", etc. — ensures files sort correctly
    
    const text = JSON.stringify(chunkRows);
    const bytes = new TextEncoder().encode(text);

    const fileHandle = await dir.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(bytes);
    await writable.close();  // IMPORTANT: must close to flush to disk

    cumulativeRows += chunkRows.length;
    totalBytes += bytes.byteLength;
    chunks.push({ chunkIndex: i, fileName, rowStart: start, ... });
  }

  return { version: 1, datasetId, executionId, variableName, rowCount: rows.length, chunks, ... };
}
```

**`readDatasetPage()` — Efficient Pagination:**

This is a key performance optimization. When the user views page 5 of a dataset, we don't read all previous pages:

```typescript
export async function readDatasetPage(
  executionId: string,
  datasetId: string,
  manifest: DatasetManifest,
  page: number,
  pageSize: number,
): Promise<{ rows: DatasetRow[]; totalRows: number; totalPages: number }> {
  const offset = (page - 1) * pageSize; // e.g., page 5, pageSize 100 → offset 400
  const dir = await getDatasetDir(executionId, datasetId);
  const rows: DatasetRow[] = [];
  let skipped = 0;

  for (const chunk of manifest.chunks) {
    if (rows.length >= pageSize) break; // Got enough rows, stop
    
    // Skip chunks that are entirely before our target offset
    if (skipped + chunk.rowCount <= offset) {
      skipped += chunk.rowCount;
      continue; // Don't even read this file
    }

    // This chunk overlaps our target window — read it
    const fileHandle = await dir.getFileHandle(chunk.fileName);
    const file = await fileHandle.getFile();
    const chunkRows = JSON.parse(await file.text()) as DatasetRow[];

    const chunkOffset = offset - skipped; // How many rows to skip within this chunk
    const take = chunkOffset > 0 ? chunkRows.slice(chunkOffset) : chunkRows;
    const needed = pageSize - rows.length;
    rows.push(...take.slice(0, needed));
    skipped += chunk.rowCount;
  }

  return { rows, totalRows: manifest.rowCount, totalPages: Math.ceil(manifest.rowCount / pageSize) };
}
```

**Analogy**: Think of the chunks as pages in a physical book. To get to page 500, you don't read pages 1-499 — you use the table of contents (the manifest's chunk list) to jump directly to the right section.

**`cleanupOrphanedOPFSData()` — Garbage Collection:**

```typescript
export async function cleanupOrphanedOPFSData(): Promise<{ deletedDatasets: number }> {
  // Get all dataset IDs that are registered in IndexedDB
  const records = await db.datasets.toArray();
  const validPaths = new Set(records.map((r) => `${r.executionId}/${r.id}`));

  let deletedDatasets = 0;
  const root = await getRoot();
  const execs = await root.getDirectoryHandle("executions", { create: false });

  // Walk all execution directories in OPFS
  for await (const [execId, execEntry] of execs.entries()) {
    if (execEntry.kind !== "directory") continue;
    for await (const [dsId, dsEntry] of execEntry.entries()) {
      if (dsEntry.kind !== "directory") continue;
      // If this dataset directory has no IndexedDB record, delete it
      if (!validPaths.has(`${execId}/${dsId}`)) {
        await execEntry.removeEntry(dsId, { recursive: true });
        deletedDatasets++;
      }
    }
  }
  return { deletedDatasets };
}
```

Why do orphaned datasets exist? When a sort or join worker crashes mid-way, it may have written temporary OPFS datasets that never got registered in IndexedDB. This function cleans those up.

### `src/lib/worker-manager.ts` — The Worker Pool

This is the bridge between the main thread and the Web Workers.

**The two core data structures:**

```typescript
// One Worker instance per job type (lazy-created)
const workerPool = new Map<WorkerJobType, Worker>();

// Tracks all in-flight jobs by ID, with their resolve/reject callbacks
const pendingJobs = new Map<string, PendingJob<any>>();
```

**How a job is dispatched:**

```typescript
export function dispatchWorkerJob<TInput, TOutput>(
  type: WorkerJobType,
  input: TInput,
  onProgress?: (progress: number, message?: string) => void,
  transfer?: Transferable[],
): Promise<TOutput> {
  return new Promise<TOutput>((resolve, reject) => {
    const jobId = createId(); // Unique ID for this job (e.g. "abc123xyz")
    
    // Store the resolve/reject callbacks — they'll be called when the worker responds
    pendingJobs.set(jobId, { resolve, reject, onProgress });
    
    const worker = getOrCreateWorker(type); // Get or create the worker for this type
    
    // Inject performance settings (workers can't read localStorage)
    const perfSettings = getPerformanceSettings();
    const enrichedInput = { ...perfSettings, ...input } as TInput;
    
    // Send the job to the worker
    const message: WorkerJobMessage<TInput> = { jobId, type, input: enrichedInput };
    worker.postMessage(message, transfer ?? []);
  });
}
```

**How responses are handled:**

```typescript
worker.onmessage = (event: MessageEvent<WorkerOutboundMessage>) => {
  const msg = event.data;
  const pending = pendingJobs.get(msg.jobId);
  if (!pending) return;

  if (msg.kind === "progress") {
    // Just a status update — call the progress callback, keep the job in pendingJobs
    pending.onProgress?.(msg.progress, msg.message);
  } else if (msg.kind === "result") {
    // Job is done — resolve the Promise and remove from pendingJobs
    pendingJobs.delete(msg.jobId);
    pending.resolve(msg.output);
  } else if (msg.kind === "error") {
    // Job failed — reject the Promise
    pendingJobs.delete(msg.jobId);
    pending.reject(new Error(msg.error));
  }
};
```

**Why one Worker per type?**

Each CSV operation (parse, sort, join, etc.) runs in its own dedicated worker thread. This means:
1. A long-running sort doesn't block a filter running in parallel
2. Workers are reused across multiple jobs of the same type (no spawn overhead)
3. If a worker crashes (unhandled error), only jobs of that type are affected

**Worker crash handling:**

```typescript
worker.onerror = (event) => {
  // Reject ALL pending jobs that were dispatched to this worker
  for (const [jobId, pending] of pendingJobs.entries()) {
    pending.reject(new Error(`Worker ${type} crashed: ${event.message}`));
    pendingJobs.delete(jobId);
  }
  // Remove the crashed worker so a fresh one is created next time
  workerPool.delete(type);
};
```

### `src/lib/execution-engine.ts` — The Workflow Orchestrator

This is the brain of the application. When you click "Run," this file takes over.

**Types defined here:**

```typescript
// The shared context passed between nodes
// Like a bag of variables: { parsedData: DatasetRef, filteredData: DatasetRef, ... }
export type ExecutionContext = Record<string, unknown>;

// What every node executor must implement
export type NodeExecutor = (
  nodeId: string,
  nodeData: Record<string, unknown>,  // The node's configuration (from the dialog form)
  context: ExecutionContext,           // Variables produced by previous nodes
  executionId: string,
  onProgress: (progress: number, message?: string) => void,
) => Promise<ExecutionContext>;        // Returns new variables to add to the context
```

**The executor registry:**

```typescript
const executorRegistry: Partial<Record<NodeType, () => Promise<NodeExecutor>>> = {
  [NodeType.CSV_PARSE]: () =>
    import("@/features/executions/components/csv-parse/executor").then((m) => m.executor),
  [NodeType.CSV_SORT]: () =>
    import("@/features/executions/components/csv-sort/executor").then((m) => m.executor),
  // ... 13 total
};
```

Each entry is a **function that returns a Promise of an executor**. The function calls `import()` (dynamic import) — the module is downloaded from the server/cache only when needed. This means:
- If your workflow has only CSV_PARSE and CSV_SORT, the code for CSV_JOIN (and all other executors) is never downloaded
- First execution of each node type has a tiny download delay; subsequent executions are instant (cached)

**`sortNodes()` — Topological Sort:**

Before running a workflow, nodes must be executed in the correct order. A node that depends on another node's output must run after it.

```typescript
function sortNodes(nodes: Node[], edges: Edge[]): Node[] {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map<string, string[]>(); // nodeId → [child nodeIds]
  const hasParent = new Set<string>(); // nodeIds that have at least one incoming edge

  // Build the graph
  for (const n of nodes) children.set(n.id, []);
  for (const e of edges) {
    if (nodeById.has(e.source) && nodeById.has(e.target)) {
      children.get(e.source)?.push(e.target);
      hasParent.add(e.target);
    }
  }

  const visited = new Set<string>();
  const result: string[] = [];

  // DFS post-order traversal
  const dfs = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const kids = children.get(id) ?? [];
    // Traverse children in reverse so first child wins after reversal
    for (let i = kids.length - 1; i >= 0; i--) dfs(kids[i]);
    result.push(id); // Push AFTER visiting all children (post-order)
  };

  // Start DFS from all root nodes (nodes with no parents)
  for (const n of nodes) {
    if (!hasParent.has(n.id)) dfs(n.id);
  }

  result.reverse(); // Post-order + reverse = topological order
  return result.map((id) => nodeById.get(id)!).filter(Boolean);
}
```

**How DFS topological sort works (simple example):**

```
Workflow:  A → B → D
                ↘
           C → E
```

DFS from A:
1. Visit A → recurse into B
2. Visit B → recurse into D
3. Visit D → no children → push D → result: [D]
4. Back to B → recurse into E
5. Visit E → no children → push E → result: [D, E]
6. Back to B → push B → result: [D, E, B]
7. Back to A → push A → result: [D, E, B, A]
8. Visit C → recurse into E (already visited, skip) → push C → result: [D, E, B, A, C]
9. Reverse → [C, A, B, E, D]

Execution order: C, A, B, E, D — every node runs after its dependencies.

**`toSerializable()` — Stripping ArrayBuffers:**

```typescript
function toSerializable(val: unknown): unknown {
  if (val instanceof ArrayBuffer || ArrayBuffer.isView(val)) return undefined;
  if (typeof val !== "object" || val === null) return val;
  if (Array.isArray(val)) return val.map(toSerializable);
  return Object.fromEntries(
    Object.entries(val as Record<string, unknown>)
      .map(([k, v]) => [k, toSerializable(v)])
      .filter(([, v]) => v !== undefined),
  );
}
```

The execution context can contain `ArrayBuffer` objects (e.g., a PDF file in memory). IndexedDB can store them, but they can be very large. When storing a node's output to IndexedDB, this function strips all `ArrayBuffer`s out — only metadata and small values are stored. The actual data lives in OPFS.

**`runWorkflow()` — The Main Loop:**

```typescript
export async function runWorkflow(
  workflowId: string,
  nodes: Node[],
  edges: Edge[],
  callbacks: ExecutionCallbacks,
  signal?: AbortSignal,
): Promise<string> {
  const executionId = createId();

  // 1. Create the execution record in IndexedDB immediately
  await db.executions.add({
    id: executionId,
    workflowId,
    status: "RUNNING",
    startedAt: new Date().toISOString(),
  });

  // 2. Notify the UI so it can start watching for updates
  callbacks.onExecutionCreated(executionId);
  callbacks.onWorkflowStatusChange("running");

  const context: ExecutionContext = {};
  const sortedNodes = sortNodes(nodes, edges);

  try {
    // 3. Execute nodes in topological order
    for (const node of sortedNodes) {
      // Check if user cancelled
      if (signal?.aborted) throw new DOMException("Workflow cancelled", "AbortError");

      const nodeType = node.type as NodeType;

      // Skip trigger nodes (they don't do any processing)
      if (nodeType === NodeType.INITIAL || nodeType === NodeType.MANUAL_TRIGGER) {
        if (nodeType === NodeType.MANUAL_TRIGGER) callbacks.onNodeStatusChange(node.id, "success");
        continue;
      }

      const loadExecutor = executorRegistry[nodeType];
      if (!loadExecutor) { console.warn("No executor for", nodeType); continue; }

      // 4. Mark node as running
      callbacks.onNodeStatusChange(node.id, "running");

      // 5. Persist a node output record as RUNNING
      const outputId = createId();
      const nodeStartedAt = new Date().toISOString();
      await db.executionNodeOutputs.add({
        id: outputId, executionId, nodeId: node.id, nodeType,
        status: "RUNNING", startedAt: nodeStartedAt,
      });

      try {
        // 6. Download and run the executor
        const executor = await loadExecutor();
        const newVars = await executor(
          node.id,
          node.data as Record<string, unknown>,
          context,       // Pass the current context (all previous outputs)
          executionId,
          (progress, message) => callbacks.onProgress(node.id, progress, message),
        );

        // 7. Merge new variables into the context for downstream nodes
        Object.assign(context, newVars);

        // 8. Find all DatasetRefs in the output to persist their manifests
        const allDatasetRefs = Object.values(newVars).filter(
          (v): v is DatasetRef => isDatasetRef(v)
        );

        // 9. Update the node output record with results
        const nodeFinishedAt = new Date().toISOString();
        await db.executionNodeOutputs.update(outputId, {
          status: "SUCCESS",
          variableName: allDatasetRefs[0]?.variableName,
          datasetId: allDatasetRefs[0]?.datasetId,
          inlineOutput: toSerializable(inlineVars), // Small non-dataset outputs
          finishedAt: nodeFinishedAt,
          durationMs: ...,
        });

        // 10. Persist all dataset manifests to IndexedDB
        for (const ref of allDatasetRefs) {
          const manifest = newVars[`${ref.variableName}_manifest`];
          if (manifest) await db.datasets.add({ id: ref.datasetId, executionId, variableName: ref.variableName, manifest });
        }

        callbacks.onNodeStatusChange(node.id, "success");

      } catch (nodeError) {
        // 11. Node failed — record the error and stop the workflow
        await db.executionNodeOutputs.update(outputId, { status: "FAILED", error: String(nodeError), ... });
        callbacks.onNodeStatusChange(node.id, "error");
        throw nodeError; // Re-throw to bubble up to outer try/catch
      }
    }

    // 12. All nodes succeeded
    await db.executions.update(executionId, { status: "SUCCESS", completedAt: new Date().toISOString() });
    callbacks.onWorkflowStatusChange("success");

  } catch (err) {
    // 13. Handle cancellation or error
    const isCancelled = err instanceof DOMException && err.name === "AbortError";
    await db.executions.update(executionId, {
      status: "FAILED",
      completedAt: new Date().toISOString(),
      error: isCancelled ? "Cancelled" : String(err),
    });
    callbacks.onWorkflowStatusChange("error");
    if (!isCancelled) callbacks.onError(String(err));
  }

  return executionId;
}
```

### `src/lib/performance-settings.ts` — User-Tunable Limits

```typescript
export type PerformanceSettings = {
  chunkSize: number;      // Rows per OPFS chunk (default 10,000)
  maxUnionRows: number;   // Max rows for in-memory join dedup (default 500,000)
};

export const PERFORMANCE_PRESETS = {
  balanced:    { label: "Balanced",    minRamGb: 4,  chunkSize: 10_000,  maxUnionRows: 500_000   },
  performance: { label: "Performance", minRamGb: 8,  chunkSize: 25_000,  maxUnionRows: 2_000_000 },
  maximum:     { label: "Maximum",     minRamGb: 16, chunkSize: 50_000,  maxUnionRows: 5_000_000 },
};

export function getPerformanceSettings(): PerformanceSettings {
  if (typeof window === "undefined") return { ...DEFAULT_PERFORMANCE_SETTINGS };
  const raw = localStorage.getItem("autopilot:performance-settings");
  if (!raw) return { ...DEFAULT_PERFORMANCE_SETTINGS };
  const parsed = JSON.parse(raw) as Partial<PerformanceSettings>;
  return {
    chunkSize: parsed.chunkSize ?? DEFAULT_PERFORMANCE_SETTINGS.chunkSize,
    maxUnionRows: parsed.maxUnionRows ?? DEFAULT_PERFORMANCE_SETTINGS.maxUnionRows,
  };
}
```

**Why can't workers read localStorage directly?**

Web Workers run in a completely separate thread with a different global scope. They don't have access to `window`, `document`, or `localStorage`. So performance settings are read on the main thread and **injected into every worker job** via `postMessage`:

```typescript
// In worker-manager.ts dispatchWorkerJob():
const perfSettings = getPerformanceSettings();
const enrichedInput = { ...perfSettings, ...input }; // Merge settings into input
worker.postMessage({ jobId, type, input: enrichedInput });
```

Inside the worker, `input.chunkSize` gives the user's configured chunk size.

---

## 3.4 `src/workers/` — Every Worker Explained

### `src/workers/_opfs-helpers.ts` — Shared Worker Utilities

This file is imported by every worker. It provides OPFS read/write functions that work from inside a Worker thread.

**`readChunkFromOPFS()`** — Read a single chunk:
```typescript
export async function readChunkFromOPFS(
  executionId: string,
  datasetId: string,
  chunkIndex: number,
): Promise<DatasetRow[]> {
  const dir = await getDatasetDir(executionId, datasetId, false);
  const fileName = `chunk-${String(chunkIndex).padStart(6, "0")}.json`;
  const fh = await dir.getFileHandle(fileName);
  return JSON.parse(await (await fh.getFile()).text()) as DatasetRow[];
}
```

**`ChunkedOPFSWriter`** — The key streaming writer class:

```typescript
export class ChunkedOPFSWriter {
  private buffer: DatasetRow[] = [];
  private chunkIndex = 0;
  private totalRows = 0;
  private totalBytes = 0;
  private readonly chunks: OPFSChunkMeta[] = [];

  constructor(
    private readonly executionId: string,
    private readonly datasetId: string,
    private readonly chunkSize = 10_000,
  ) {}

  async init(): Promise<void> {
    // Create the OPFS directory
    this.dir = await getDatasetDir(this.executionId, this.datasetId, true);
  }

  async write(rows: DatasetRow[]): Promise<void> {
    // Add rows to the buffer one by one (avoids stack overflow from large spreads)
    for (const row of rows) this.buffer.push(row);
    // Flush whenever the buffer is full
    while (this.buffer.length >= this.chunkSize) {
      await this._flush(this.buffer.splice(0, this.chunkSize));
    }
  }

  async forceFlush(): Promise<void> {
    if (this.buffer.length > 0) await this._flush(this.buffer.splice(0));
  }

  async finish(): Promise<{ chunks: OPFSChunkMeta[]; totalBytes: number; totalRows: number }> {
    if (this.buffer.length > 0) await this._flush(this.buffer);
    return { chunks: this.chunks, totalBytes: this.totalBytes, totalRows: this.totalRows };
  }

  private async _flush(rows: DatasetRow[]): Promise<void> {
    const fn = `chunk-${String(this.chunkIndex).padStart(6, "0")}.json`;
    const bytes = new TextEncoder().encode(JSON.stringify(rows));
    const w = await (await this.dir.getFileHandle(fn, { create: true })).createWritable();
    await w.write(bytes);
    await w.close(); // Must close to persist!
    this.chunks.push({ chunkIndex: this.chunkIndex, fileName: fn, rowStart: this.totalRows, rowEnd: this.totalRows + rows.length - 1, rowCount: rows.length, cumulativeRowCount: this.totalRows + rows.length, byteSize: bytes.byteLength, createdAt: this.createdAt });
    this.totalBytes += bytes.byteLength;
    this.totalRows += rows.length;
    this.chunkIndex++;
  }
}
```

**Usage pattern** (used in every streaming worker):
```typescript
const writer = new ChunkedOPFSWriter(executionId, datasetId, chunkSize);
await writer.init();

// Stream data in:
for (let c = 0; c < inputRef.chunkCount; c++) {
  const chunk = await readChunkFromOPFS(inputRef.executionId, inputRef.datasetId, c);
  const processed = chunk.filter(/* or transform */);
  await writer.write(processed); // Automatically flushes to OPFS when buffer fills
}

const { chunks, totalBytes, totalRows } = await writer.finish();
```

The writer buffers rows and writes to OPFS in complete chunks. The caller never needs to think about chunk boundaries.

### `src/workers/csv-parse.worker.ts` — Streaming CSV Parser

**Purpose**: Take a raw CSV file (as an `ArrayBuffer`) and write it to OPFS as JSON chunks, inferring the schema.

**The streaming parse pattern:**

```typescript
Papa.parse<DatasetRow>(blob, {
  header: true,           // First row is headers
  skipEmptyLines: true,
  dynamicTyping: false,   // Keep everything as strings (we infer types separately)
  delimiter: explicitDelimiter, // "" = auto-detect

  step: (result, parser) => {
    // Called once per row
    const row = result.data as DatasetRow;
    rowBuffer.push(row);

    // Collect a sample for schema inference
    if (schemaSample.length < 1000) schemaSample.push(row);

    if (rowBuffer.length >= chunkSize) {
      // Buffer full — pause the parser and flush to OPFS
      parser.pause();
      const toFlush = rowBuffer;
      rowBuffer = [];
      
      // Report progress based on byte position in file
      const progress = Math.round(10 + (cursor / blobSize) * 75);
      post({ kind: "progress", jobId, progress, message: `Parsed ${totalRows.toLocaleString()} rows...` });
      
      flushChunk(toFlush)
        .then(() => parser.resume()) // Resume after write completes
        .catch(reject);
    }
  },

  complete: async () => {
    if (rowBuffer.length > 0) await flushChunk(rowBuffer); // Flush final partial chunk
    resolve();
  },
});
```

**Schema inference:**

```typescript
function inferFieldType(values: unknown[]): DatasetFieldType {
  const sample = values.filter((v) => v !== null && v !== undefined && v !== "");
  if (sample.length === 0) return "null";
  if (sample.every((v) => v === "true" || v === "false")) return "boolean";
  if (sample.every((v) => !Number.isNaN(Number(v)))) return "number";
  if (sample.every((v) => !Number.isNaN(Date.parse(String(v))))) return "date";
  return "string";
}

function inferSchema(rows: DatasetRow[]): DatasetSchema {
  const fields = Object.keys(rows[0]);
  const schema: DatasetSchema = {};
  for (const field of fields) {
    const values = rows.map((r) => r[field]);
    schema[field] = {
      type: inferFieldType(values),
      nullable: values.some((v) => v === null || v === undefined || v === ""),
      sampleValues: values.filter(v => v !== null && v !== "").slice(0, 5).map(String),
    };
  }
  return schema;
}
```

Schema inference looks at the first 1,000 rows as a sample. For each column, it tries to determine the type by checking if all non-empty values match number/boolean/date patterns. This schema is attached to the `DatasetManifest` and `DatasetRef`, and used later by the UI to suggest appropriate filter operators and sort types.

**No-header mode**: When `hasHeader` is false, PapaParse returns arrays instead of objects. The worker generates column names: `col_0`, `col_1`, `col_2`, etc., then builds objects from those names.

### `src/workers/csv-sort.worker.ts` — External Merge Sort

This is the most algorithmically complex worker. It sorts datasets that can be **larger than available RAM**.

**Why not just `array.sort()`?**

If you have 40 million rows, loading them all into memory would require gigabytes of RAM. The browser tab would crash. Instead, the algorithm does an **external merge sort** — the same algorithm databases use internally.

**Phase 1: Create Sorted Runs**

```
Input:  [chunk0][chunk1][chunk2]...[chunk255]  (256 chunks of 10K rows = 2.56M rows)

MERGE_FACTOR = 64  (read 64 chunks at a time)

Run 0: read chunks 0-63   → sort in memory → write sorted run to temp OPFS dataset
Run 1: read chunks 64-127 → sort in memory → write sorted run to temp OPFS dataset
Run 2: read chunks 128-191 → sort in memory → write sorted run to temp OPFS dataset
Run 3: read chunks 192-255 → sort in memory → write sorted run to temp OPFS dataset
```

Each run = 640K rows sorted in memory (64 chunks × 10K rows). Memory peak = 640K rows × ~100 bytes = ~64MB. Very manageable.

```typescript
const MERGE_FACTOR = 64;
const MAX_ROWS_PER_SORT_RUN = 640_000;

// Dynamically adjust MERGE_FACTOR based on actual chunk sizes
const mergeFactor = Math.max(1, Math.min(
  MERGE_FACTOR,
  Math.floor(MAX_ROWS_PER_SORT_RUN / estimatedInputChunkRows)
));

for (let run = 0; run < numRuns; run++) {
  const buf: DatasetRow[] = [];
  // Load MERGE_FACTOR chunks into memory
  for (let c = srcFrom; c < srcTo; c++) {
    const chunk = await readChunkFromOPFS(inputRef.executionId, inputRef.datasetId, c);
    for (const row of chunk) buf.push(row);
  }
  // Sort in memory using the comparator
  buf.sort(cmp);
  // Write sorted run to temp OPFS dataset
  runChunkStart[run] = totalRunChunks;
  runChunkCount[run] = Math.ceil(buf.length / chunkSize) || 1;
  await runWriter.write(buf);
  await runWriter.forceFlush(); // Ensure clean chunk boundary
}
```

**Phase 2: K-Way Merge with Min-Heap**

Now we have 4 sorted runs. We need to merge them into one sorted output.

```
Run 0: [A, B, E, F, ...]  (sorted)
Run 1: [C, D, G, H, ...]  (sorted)
Run 2: [B, B, C, E, ...]  (sorted)
Run 3: [A, D, F, G, ...]  (sorted)
```

A **min-heap** (priority queue) is used. It always gives you the smallest element across all runs in O(log k) time where k = number of runs.

```typescript
class MinHeap {
  private h: HeapEntry[] = [];
  constructor(private cmp: (a: DatasetRow, b: DatasetRow) => number) {}

  push(e: HeapEntry): void {
    this.h.push(e);
    let i = this.h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1; // Parent index
      if (this.cmp(this.h[i].row, this.h[p].row) >= 0) break; // Already in order
      [this.h[i], this.h[p]] = [this.h[p], this.h[i]]; // Swap
      i = p;
    }
  }

  pop(): HeapEntry | undefined {
    const top = this.h[0]; // Minimum element
    const last = this.h.pop() as HeapEntry;
    if (this.h.length) {
      this.h[0] = last; // Put last element at top
      // Sift down to restore heap property
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = 2 * i + 2;
        let min = i;
        if (l < this.h.length && this.cmp(this.h[l].row, this.h[min].row) < 0) min = l;
        if (r < this.h.length && this.cmp(this.h[r].row, this.h[min].row) < 0) min = r;
        if (min === i) break;
        [this.h[i], this.h[min]] = [this.h[min], this.h[i]];
        i = min;
      }
    }
    return top;
  }
}
```

**Analogy**: Imagine you have 4 sorted piles of cards face-up. You look at the top card of each pile, pick the smallest, add it to your output pile, then look at the new top cards. The min-heap automates this "look at all tops and pick the smallest" step efficiently.

**The merge loop:**
```typescript
// Initialize: put the first row of each run into the heap
for (let r = 0; r < numRuns; r++) {
  const data = await readChunkFromOPFS(executionId, runDatasetId, runChunkStart[r]);
  cursorMap.set(r, { run: r, chunkInRun: 0, data, pos: 0 });
  heap.push({ row: data[0], runIdx: r });
}

while (heap.size > 0) {
  const { row, runIdx } = heap.pop()!; // Get smallest row globally
  outBatch.push(row);
  
  const cur = cursorMap.get(runIdx)!;
  cur.pos++;
  
  if (cur.pos < cur.data.length) {
    // More rows in current chunk of this run
    heap.push({ row: cur.data[cur.pos], runIdx });
  } else {
    // Current chunk exhausted — load next chunk
    cur.chunkInRun++;
    if (cur.chunkInRun < runChunkCount[cur.run]) {
      cur.data = await readChunkFromOPFS(executionId, runDatasetId, runChunkStart[cur.run] + cur.chunkInRun);
      cur.pos = 0;
      if (cur.data.length) heap.push({ row: cur.data[0], runIdx });
    }
    // If no more chunks in this run, it just drops out of the merge
  }
  
  if (outBatch.length >= chunkSize) {
    await writer.write(outBatch.splice(0)); // Write output chunk
  }
}

// Clean up temp OPFS dataset (the sorted runs)
await deleteDatasetFromOPFS(executionId, runDatasetId);
```

**The comparator:**
```typescript
function makeComparator(
  sortColumns: { field: string; direction: "asc" | "desc" }[],
  compareAs: string,
  nullsPos: "first" | "last",
) {
  return (a: DatasetRow, b: DatasetRow): number => {
    for (const col of sortColumns) {
      const ra = a[col.field], rb = b[col.field];
      const aNull = ra === null || ra === undefined || ra === "";
      const bNull = rb === null || rb === undefined || rb === "";

      // Handle nulls
      if (aNull && bNull) continue;
      if (aNull) return nullsPos === "first" ? -1 : 1;
      if (bNull) return nullsPos === "first" ? 1 : -1;

      let cmp: number;
      if (compareAs === "number") {
        cmp = Number(ra) - Number(rb);
      } else if (compareAs === "date") {
        cmp = Date.parse(String(ra)) - Date.parse(String(rb));
      } else {
        cmp = String(ra) < String(rb) ? -1 : String(ra) > String(rb) ? 1 : 0;
      }

      if (cmp !== 0) return col.direction === "asc" ? cmp : -cmp;
    }
    return 0;
  };
}
```

Multi-column sort: try each column in order, stop as soon as one column differentiates the two rows.

### `src/workers/csv-filter.worker.ts` — Streaming Filter

The simplest worker. Reads chunks one at a time, filters rows, writes to a new dataset.

```typescript
for (let c = 0; c < inputRef.chunkCount; c++) {
  const chunk = await readChunkFromOPFS(inputRef.executionId, inputRef.datasetId, c);

  const filtered = chunk.filter((row) =>
    logic === "AND"
      ? conditions.every((cond) => applyFilter(row, cond))
      : conditions.some((cond) => applyFilter(row, cond))
  );

  await writer.write(filtered);
}
```

**Filter operators:**
```typescript
function applyFilter(row: DatasetRow, condition: FilterCondition): boolean {
  const cell = String(row[condition.field] ?? "");
  const val = condition.value ?? "";
  switch (condition.operator) {
    case "equals":                return cell === val;
    case "not_equals":            return cell !== val;
    case "contains":              return cell.includes(val);
    case "not_contains":          return !cell.includes(val);
    case "starts_with":           return cell.startsWith(val);
    case "ends_with":             return cell.endsWith(val);
    case "greater_than":          return Number(cell) > Number(val);
    case "less_than":             return Number(cell) < Number(val);
    case "greater_than_or_equal": return Number(cell) >= Number(val);
    case "less_than_or_equal":    return Number(cell) <= Number(val);
    case "is_empty":              return cell === "";
    case "is_not_empty":          return cell !== "";
    default: return true;
  }
}
```

**Memory**: Constant. Only one chunk (10K rows) in memory at any time.

### `src/workers/csv-aggregate.worker.ts` — Streaming Group-By

Groups rows and computes aggregations. Like SQL's `GROUP BY` + aggregate functions.

**The accumulator pattern:**

Instead of loading all rows and then grouping, it maintains running totals for each group:

```typescript
const accumulators = new Map<string, Accumulator>();
// key = pipe-separated group field values, e.g. "France|Electronics"

for (let c = 0; c < inputRef.chunkCount; c++) {
  const chunk = await readChunkFromOPFS(...);
  for (const row of chunk) {
    const key = groupByFields.map((f) => String(row[f] ?? "")).join("|");
    
    if (!accumulators.has(key)) {
      accumulators.set(key, { groupValues: {}, sums: {}, counts: {}, ... });
    }
    
    const acc = accumulators.get(key)!;
    acc.rowCount++;
    
    for (const agg of aggregations) {
      switch (agg.func) {
        case "sum": acc.sums[alias] = (acc.sums[alias] ?? 0) + Number(row[agg.field]); break;
        case "avg": acc.sums[alias] += Number(row[agg.field]); acc.numCounts[alias]++; break;
        case "min": acc.mins[alias] = Math.min(acc.mins[alias] ?? Infinity, Number(row[agg.field])); break;
        case "max": acc.maxs[alias] = Math.max(acc.maxs[alias] ?? -Infinity, Number(row[agg.field])); break;
        case "count": acc.counts[alias]++; break;
        case "count_distinct":
          if (!acc.distincts[alias]) acc.distincts[alias] = new Set();
          if (acc.distincts[alias].size < 100_000) acc.distincts[alias].add(String(row[agg.field]));
          break;
        case "first": if (acc.firsts[alias] === undefined) acc.firsts[alias] = row[agg.field]; break;
        case "last": acc.lasts[alias] = row[agg.field]; break;
      }
    }
  }
}

// Convert accumulators to output rows
const result: DatasetRow[] = [];
for (const acc of accumulators.values()) {
  const out: DatasetRow = { ...acc.groupValues };
  for (const agg of aggregations) {
    if (agg.func === "avg") out[alias] = acc.sums[alias] / acc.numCounts[alias];
    else if (agg.func === "count_distinct") {
      const s = acc.distincts[alias];
      out[alias] = s.size >= 100_000 ? `≥100000` : s.size;
    }
    // ... etc
  }
  result.push(out);
}
```

**Memory**: O(number of distinct groups). If you group 10M rows by country (200 countries), only 200 accumulator objects are in memory at once. If you group by user ID (1M unique users), 1M accumulators would be in memory — that's the limitation.

### `src/workers/csv-deduplicate.worker.ts` — Two-Pass Deduplication

**Pass 1** — Count how many times each key appears:
```typescript
const counts = new Map<string, number>();
for (let c = 0; c < inputRef.chunkCount; c++) {
  const chunk = await readChunkFromOPFS(...);
  for (const row of chunk) {
    const key = column ? String(row[column] ?? "") : JSON.stringify(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
}
```

**Pass 2** — Emit first occurrence of each key to "unique" output; emit keys with count ≥ 2 to "duplicates" output:
```typescript
const seen = new Set<string>();
for (let c = 0; c < inputRef.chunkCount; c++) {
  const chunk = await readChunkFromOPFS(...);
  for (const row of chunk) {
    const key = computeKey(row);
    if (seen.has(key)) continue; // Skip non-first occurrences entirely
    seen.add(key);
    
    await uniqueWriter.write([row]); // Always add first occurrence to unique
    
    if ((counts.get(key) ?? 1) >= 2) {
      // Add to duplicates output with count
      const duplicateRow = column
        ? { [column]: row[column], count: counts.get(key) }
        : { ...row, count: counts.get(key) };
      await duplicatesWriter.write([duplicateRow]);
    }
  }
}
```

**Two output datasets:**
- `variableName` = the duplicate rows (with a `count` column)
- `variableName_unique` = the deduplicated dataset (first occurrence of each key)

**Memory**: O(distinct keys) for the `counts` Map and `seen` Set. For a dataset with 1M rows but only 100K distinct keys, memory usage is proportional to 100K entries.

### `src/workers/csv-join.worker.ts` — Adaptive Hash Join

Supports 5 join types: `inner`, `left`, `right`, `full`, `cross`.

**Cross join** (simplest — and most dangerous for large datasets):
```typescript
const right = await readFromOPFS(rightRef.executionId, rightRef.datasetId, rightRef.chunkCount);
for (let c = 0; c < leftRef.chunkCount; c++) {
  const leftChunk = await readChunkFromOPFS(...);
  const batch: DatasetRow[] = [];
  for (const l of leftChunk) for (const r of right) batch.push({ ...l, ...r });
  await writer.write(batch);
}
```

Output = `leftRows × rightRows`. 1000 left × 1000 right = 1,000,000 output rows. This is why cross joins are dangerous.

**Small right side (≤ 500K rows) — Hash join:**
```typescript
// Phase 1: Load entire right dataset into a hash map
const right = await readFromOPFS(rightRef.executionId, rightRef.datasetId, rightRef.chunkCount);
const rightMap = new Map<string, DatasetRow[]>();
for (const r of right) {
  const key = String(r[rightKey] ?? "");
  if (rightMap.has(key)) rightMap.get(key)!.push(r);
  else rightMap.set(key, [r]);
}

// Phase 2: Stream left side, look up matches
for (let c = 0; c < leftRef.chunkCount; c++) {
  const leftChunk = await readChunkFromOPFS(...);
  for (const l of leftChunk) {
    const key = String(l[leftKey] ?? "");
    const matches = rightMap.get(key) ?? [];
    if (matches.length > 0) {
      for (const r of matches) batch.push({ ...l, ...r }); // Inner join match
    } else if (joinType === "left" || joinType === "full") {
      batch.push({ ...l }); // Left join: keep left row with no right match
    }
  }
}

// For right/full joins: emit unmatched right rows
if (joinType === "right" || joinType === "full") {
  for (const r of right) {
    if (!matchedRightKeys.has(rowKeyRight(r))) batch.push({ ...r });
  }
}
```

**Large right side — Grace Hash Join:**

When the right dataset exceeds 500K rows, loading it entirely would use too much RAM. Grace hash join partitions both datasets by key hash:

```typescript
const K = Math.ceil(rightRef.rowCount / PARTITION_THRESHOLD); // Number of partitions

// Phase 1: Partition right dataset into K buckets by hash(rightKey) % K
const rightPartWriters = Array.from({ length: K }, () => new ChunkedOPFSWriter(...));
for each rightChunk:
  for each row: bucket[hash(key) % K].push(row)
  flush buckets to respective partition writers

// Phase 2: Partition left dataset the same way
// (same hash function ensures matching keys go to the same partition)

// Phase 3: For each partition i (0 to K-1):
//   Load right partition i into memory (≤ ~500K rows)
//   Stream left partition i, looking up matches
//   This is just a standard small hash join now

// Cleanup: delete all partition OPFS datasets
```

**Why this works**: Because matching keys hash to the same partition, left partition `i` only needs to be joined with right partition `i`. Each sub-join is small enough to do in memory.

### `src/workers/csv-compare.worker.ts` — Dataset Diff

Produces **five output datasets**:
- `_added`: rows only in the "compare" dataset (new rows)
- `_removed`: rows only in the "base" dataset (deleted rows)
- `_changed`: rows that exist in both but have different values
- `_common`: rows that are identical in both datasets
- `_schema_diff`: column-level comparison table

The algorithm uses the same small/large adaptive pattern as the join worker:
- Small base (≤ 500K): load base into a Map, stream compare
- Large base: grace hash partitioning

For `_changed`, each row gets prefixed columns:
```
{ _before_salary: "50000", _after_salary: "55000", _before_title: "Engineer", _after_title: "Senior Engineer", ... }
```

### PDF Workers

**`pdf-extract-text.worker.ts`**: Uses `pdfjs-dist` to load a PDF from an `ArrayBuffer` and extract text content page by page. Returns an array of `{ pageNumber, text }` objects.

**`pdf-extract-tables.worker.ts`**: Uses heuristics to identify table structures in PDF text content (rows based on consistent x-coordinates, columns based on whitespace alignment).

---

## 3.5 `src/store/`

### `src/store/execution-status.ts`

These atoms drive the live execution progress panel. The execution engine updates them; React components read them.

```typescript
// Status of each node: "idle" | "running" | "success" | "error"
export const nodeStatusMapAtom = atom<Record<string, NodeStatus>>({});

// Progress percentage + message for each node
export const nodeProgressMapAtom = atom<Record<string, { progress: number; message?: string }>>({});

// Start/end timestamps for each node (milliseconds since workflow started)
export const nodeTimingsAtom = atom<Record<string, { startMs: number; endMs?: number }>>({});

// Overall workflow state
export const workflowExecutionStateAtom = atom<WorkflowExecutionState>("idle");

// ID of the execution that's currently running or being viewed
export const activeExecutionIdAtom = atom<string | null>(null);

// When the current workflow started (Date.now())
export const executionStartedAtAtom = atom<number | null>(null);

// Panel open/collapsed state (persisted to localStorage via StoragePersist)
export const workflowProgressPanelOpenAtom = atom(false);
export const workflowProgressPanelCollapsedAtom = atom(false);

// Write-only atom: batch-reset all execution state
export const resetWorkflowExecutionStateAtom = atom(null, (_get, set) => {
  set(nodeStatusMapAtom, {});
  set(nodeProgressMapAtom, {});
  set(nodeTimingsAtom, {});
  set(workflowExecutionStateAtom, "idle");
  set(activeExecutionIdAtom, null);
  set(executionStartedAtAtom, null);
  set(workflowExecutionResultAtom, null);
  set(workflowExecutionErrorAtom, null);
  set(workflowProgressPanelCollapsedAtom, false);
});
```

**How the execution engine updates these atoms:**

The `runWorkflow()` function receives `ExecutionCallbacks` which include:
```typescript
onNodeStatusChange: (nodeId, status) => {
  set(nodeStatusMapAtom, (prev) => ({ ...prev, [nodeId]: status }));
},
onProgress: (nodeId, progress, message) => {
  set(nodeProgressMapAtom, (prev) => ({ ...prev, [nodeId]: { progress, message } }));
},
```

These callbacks are created in `use-run-workflow.ts` (the hook that calls `runWorkflow`) and closed over the Jotai `set` function.

---

## 3.6 `src/features/`

Features are self-contained domain modules. Each feature has its own components, hooks, and (sometimes) its own store atoms.

### `src/features/editor/`

The workflow editor — the ReactFlow canvas plus its controls.

**`components/editor.tsx` — The Main Canvas**

Key behaviors:

**Auto-save** with debounce:
```typescript
const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

const triggerAutoSave = useCallback(() => {
  if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
  saveTimeoutRef.current = setTimeout(() => {
    autoSave({ workflowId, nodes, edges }); // React Query mutation
  }, 1500); // 1.5 second debounce
}, [workflowId, nodes, edges]);

// Call on every node/edge change:
useEffect(() => {
  if (isInitialLoad.current) { isInitialLoad.current = false; return; }
  triggerAutoSave();
}, [nodes, edges]);
```

**Blocking background refetch overwrites**: When the editor auto-saves, React Query might refetch the workflow data from IndexedDB and try to update the nodes/edges state. This would overwrite the user's unsaved changes. A ref prevents this:
```typescript
const isSavingRef = useRef(false);

// In the auto-save mutation:
onMutate: () => { isSavingRef.current = true; },
onSettled: () => { isSavingRef.current = false; },

// In the data load effect:
useEffect(() => {
  if (isSavingRef.current) return; // Skip — we just saved, don't overwrite
  if (workflowData) { setNodes(workflowData.nodes); setEdges(workflowData.edges); }
}, [workflowData]);
```

**Progress panel resize**:
```typescript
const MIN_PANEL_HEIGHT = 220;
const DEFAULT_PANEL_HEIGHT = 360;
const COLLAPSE_THRESHOLD = 180; // Below this, auto-collapse

let startY: number, startHeight: number;

const onPointerDown = (e: PointerEvent) => {
  startY = e.clientY;
  startHeight = panelHeight;
  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", onPointerUp);
};

const onPointerMove = (e: PointerEvent) => {
  const delta = startY - e.clientY; // Dragging up = positive delta = larger panel
  const newHeight = Math.max(MIN_PANEL_HEIGHT, Math.min(window.innerHeight * 0.95, startHeight + delta));
  setPanelHeight(newHeight);
};

const onPointerUp = () => {
  if (panelHeight < COLLAPSE_THRESHOLD) setCollapsed(true);
};
```

**`components/workflow-progress-panel.tsx` — Live Progress**

This panel reads from Jotai atoms and React Query to show:
- Which nodes are running, done, or failed (color-coded)
- Progress bar for each node
- Timer showing elapsed time per node
- Node execution order
- "Cancel" button (creates an AbortController, passes signal to `runWorkflow`)

**`store/atoms.ts` — Editor Atoms**

```typescript
export const editorAtom = atom<ReactFlowInstance | null>(null);
export const workflowIdAtom = atom<string | null>(null);
export const pendingConnectionAtom = atom<string | null>(null); // For quick-connect
export const quickConnectOpenAtom = atom<boolean>(false);       // Quick-connect sheet
```

`pendingConnectionAtom` stores the ID of a node that the user right-clicked to "quick-connect" from. The `QuickConnectSelector` sheet reads this to show a list of nodes to connect to.

### `src/features/executions/`

**Node Structure — Every Executable Node**

Every node type that can process data follows a consistent 4-file structure:

```
src/features/executions/components/<node-type>/
├── node.tsx      ← React component rendered in the canvas
├── dialog.tsx    ← Configuration form (react-hook-form + Zod)
├── executor.ts   ← Business logic called by the execution engine
└── actions.ts    ← (optional) Helper functions
```

**`node.tsx` pattern:**
```tsx
export function CsvParseNode({ id, data }: NodeProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const nodeStatus = useNodeStatus(id); // Reads from Jotai atom

  return (
    <BaseNode id={id} title="CSV Parse" icon={<TableIcon />} status={nodeStatus}>
      <Button onClick={() => setDialogOpen(true)}>Configure</Button>
      <CsvParseDialog nodeId={id} open={dialogOpen} onClose={() => setDialogOpen(false)} data={data} />
    </BaseNode>
  );
}
```

**`dialog.tsx` pattern:**
```tsx
const schema = z.object({
  csvVariable: z.string().min(1, "Select a file"),
  hasHeader: z.boolean(),
  delimiter: z.string(),
  variableName: z.string().min(1),
});

export function CsvParseDialog({ nodeId, open, onClose, data }) {
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { hasHeader: true, delimiter: "auto", ...data },
  });

  const onSubmit = (values: z.infer<typeof schema>) => {
    // Update node data in the workflow (saves to IndexedDB via auto-save)
    updateNodeData(nodeId, values);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <SourceVariableInput name="csvVariable" label="Input file" />
            <Checkbox name="hasHeader" label="Has header row" />
            <VariableNameInput name="variableName" label="Output variable name" />
            <Button type="submit">Save</Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
```

**`executor.ts` pattern (CSV Parse as canonical example):**
```typescript
export const executor: NodeExecutor = async (
  nodeId,
  nodeData,
  context,
  executionId,
  onProgress,
) => {
  // 1. Read config from nodeData (what the user set in the dialog)
  const { csvVariable, hasHeader, delimiter, variableName } = nodeData as CsvParseConfig;

  // 2. Resolve the input from context (get the actual file buffer)
  const fileBuffer = context[csvVariable] as ArrayBuffer;

  // 3. Dispatch to the worker
  const result = await dispatchWorkerJob<CsvParseInput, CsvParseOutput>(
    "csv-parse",
    { fileBuffer, executionId, variableName, hasHeader, delimiter },
    onProgress,        // Forward progress updates to the UI
    [fileBuffer],      // Transfer the ArrayBuffer (no copy)
  );

  // 4. Return new context variables
  return {
    [variableName]: result.datasetRef,
    [`${variableName}_manifest`]: result.manifest,
  };
};
```

**`csv-shared/` — Shared CSV Utilities**

- **`field-suggestion-input.tsx`**: An input with autocomplete for column names. Reads the schema from upstream nodes via `useUpstreamVariableMetadata`.
- **`source-variable-input.tsx`**: A dropdown to select which context variable to use as input. Shows all DatasetRefs currently in scope.
- **`use-upstream-variable-metadata.ts`**: A hook that traverses the workflow graph backwards from the current node to find all DatasetRef variables and their schemas.
- **`variable-name-input.tsx`**: An input for the output variable name, with auto-suggestion based on the node type.

### `src/features/workflows/`

**`hooks/use-workflows.ts`** — CRUD operations for workflows:

```typescript
export function useCreateWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const id = createId();
      await db.workflows.add({ id, name, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      return id;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: workflowKeys.all }),
  });
}

export function useAutoSaveWorkflow() {
  return useMutation({
    mutationFn: async ({ workflowId, nodes, edges }: AutoSaveInput) => {
      // Update workflow metadata
      await db.workflows.update(workflowId, { updatedAt: new Date().toISOString() });
      // Delete all existing nodes/connections and re-insert current state
      await db.workflowNodes.where("workflowId").equals(workflowId).delete();
      await db.workflowConnections.where("workflowId").equals(workflowId).delete();
      await db.workflowNodes.bulkAdd(nodes.map(n => ({ id: n.id, workflowId, type: n.type, position: n.position, data: n.data })));
      await db.workflowConnections.bulkAdd(edges.map(e => ({ id: e.id, workflowId, fromNodeId: e.source, toNodeId: e.target, fromOutput: e.sourceHandle ?? "default", toInput: e.targetHandle ?? "default" })));
    },
  });
}
```

### `src/features/settings/`

**`components/performance-settings-form.tsx`**

The settings page lets users tune performance parameters. Key UI elements:

- **Preset buttons**: "Balanced (4GB RAM)", "Performance (8GB RAM)", "Maximum (16GB RAM)"
- **Chunk Size slider**: 5,000–100,000 rows per OPFS file
- **Union Row Limit slider**: 100,000–10,000,000 max rows for in-memory join dedup
- **Storage quota display**: Uses `navigator.storage.estimate()` to show how much OPFS space is used
- **Clear executions button**: Deletes all execution records from IndexedDB and their OPFS datasets
- **Cleanup orphaned data button**: Calls `cleanupOrphanedOPFSData()`

---

## 3.7 `src/components/`

### `app-sidebar.tsx`

The left navigation sidebar. Built with shadcn's `Sidebar` component (which wraps Radix's Collapsible). Navigation items:

```tsx
const navItems = [
  { href: "/workflows/", label: "Workflows", icon: <WorkflowIcon /> },
  { href: "/executions/", label: "Executions", icon: <HistoryIcon /> },
  { href: "/settings/documentation/", label: "Documentation", icon: <BookIcon /> },
  { href: "/settings/", label: "Settings", icon: <SettingsIcon /> },
];
```

### `app-header.tsx`

Top navigation bar. Contains:
- Mobile sidebar trigger button
- App name breadcrumb
- Live clock (updates every second with `setInterval`)
- Theme toggle

### `entity-components.tsx`

Shared patterns for listing pages:
- `EmptyView`: Shown when a list is empty ("No workflows yet. Create one to get started.")
- `EntityContainer`: Wrapper with consistent padding/max-width
- `LoadingView`: Skeleton loading states

### `react-flow/base-node.tsx`

The base wrapper for all node components in the canvas. Provides:
- Consistent card styling
- Status indicator (colored dot: gray=idle, blue=running, green=success, red=error)
- The node title and icon
- Input/output connection handles

```tsx
export function BaseNode({ id, title, icon, status, children }: BaseNodeProps) {
  return (
    <div className={cn("node-card", statusClass[status])}>
      <Handle type="target" position={Position.Left} />
      <div className="node-header">
        {icon}
        <span>{title}</span>
        <NodeStatusIndicator status={status} />
      </div>
      <div className="node-body">{children}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
```

### `react-flow/plus-connect-handle.tsx`

The `+` button that appears when hovering near a node's output handle. Clicking it:
1. Sets `pendingConnectionAtom` to the current node's ID
2. Sets `quickConnectOpenAtom` to `true`
3. Opens the `QuickConnectSelector` sheet

The sheet shows a searchable list of node types. Selecting one creates a new node and automatically connects it.

### `pwa-install-prompt.tsx`

Listens for the `beforeinstallprompt` browser event (fired when the app is installable). Saves the event, then shows a "Install App" button. When clicked, calls `event.prompt()` which shows the browser's native install dialog.

### `storage-persist.tsx`

Persists specific Jotai atoms to `localStorage` across page refreshes:
```typescript
// Persists panel open/collapsed state
useEffect(() => {
  localStorage.setItem("autopilot:panelOpen", JSON.stringify(panelOpen));
}, [panelOpen]);
```

---

## 3.8 `src/hooks/`

### `use-entity-search.tsx`

```typescript
export function useEntitySearch(initialSearch = "") {
  const [search, setSearch] = useState(initialSearch);
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(search, 500); // 500ms debounce

  // Reset to page 1 whenever search changes
  useEffect(() => { setPage(1); }, [debouncedSearch]);

  return { search, setSearch, debouncedSearch, page, setPage };
}
```

The 500ms debounce means the query only fires after the user stops typing for half a second — prevents a DB query on every keystroke.

### `use-mobile.ts`

```typescript
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    setIsMobile(mq.matches);
    mq.addEventListener("change", (e) => setIsMobile(e.matches));
  }, []);
  return isMobile;
}
```

Uses `matchMedia` to reactively track whether the viewport is mobile-sized. Triggers when the window is resized past the 768px breakpoint.

---

## 3.9 `src/app/` — All Pages & Layouts

### `src/app/layout.tsx` — Root Layout

This wraps every single page. The provider order matters:

```tsx
export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Script src="/sw-register.js" strategy="afterInteractive" />
        {/* 1. ThemeProvider — must be outermost for dark mode class on <html> */}
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {/* 2. NuqsAdapter — syncs state to URL query params */}
          <NuqsAdapter>
            {/* 3. Jotai Provider — global atom store */}
            <Provider>
              {/* 4. React Query Provider — async data cache */}
              <QueryProvider>
                <LocaleHtmlAttrs />
                {children}
                <Toaster position="top-right" />
                <PwaInstallPrompt />
                <StoragePersist />
              </QueryProvider>
            </Provider>
          </NuqsAdapter>
        </ThemeProvider>
      </body>
    </html>
  );
}
```

`suppressHydrationWarning` on `<html>` prevents React from warning about the `class` attribute being different between server render and client render (the theme class is added client-side by `next-themes`).

### `src/app/(dashboard)/layout.tsx`

```tsx
export default function DashboardLayout({ children }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      {children}
    </SidebarProvider>
  );
}
```

Wraps all dashboard pages with the sidebar. `SidebarProvider` manages sidebar open/closed state.

### `src/app/(dashboard)/(rest)/layout.tsx`

```tsx
export default function RestLayout({ children }) {
  return (
    <div className="flex flex-col flex-1">
      <AppHeader />
      <main className="flex-1 p-4">{children}</main>
    </div>
  );
}
```

Adds the top header bar to all non-editor pages.

### `src/app/(dashboard)/(rest)/workflows/page.tsx`

```tsx
export default function WorkflowsPage() {
  return (
    <Suspense fallback={<WorkflowsPageSkeleton />}>
      <WorkflowsPageContent />
    </Suspense>
  );
}

function WorkflowsPageContent() {
  const params = useWorkflowsParams(); // URL query params (search, page)
  const { data } = useSuspenseWorkflows(params); // Suspends while loading
  return <WorkflowsList workflows={data} />;
}
```

`<Suspense fallback={...}>` shows the skeleton while `useSuspenseWorkflows` is loading. Once data is ready, the real content renders.

### `src/app/(dashboard)/(editor)/workflows/editor/page.tsx`

The workflow editor page. Gets `workflowId` from URL params:
```tsx
export default function EditorPage() {
  const { id } = useSearchParams(); // ?id=abc123
  if (!id) return <Redirect to="/workflows/" />;
  return (
    <Suspense fallback={<EditorSkeleton />}>
      <Editor workflowId={id} />
    </Suspense>
  );
}
```

### `src/app/(dashboard)/(rest)/executions/detail/page.tsx`

```tsx
export default function ExecutionDetailPage() {
  const { id } = useSearchParams(); // ?id=abc123
  return (
    <Suspense fallback={<Skeleton />}>
      <ExecutionDetail executionId={id} />
    </Suspense>
  );
}
```

`ExecutionDetail` fetches:
1. The execution record from IndexedDB (status, timing, error)
2. All node outputs for this execution
3. Dataset viewers for each output dataset (paginated, reads from OPFS)

---

# Part 4 — Complete Data Flow Walkthroughs

## 4.1 Workflow: Upload → Parse → Filter → Export

Step by step, what happens when a user builds this pipeline and clicks Run.

### Step 1: User Configures the Upload File Node

The user clicks the Upload File node's "Configure" button. A dialog opens. They click "Choose File" — this uses the **File System Access API**:

```typescript
const [fileHandle] = await window.showOpenFilePicker({
  types: [{ description: "CSV", accept: { "text/csv": [".csv"] } }],
});
const file = await fileHandle.getFile();
const buffer = await file.arrayBuffer(); // Read file into memory
```

The `ArrayBuffer` is stored in the node's `data` (it persists in memory, not OPFS — the raw file is small enough).

Actually, the Upload File executor stores the file directly to OPFS:
```typescript
// upload-file/executor.ts
const fileId = createId();
const opfsRoot = await navigator.storage.getDirectory();
const uploadsDir = await opfsRoot.getDirectoryHandle("autopilot", { create: true })
  .then(d => d.getDirectoryHandle("uploads", { create: true }));
const fh = await uploadsDir.getFileHandle(fileId, { create: true });
const w = await fh.createWritable();
await w.write(fileBuffer);
await w.close();

return {
  [variableName]: fileBuffer,           // Keep in context for next node
  [`${variableName}_fileId`]: fileId,   // Store reference for cleanup
};
```

### Step 2: User Configures the CSV Parse Node

In the CSV Parse dialog, the user selects `file` as the input variable, checks "Has Header", chooses auto-delimiter, and names the output `parsedData`.

Node data stored in IndexedDB: `{ csvVariable: "file", hasHeader: true, delimiter: "auto", variableName: "parsedData" }`.

### Step 3: User Clicks "Run"

In `use-run-workflow.ts`:
```typescript
const abortController = new AbortController();
setAbortController(abortController);

const executionId = await runWorkflow(
  workflowId,
  nodes,    // Current nodes from ReactFlow
  edges,    // Current edges from ReactFlow
  {
    onExecutionCreated: (id) => {
      set(activeExecutionIdAtom, id);
      set(workflowProgressPanelOpenAtom, true);
    },
    onNodeStatusChange: (nodeId, status) => {
      set(nodeStatusMapAtom, prev => ({ ...prev, [nodeId]: status }));
      if (status === "running") {
        set(nodeTimingsAtom, prev => ({ ...prev, [nodeId]: { startMs: Date.now() - startedAt } }));
      } else if (status === "success" || status === "error") {
        set(nodeTimingsAtom, prev => ({ ...prev, [nodeId]: { ...prev[nodeId], endMs: Date.now() - startedAt } }));
      }
    },
    onProgress: (nodeId, progress, message) => {
      set(nodeProgressMapAtom, prev => ({ ...prev, [nodeId]: { progress, message } }));
    },
    onWorkflowStatusChange: (status) => {
      set(workflowExecutionStateAtom, status === "running" ? "running" : status === "success" ? "success" : "error");
    },
    onError: (error) => {
      set(workflowExecutionErrorAtom, error);
    },
  },
  abortController.signal,
);
```

### Step 4: Topological Sort

```
INITIAL → UPLOAD_FILE → CSV_PARSE → CSV_FILTER → FILE_EXPORT

Sorted order: [INITIAL, UPLOAD_FILE, CSV_PARSE, CSV_FILTER, FILE_EXPORT]
```

### Step 5: INITIAL node — Skip

`nodeType === NodeType.INITIAL` → `continue`. Nothing happens.

### Step 6: UPLOAD_FILE executor runs

- Marks UPLOAD_FILE as "running" in Jotai → progress panel updates
- Reads `fileBuffer` from node data
- Writes file to OPFS at `autopilot/uploads/<fileId>`
- Returns `{ file: fileBuffer, file_fileId: "xyz" }` to context
- `context` is now `{ file: ArrayBuffer, file_fileId: "xyz" }`
- Marks as "success"

### Step 7: CSV_PARSE executor runs

```typescript
// csv-parse/executor.ts
export const executor: NodeExecutor = async (nodeId, nodeData, context, executionId, onProgress) => {
  const { csvVariable, hasHeader, delimiter, variableName } = nodeData as CsvParseConfig;
  const fileBuffer = context[csvVariable] as ArrayBuffer; // Gets the ArrayBuffer from context

  const result = await dispatchWorkerJob<CsvParseInput, CsvParseOutput>(
    "csv-parse",
    { fileBuffer, fileName: "data.csv", executionId, variableName, hasHeader, delimiter },
    onProgress,
    [fileBuffer], // Transfer (no copy)
  );

  return {
    [variableName]: result.datasetRef,
    [`${variableName}_manifest`]: result.manifest,
  };
};
```

**Inside the worker** (`csv-parse.worker.ts`):
1. Creates OPFS directory: `autopilot/executions/<executionId>/<datasetId>/`
2. PapaParse starts reading the `ArrayBuffer`
3. Every 10,000 rows: pause → write chunk to OPFS → resume
4. After all rows: infer schema from first 1000 rows
5. Posts result: `{ datasetRef, manifest, warnings }`

**Back in the engine**:
- `context` now = `{ file: ArrayBuffer, parsedData: DatasetRef, parsedData_manifest: DatasetManifest }`
- Node output persisted to IndexedDB: `{ status: "SUCCESS", variableName: "parsedData", datasetId: "abc" }`
- Dataset manifest persisted: `{ id: "abc", executionId, variableName: "parsedData", manifest: { rowCount: 150000, chunks: [...] } }`

### Step 8: CSV_FILTER executor runs

```typescript
// The executor reads node config and dispatches to csv-filter worker
const inputRef = context[nodeData.inputVariable] as DatasetRef;
const result = await dispatchWorkerJob("csv-filter", {
  inputRef,               // Points to parsedData's OPFS files
  conditions: nodeData.conditions,
  logic: nodeData.logic,
  executionId,
  variableName: nodeData.variableName,
}, onProgress);
```

**Inside the worker**:
- Reads parsedData chunks from OPFS one at a time
- Applies filter: keeps rows where age > 30 (or whatever the user configured)
- Writes matching rows to new OPFS dataset
- Returns new DatasetRef

### Step 9: FILE_EXPORT executor runs

```typescript
// Read all filtered rows from OPFS
const allRows = await readDataset(executionId, inputRef.datasetId, manifest);
// Convert to CSV string
const csv = Papa.unparse(allRows);
// Trigger browser download
const blob = new Blob([csv], { type: "text/csv" });
const url = URL.createObjectURL(blob);
const a = document.createElement("a");
a.href = url;
a.download = "output.csv";
a.click();
URL.revokeObjectURL(url);
```

### Step 10: Workflow completes

- `db.executions.update(executionId, { status: "SUCCESS", completedAt: ... })`
- `workflowExecutionStateAtom` set to "success"
- Progress panel shows green checkmarks for all nodes

---

## 4.2 Workflow: Sorting 10 Million Rows

The sort worker's external merge sort in action.

**Input**: `largeData` DatasetRef with 10M rows in 1000 chunks (10K per chunk).

**Phase 1** (Progress 5%–50%):
- `MERGE_FACTOR = 64` → `numRuns = ceil(1000 / 64) = 16` sorted runs
- Run 0: reads chunks 0-63 (640K rows) → sorts in memory → writes to temp dataset (sorted run 0)
- Run 1: reads chunks 64-127 → sorts → writes sorted run 1
- ...
- Run 15: reads chunks 960-999 → sorts → writes sorted run 15
- Memory peak: 640K rows × ~150 bytes/row ≈ **96 MB**

**Phase 2** (Progress 52%–92%):
- Min-heap initialized with first row from each of the 16 sorted runs
- Heap size = 16 entries
- Loop: pop min row → write to output → advance the cursor in that run → push next row
- Memory at any point: 16 chunks (one per run) + output batch = ~176K rows ≈ **26 MB**
- Total output: 10M rows written to new OPFS dataset

**Cleanup**: Temp run dataset deleted from OPFS.

**Total time** (rough estimate on modern hardware): ~30-60 seconds for 10M rows.

---

## 4.3 User Views a Dataset Page

User opens an execution detail, clicks on a dataset to view rows. They navigate to page 500 (rows 49,901–50,000).

```typescript
// execution-dataset-viewer.tsx
const { data } = useQuery({
  queryKey: ["dataset-page", executionId, datasetId, page, pageSize],
  queryFn: () => readDatasetPage(executionId, datasetId, manifest, page, pageSize),
});
```

Inside `readDatasetPage(... page=500, pageSize=100)`:
- `offset = (500-1) * 100 = 49,900`
- Loop through chunks (each has 10,000 rows):
  - Chunk 0: rows 0-9999. `skipped(0) + 10000 <= 49900`. Skip. `skipped = 10000`
  - Chunk 1: rows 10000-19999. `skipped(10000) + 10000 <= 49900`. Skip. `skipped = 20000`
  - Chunk 2: rows 20000-29999. Skip. `skipped = 30000`
  - Chunk 3: rows 30000-39999. Skip. `skipped = 40000`
  - Chunk 4: rows 40000-49999. `skipped(40000) + 10000 <= 49900`. Skip. `skipped = 50000`

Wait — `40000 + 10000 = 50000 > 49900`, so chunk 4 overlaps! Let me re-trace:
  - Chunk 4: `skipped(40000) + 10000 = 50000 > 49900` → **read this chunk**
  - `chunkOffset = 49900 - 40000 = 9900`
  - `take = chunkRows.slice(9900)` = rows 49,900–49,999 (100 rows)
  - `needed = 100`, `rows.push(...take.slice(0, 100))` → done!

Result: Only **1 OPFS file** was read (chunk 4) to serve page 500. Not all 5000 chunks.

---

# Part 5 — Architecture Decisions & Trade-offs

## Why No Server-Side Processing?

**Decision**: All CSV/PDF processing runs in the browser via Web Workers.

**Reasons**:
- **Privacy**: Users' files never leave their machine. Crucial for sensitive data (payroll, medical records, financial data).
- **Cost**: No servers = no infrastructure bill. Scale to 1 million users without additional cost.
- **Simplicity**: No API routes, no authentication, no rate limiting, no server security.
- **Offline**: Works without internet after first load.

**Trade-offs**:
- Limited by the user's device CPU and RAM (can't parallelize across a cluster)
- Workers are single-threaded (one sort at a time, though multiple workers run concurrently)
- Browser tab has memory limits (mitigated by OPFS streaming)

## Why OPFS Over Pure IndexedDB for Row Data?

**Decision**: Row data in OPFS JSON chunks; metadata in IndexedDB.

**Reasons**:
- IndexedDB was designed for structured objects, not large sequential files
- Reading/writing large blobs through IndexedDB is slow (base64 encoding overhead)
- OPFS gives near-native file I/O speed
- Workers can access OPFS directly (crucial for worker-based processing)

**Trade-offs**:
- OPFS files can't be queried (no SQL WHERE clause)
- Must manage chunk metadata manually (the `DatasetManifest` system)
- Data is invisible to users (can't browse with File Explorer)

## Why Jotai Over Redux or Zustand?

**Decision**: Jotai for execution state (real-time updates); React Query for DB-derived state.

**Reasons**:
- Redux: Too much boilerplate for a simple use case (progress tracking)
- Zustand: Store is a single object — all subscribers re-render on any change
- Jotai: Granular subscriptions — `nodeStatusMapAtom` changes only re-render components that use it

**Trade-offs**:
- Atoms are global — harder to isolate state per workflow instance
- Write-only atoms (like `resetWorkflowExecutionStateAtom`) are a non-obvious pattern

## Why External Merge Sort?

**Decision**: Two-phase external merge sort instead of in-memory `Array.sort()`.

**Reasons**:
- `Array.sort()` on 40M rows would require ~6GB RAM → browser crash
- External merge sort keeps memory bounded at ~96MB regardless of input size
- The algorithm was optimized specifically to avoid the original implementation's problems:
  - Old: `Int32Array.sort(compareFn)` with JS callback = ~1 billion function calls for 40M rows
  - New: In-memory sort of 640K-row chunks = far fewer comparisons total
  - Old: Random-order OPFS reads in phase 2 = up to 40M async reads
  - New: Sequential chunk reads = efficient I/O

**Trade-offs**:
- More complex code
- Requires temporary OPFS space (the sorted runs dataset)
- Two passes over the data instead of one

## Why esbuild for Workers?

**Decision**: Bundle workers with esbuild separately from the Next.js build.

**Reasons**:
- Workers are loaded as static files from `public/workers/` — they're not part of the Next.js module graph
- esbuild bundles TypeScript → JavaScript in milliseconds
- Workers use `import` statements (esbuild bundles all imports into one file)
- The `prebuild` npm script ensures workers are always up to date before building

**Trade-offs**:
- Workers don't benefit from Next.js/webpack's HMR (hot module replacement)
- Must run `build-workers.mjs` explicitly when changing worker code in dev

## Why `output: "export"` in Next.js?

**Decision**: Static export (no server) instead of standalone server.

**Reasons**:
- No processing happens on the server → no server needed
- The output is just HTML/CSS/JS files — can be hosted anywhere (GitHub Pages, Cloudflare Pages, S3)
- Service Worker can cache everything → full offline support

**Trade-offs**:
- No server-side rendering (SSR) — all rendering is client-side
- No API routes (but AutoPilot doesn't need any)
- `image/unoptimized: true` means images aren't automatically resized

---

# Part 6 — Performance Architecture

## Chunk Size Math

The default chunk size is **10,000 rows per OPFS file**.

Why 10,000?
- A typical CSV row is ~100-200 bytes after JSON encoding
- 10,000 rows × 200 bytes = ~2MB per chunk file
- 2MB is fast to read (under 50ms for a modern SSD)
- 2MB fits comfortably in memory alongside processing buffers
- At 10,000 rows/chunk, a 10M row dataset = 1,000 chunks — manageable number of files

**Performance presets** (user-configurable in Settings):

| Preset | Chunk Size | Max Union Rows | Min RAM | Use Case |
|---|---|---|---|---|
| Balanced | 10,000 | 500,000 | 4 GB | Default, safe |
| Performance | 25,000 | 2,000,000 | 8 GB | Faster I/O, moderate RAM |
| Maximum | 50,000 | 5,000,000 | 16 GB | Workstations with plenty of RAM |

Larger chunk size = fewer files = faster sequential I/O, but higher peak memory per operation.

## Memory Peak Per Operation

| Operation | Peak Memory | How |
|---|---|---|
| CSV Parse | `chunkSize × row_size` | One chunk buffer at a time |
| CSV Filter | `chunkSize × row_size` | One input chunk at a time |
| CSV Sort Phase 1 | `mergeFactor × chunkSize × row_size` ≈ 96MB | Full sort buffer in RAM |
| CSV Sort Phase 2 | `numRuns × chunkSize × row_size` ≈ 16MB (at 16 runs) | One chunk per run in heap |
| CSV Join (small right) | `rightDataset size` + `chunkSize` | Right side hash map |
| CSV Join (large right) | `rightDataset / K` + `chunkSize` | One partition at a time |
| CSV Aggregate | `numGroups × accumulator_size` | All group accumulators |
| CSV Deduplicate | `distinctKeys × key_size` | Counts Map + Seen Set |

## Service Worker Performance Gains

Once the app is installed/cached, all JavaScript, CSS, and worker files are served from the Service Worker cache (the browser's local storage). Network latency = 0. Response time = disk read speed (~milliseconds).

This means:
- Second page load: near-instant (all assets cached)
- Offline: full functionality
- Worker download: cached after first use, instant on second execution

## Performance Settings Injection Path

```
User changes chunk size in Settings UI
  ↓ savePerformanceSettings({ chunkSize: 25000, ... })
  ↓ Stored in localStorage["autopilot:performance-settings"]

User clicks Run
  ↓ runWorkflow() called
  ↓ executor called (e.g. csv-sort/executor.ts)
  ↓ dispatchWorkerJob("csv-sort", { inputRef, sortColumns, ... }, ...)
    ↓ getPerformanceSettings() reads localStorage
    ↓ enrichedInput = { chunkSize: 25000, maxUnionRows: ..., inputRef, sortColumns, ... }
    ↓ worker.postMessage({ jobId, type, input: enrichedInput })

Inside Worker:
  ↓ input.chunkSize = 25000
  ↓ ChunkedOPFSWriter(..., chunkSize=25000)
  ↓ Writes 25,000 rows per OPFS chunk instead of 10,000
```

Workers never read `localStorage` directly — they can't. The bridge is the `dispatchWorkerJob` function which reads settings from the main thread and injects them into every job.

---

# Part 7 — Build & Deployment

## `scripts/build-workers.mjs`

This script runs before the Next.js build (`prebuild` hook). It:

1. Finds all worker TypeScript files in `src/workers/`
2. Bundles each one with esbuild:
   ```javascript
   await esbuild.build({
     entryPoints: ["src/workers/csv-sort.worker.ts"],
     outfile: "public/workers/csv-sort.worker.js",
     bundle: true,        // Include all imports inline
     format: "esm",       // ES module format (required for { type: "module" } workers)
     platform: "browser", // Target the browser environment
     target: "es2020",    // Modern JS features OK
     minify: false,       // Keep readable for debugging
   });
   ```
3. Copies `pdfjs-dist/build/pdf.worker.min.mjs` to `public/pdf.worker.min.mjs`
4. Generates PNG icons from SVG spec

Why bundle workers separately? Because workers are loaded as separate scripts (`new Worker("/workers/csv-sort.worker.js")`), not imported. Next.js's module bundler doesn't process them. esbuild bundles all `import` statements inline so the worker JS file is self-contained.

## Development Workflow

**`npm run dev`**: Next.js dev server with Turbopack. HMR for all React/TypeScript code.

**`npm run dev:all`**: Runs `mprocs` with both Next.js and all 9 worker watchers:
```yaml
# mprocs.yaml
procs:
  next: { cmd: "npm run dev" }
  workers: { cmd: "node scripts/build-workers.mjs --watch" }
```

When you edit a worker TypeScript file, esbuild rebuilds it to `public/workers/` and the browser reloads the worker on next execution.

## Production Build

```bash
npm run build
```

This runs:
1. `prebuild`: `node scripts/build-workers.mjs` → bundles all workers to `public/workers/`
2. `next build --turbopack` → builds the React app

Output: `out/` directory containing all HTML, CSS, and JS files. Can be served from any static file host.

## Dockerfile (Multi-Stage)

```dockerfile
# Stage 1: Install dependencies
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Stage 2: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Stage 3: Production runner
FROM node:20-slim AS runner
WORKDIR /app
RUN npm install -g pm2
COPY --from=builder /app/out ./out
COPY --from=builder /app/public ./public
COPY ecosystem.config.js .
RUN mkdir -p /app/data/datasets
CMD ["pm2-runtime", "ecosystem.config.js"]
```

Multi-stage builds produce smaller final images — the `runner` stage only contains the built output, not the source code or `node_modules`.

Note: The Dockerfile exists as a deployment option, but the app also runs without Docker as a plain static site.

## `ecosystem.config.js` — PM2 Config

```javascript
module.exports = {
  apps: [
    {
      name: "autopilot-web",
      script: "next start",
      env: { NODE_ENV: "production", PORT: 3000 },
    },
  ],
};
```

PM2 is a Node.js process manager. It keeps the process running (restarts on crash), manages logs, and handles graceful shutdowns.

## Railway Deployment

`railway.toml` configures Railway.app (a cloud hosting platform) to:
- Build with `npm run build`
- Start with `npm run start`
- Use port 3000
- Set health check endpoint to `/`

---

# Appendix: Key Numbers to Remember

| Metric | Value | Why |
|---|---|---|
| Default chunk size | 10,000 rows | ~2MB per file, fast I/O |
| Sort merge factor | 64 | ~640K rows in Phase 1 memory |
| Sort memory peak | ~96MB | 64 chunks × 10K rows × 150 bytes |
| Join small threshold | 500,000 rows | Above this, use grace hash join |
| Aggregate count_distinct cap | 100,000 | Prevents unbounded Set growth |
| Schema sample size | 1,000 rows | Good enough for type inference |
| Auto-save debounce | 1,500 ms | Prevents excessive DB writes |
| Search debounce | 500 ms | Prevents excessive queries |
| Panel collapse threshold | 180px | Below this height, auto-collapse |
| Service worker cache version | `autopilot-v4` | Increment to force cache refresh |
| PWA start URL | `/workflows/` | Opens to the main list page |

---

*End of AutoPilot Complete Codebase Reference*

