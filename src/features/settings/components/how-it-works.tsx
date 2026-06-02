import {
  ArrowRight,
  ArrowUpDown,
  BookOpen,
  Braces,
  CheckCircle2,
  Columns,
  Copy,
  Database,
  FileSignature,
  FileSpreadsheet,
  FileStack,
  FileText,
  Filter,
  GitCompare,
  Hash,
  ImageIcon,
  ListOrdered,
  Loader2,
  MousePointerClick,
  Play,
  Plus,
  Settings2,
  ShieldCheck,
  Sigma,
  Sparkles,
  Table2,
  TrendingUp,
  Upload,
  WifiOff,
  Workflow,
  X,
  Scissors,
  ChevronRight,
  PenLine,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function SectionLabel({
  n,
  children,
}: {
  n: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary text-sm font-bold">
        {n}
      </span>
      <h2 className="text-2xl font-semibold tracking-tight text-foreground">
        {children}
      </h2>
    </div>
  );
}

function DocImage({ alt, caption }: { src?: string; alt: string; caption?: string }) {
  return (
    <figure className="my-5 overflow-hidden rounded-xl border-2 border-dashed border-border bg-muted/30">
      <div className="flex aspect-video flex-col items-center justify-center gap-2 px-6 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
          <ImageIcon className="h-5 w-5" aria-hidden />
        </span>
        <p className="text-sm font-medium text-muted-foreground">
          Screenshot placeholder
        </p>
        {caption && (
          <figcaption className="max-w-md text-xs text-muted-foreground/70">
            {caption}
          </figcaption>
        )}
      </div>
      <span className="sr-only">{alt}</span>
    </figure>
  );
}

function Step({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <ChevronRight
        className="mt-1 h-4 w-4 shrink-0 text-primary"
        aria-hidden
      />
      <span className="text-muted-foreground leading-relaxed">{children}</span>
    </li>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-4 flex gap-3 rounded-xl border border-accent bg-accent/30 p-4">
      <Sparkles
        className="mt-0.5 h-4 w-4 shrink-0 text-accent-foreground"
        aria-hidden
      />
      <p className="text-sm text-foreground leading-relaxed">{children}</p>
    </div>
  );
}

function Var({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded-md px-1.5 py-0.5 text-[0.85em] font-medium bg-primary/10 text-primary">
      {children}
    </code>
  );
}

function NodeCard({
  icon: Icon,
  name,
  desc,
  variant = "default",
}: {
  icon: LucideIcon;
  name: string;
  desc: string;
  variant?: "default" | "primary" | "blue" | "green";
}) {
  const styles = {
    default: "bg-muted text-muted-foreground",
    primary: "bg-primary/10 text-primary",
    blue: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    green: "bg-green-500/10 text-green-600 dark:text-green-400",
  };
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${styles[variant]}`}
      >
        <Icon className="h-[18px] w-[18px]" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{name}</p>
        <p className="text-xs leading-snug text-muted-foreground">{desc}</p>
      </div>
    </div>
  );
}

// ─── Node catalog — driven from the live NodeType registry ───────────────────
// Source of truth: src/config/node-components.ts + src/types/node-type.ts
// FILE_EXPORT is in the enum but NOT registered in the UI — export is done from
// the execution panel, not via a node. It is intentionally omitted here.

const triggerNodes = [
  {
    icon: Play,
    name: "Manual Trigger",
    desc: "Start the workflow when you click Run.",
    variant: "primary" as const,
  },
  {
    icon: Upload,
    name: "Upload File",
    desc: "Select a local .csv, .txt, or PDF file and bring it into the workflow.",
    variant: "primary" as const,
  },
];

const csvNodes = [
  {
    icon: Table2,
    name: "CSV Parse",
    desc: "Read a raw file into structured rows and columns, with schema inference.",
  },
  {
    icon: Filter,
    name: "CSV Filter",
    desc: "Keep only rows matching one or more conditions (12 operators, AND/OR logic).",
  },
  {
    icon: ArrowUpDown,
    name: "CSV Sort",
    desc: "Order rows by one or more columns. Uses external merge sort for huge files.",
  },
  {
    icon: Sigma,
    name: "CSV Join",
    desc: "Merge two datasets on a shared key (inner, left, right, full, or cross join).",
  },
  {
    icon: Hash,
    name: "CSV Aggregate",
    desc: "Group rows by columns and compute totals, counts, averages, min/max.",
  },
  {
    icon: Copy,
    name: "Detect Duplicates",
    desc: "Find duplicate rows by a key — outputs unique rows and duplicates separately.",
  },
  {
    icon: GitCompare,
    name: "CSV Compare",
    desc: "Diff two datasets: produces added, removed, changed, common, and schema_diff sets.",
  },
  {
    icon: TrendingUp,
    name: "Consecutive Sequence Analyzer",
    desc: "Detect gaps or runs in a numeric or date column (e.g. missing IDs, time gaps).",
  },
  {
    icon: Settings2,
    name: "CSV Transform",
    desc: "Apply conditional find-and-replace rules: replace, clear, delete, or set values.",
  },
  {
    icon: Columns,
    name: "Column Transform",
    desc: "Apply unconditional ops to a column: trim, case change, regex replace, math.",
  },
  {
    icon: ListOrdered,
    name: "CSV Restructure",
    desc: "Reorder, drop, or add computed columns to rebuild the output schema.",
  },
  {
    icon: Database,
    name: "CSV Generate",
    desc: "Produce a synthetic dataset for testing workflows without real data.",
  },
];

const pdfNodes = [
  {
    icon: FileText,
    name: "PDF Extract Text",
    desc: "Pull all text from a PDF, page by page.",
  },
  {
    icon: FileSpreadsheet,
    name: "PDF Extract Tables",
    desc: "Detect tables in a PDF and convert them into structured rows.",
  },
  {
    icon: Scissors,
    name: "PDF Split",
    desc: "Split a multi-page PDF into separate page documents.",
  },
  {
    icon: FileStack,
    name: "PDF Merge",
    desc: "Combine multiple PDFs into one document.",
  },
  {
    icon: FileSignature,
    name: "PDF Fill Form",
    desc: "Write values into PDF AcroForm fields.",
  },
  {
    icon: PenLine,
    name: "PDF Generate",
    desc: "Build a new PDF document from text and data.",
  },
  {
    icon: FileText,
    name: "PDF Sign",
    desc: "Apply a digital signature to a PDF.",
  },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export function HowItWorks() {
  const toc: [string, string][] = [
    ["idea", "The big idea"],
    ["create", "1 · Create a workflow"],
    ["nodes", "2 · Add & connect nodes"],
    ["configure", "3 · Configure a node"],
    ["variables", "4 · Variables"],
    ["run", "5 · Run & read results"],
    ["example", "Worked example"],
    ["reference", "Node reference"],
  ];

  return (
    <div className="scroll-smooth">
      <div className="mx-auto max-w-4xl px-6 py-10">

        {/* Header */}
        <div className="flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <BookOpen className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">
              How It Works
            </h1>
            <p className="mt-1 text-muted-foreground">
              A step-by-step guide to building workflows, configuring nodes, and wiring up variables in AutoPilot.
            </p>
          </div>
        </div>

        {/* Intro */}
        <p className="mt-6 text-muted-foreground leading-relaxed">
          AutoPilot turns data work into a flowchart. You drag blocks — called{" "}
          <span className="font-semibold text-foreground">nodes</span> — onto a canvas, connect them in
          order, and click <span className="font-semibold text-foreground">Run</span>. Each node does one
          job and passes its result to the next. It's the visual version of a command-line pipeline:
        </p>
        <pre className="mt-4 overflow-x-auto rounded-xl bg-zinc-900 dark:bg-zinc-950 px-4 py-3 text-sm text-zinc-100">
          <code>cat data.csv | filter &quot;age &gt; 30&quot; | sort by &quot;name&quot; &gt; output.csv</code>
        </pre>
        <p className="mt-3 text-sm text-muted-foreground">
          Everything runs inside your browser tab. Nothing is uploaded, no account is needed, and it keeps
          working with no internet connection.
        </p>

        {/* Promise cards */}
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            {
              Icon: ShieldCheck,
              title: "100% private",
              desc: "Files never leave your machine.",
            },
            {
              Icon: WifiOff,
              title: "Works offline",
              desc: "Runs fully in the browser, no server.",
            },
            {
              Icon: Database,
              title: "Handles huge files",
              desc: "Streams to disk so large data won't crash the tab.",
            },
          ].map(({ Icon, title, desc }) => (
            <div
              key={title}
              className="rounded-xl border border-border bg-card p-4"
            >
              <Icon className="mb-2 h-5 w-5 text-primary" aria-hidden />
              <p className="text-sm font-semibold text-foreground">{title}</p>
              <p className="text-xs text-muted-foreground">{desc}</p>
            </div>
          ))}
        </div>

        {/* On this page */}
        <nav
          aria-label="On this page"
          className="mt-8 rounded-xl border border-border bg-card p-4"
        >
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            On this page
          </p>
          <div className="flex flex-wrap gap-2">
            {toc.map(([id, label]) => (
              <a
                key={id}
                href={`#${id}`}
                className="rounded-full border border-border bg-muted/40 px-3 py-1 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {label}
              </a>
            ))}
          </div>
        </nav>

        {/* ── The big idea ─────────────────────────────────────────────────────── */}
        <section id="idea" className="mt-12 scroll-mt-6">
          <SectionLabel n={<Workflow className="h-4 w-4" aria-hidden />}>
            The big idea
          </SectionLabel>
          <p className="text-muted-foreground leading-relaxed">
            A workflow is a left-to-right chain of nodes. The{" "}
            <strong className="text-foreground">output</strong> handle of one node connects to the{" "}
            <strong className="text-foreground">input</strong> handle of the next — "send your result
            onward." A typical CSV pipeline looks like this:
          </p>

          <div className="my-6 flex flex-wrap items-center gap-1 rounded-2xl border border-border bg-card p-6">
            {(
              [
                [Play, "Manual Trigger", "primary"],
                [Upload, "Upload File", "blue"],
                [Table2, "CSV Parse", "default"],
                [Filter, "CSV Filter", "default"],
              ] as [LucideIcon, string, "primary" | "blue" | "default"][]
            ).map(([Icon, name, variant], i, arr) => {
              const iconStyles = {
                primary: "bg-primary/10 text-primary",
                blue: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
                default: "bg-muted text-muted-foreground",
              };
              return (
                <div key={name} className="flex items-center">
                  <div className="flex w-24 flex-col items-center gap-2 text-center">
                    <span
                      className={`flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-card shadow-sm ${iconStyles[variant]}`}
                    >
                      <Icon className="h-5 w-5" aria-hidden />
                    </span>
                    <span className="text-[11px] font-medium leading-tight text-muted-foreground">
                      {name}
                    </span>
                  </div>
                  {i < arr.length - 1 && (
                    <ArrowRight
                      className="mx-1 h-4 w-4 text-border"
                      aria-hidden
                    />
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-sm text-muted-foreground">
            Bring data in → reshape it → export any node's result straight from the execution panel.
            Mix and match the nodes below to build anything from "dedupe this contact list" to "merge
            ten PDFs and pull out the tables."
          </p>
        </section>

        {/* ── 1. Create a workflow ─────────────────────────────────────────────── */}
        <section id="create" className="mt-12 scroll-mt-6">
          <SectionLabel n="1">Create a workflow</SectionLabel>
          <ul className="space-y-2.5">
            <Step>
              Open <strong className="text-foreground">Workflows</strong> from the sidebar.
            </Step>
            <Step>
              Click <strong className="text-foreground">New Workflow</strong>. Give it a unique name.
              If you already have workflows, you'll also see a{" "}
              <strong className="text-foreground">Copy existing</strong> option — pick any workflow to
              use as a starting point, with its full canvas copied over. Otherwise just click{" "}
              <strong className="text-foreground">Start blank</strong>.
            </Step>
            <Step>
              The canvas opens with a single{" "}
              <em className="text-foreground">Start</em> node already placed. Click the{" "}
              <span className="inline-flex items-center gap-1 align-middle">
                <Plus className="inline h-3.5 w-3.5 text-primary" aria-hidden />
              </span>{" "}
              tile below it to add your first real block.
            </Step>
            <Step>
              Workflows auto-save to your browser as you build — click{" "}
              <strong className="text-foreground">Save</strong> in the editor toolbar any time to commit
              changes explicitly.
            </Step>
          </ul>
          <DocImage
            alt="The New Workflow dialog — name field with Start blank and Copy existing buttons"
            caption="New workflow dialog — start blank or copy an existing workflow as a template."
          />
          <DocImage
            alt="The empty editor canvas with the initial Start node and dashed + tile"
            caption="Empty editor canvas: the Start node and the dashed + tile ready for your first block."
          />
        </section>

        {/* ── 2. Add & connect nodes ───────────────────────────────────────────── */}
        <section id="nodes" className="mt-12 scroll-mt-6">
          <SectionLabel n="2">Add &amp; connect nodes</SectionLabel>
          <ul className="space-y-2.5">
            <Step>
              Click the <span className="font-semibold text-primary">+</span> button on any node (or the
              large + tile on the empty canvas) to open the{" "}
              <strong className="text-foreground">node picker</strong>.
            </Step>
            <Step>
              The very first picker asks{" "}
              <em className="text-foreground">"What triggers this workflow?"</em> — pick{" "}
              <strong className="text-foreground">Manual Trigger</strong> (starts when you click Run) or
              go straight to <strong className="text-foreground">Upload File</strong>.
            </Step>
            <Step>
              Search or scroll the list, then click a node. It drops onto the canvas already wired to
              the previous one.
            </Step>
            <Step>
              Connections run handle-to-handle: the dot on a node's{" "}
              <strong className="text-foreground">right edge</strong> (output) connects to the dot on the
              next node's <strong className="text-foreground">left edge</strong> (input). Drag between
              handles to rewire manually.
            </Step>
            <Step>
              Each node shows a status indicator after a run —{" "}
              <span className="text-muted-foreground">no icon when idle</span>,{" "}
              <span className="inline-flex items-center gap-1">
                <Loader2 className="h-3.5 w-3.5 text-blue-500" aria-hidden />
                <span className="text-blue-500">blue spinner</span>
              </span>{" "}
              while running,{" "}
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-green-500 inline-block" aria-hidden />
                <span className="text-green-600 dark:text-green-400">green</span>
              </span>{" "}
              on success,{" "}
              <span className="inline-flex items-center gap-1">
                <X className="h-3.5 w-3.5 text-red-600" aria-hidden />
                <span className="text-red-600">red</span>
              </span>{" "}
              on error. Use the gear icon to configure or the trash icon to delete a node.
            </Step>
          </ul>
          <DocImage
            alt="Editor canvas showing Manual Trigger → Upload File → CSV Parse connected by curved links"
            caption="A simple pipeline: three nodes connected by curved handles."
          />
          <DocImage
            alt="The node picker panel showing a searchable list of nodes"
            caption="Node picker — search or scroll to find a node, then click to add it."
          />
        </section>

        {/* ── 3. Configure a node ──────────────────────────────────────────────── */}
        <section id="configure" className="mt-12 scroll-mt-6">
          <SectionLabel n="3">Configure a node</SectionLabel>
          <ul className="space-y-2.5">
            <Step>
              Click a node's{" "}
              <span className="inline-flex items-center gap-1 align-middle font-medium text-foreground">
                <Settings2 className="inline h-4 w-4" aria-hidden /> gear
              </span>{" "}
              to open its configuration dialog.
            </Step>
            <Step>
              Most dialogs share the same three-part structure: an{" "}
              <strong className="text-foreground">input variable</strong> (which upstream result to use),
              the <strong className="text-foreground">node options</strong> (has header, delimiter, sort
              column, filter conditions, etc.), and an{" "}
              <strong className="text-foreground">output variable name</strong>.
            </Step>
            <Step>
              Fields are validated with Zod. If something required is missing you'll see an inline
              message and the <strong className="text-foreground">Save Configuration</strong> button stays
              disabled until the form is valid.
            </Step>
            <Step>
              Click <strong className="text-foreground">Save Configuration</strong> — settings are
              persisted automatically in your browser's IndexedDB.
            </Step>
          </ul>
          <DocImage
            alt="The Upload File configuration dialog with drop-zone and variable name field"
            caption={`Upload File dialog: drop-zone, variable name set to "data", and Save Configuration.`}
          />
          <DocImage
            alt="A transform node's dialog showing the input-variable dropdown, node options, and output variable name"
            caption="A transform node's dialog: input dropdown, node options, and the auto-suggested output variable name."
          />
        </section>

        {/* ── 4. Variables ─────────────────────────────────────────────────────── */}
        <section id="variables" className="mt-12 scroll-mt-6">
          <SectionLabel n={<Braces className="h-4 w-4" aria-hidden />}>
            Variables
          </SectionLabel>
          <p className="text-muted-foreground leading-relaxed">
            Variables are how data travels between nodes. Every node that produces data writes its result
            to a <strong className="text-foreground">named variable</strong>. The next node picks that
            name from a dropdown as its input. Think of it as a shared bag of results that grows as the
            workflow runs.
          </p>

          <ol className="mt-4 space-y-2.5">
            <Step>
              When you configure <strong className="text-foreground">Upload File</strong>, you give the
              file a name like <Var>data</Var>. Downstream nodes can reference it by selecting{" "}
              <Var>data</Var> in their input-variable dropdown.
            </Step>
            <Step>
              <strong className="text-foreground">CSV Parse</strong> reads <Var>data</Var> and writes a
              new variable, e.g. <Var>parsedData</Var>.
            </Step>
            <Step>
              <strong className="text-foreground">CSV Filter</strong> reads <Var>parsedData</Var> and
              writes <Var>filteredData</Var>, and so on down the chain.
            </Step>
            <Step>
              The <strong className="text-foreground">output variable name is suggested automatically</strong>{" "}
              — when you open the dialog you'll see an{" "}
              <span className="rounded text-xs font-medium bg-primary/10 text-primary px-1.5 py-0.5">
                auto
              </span>{" "}
              badge next to the field, showing the suggested name. Simply leave it or type over it to
              rename. The suggestion is pre-filled — no button needed.
            </Step>
            <Step>
              The description below the output name field shows a live preview:{" "}
              <Var>{`{{filteredData}}`}</Var> updates as you type so you can see exactly what
              downstream nodes will reference.
            </Step>
            <Step>
              Column fields (those asking for a header name) <strong className="text-foreground">autocomplete</strong>{" "}
              from the upstream file's schema — once a file is parsed you'll see the real column names
              as suggestions.
            </Step>
          </ol>

          <div className="mt-5 overflow-hidden rounded-xl border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/60 text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Field</th>
                  <th className="px-4 py-2.5 font-semibold">What it means</th>
                  <th className="px-4 py-2.5 font-semibold">Example</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-card text-muted-foreground">
                <tr>
                  <td className="px-4 py-3 font-medium text-foreground">
                    Input variable
                  </td>
                  <td className="px-4 py-3">
                    Which upstream result this node should read
                  </td>
                  <td className="px-4 py-3">
                    <Var>parsedData</Var>
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-medium text-foreground">
                    Output variable name
                  </td>
                  <td className="px-4 py-3">
                    Names this node's result for nodes further down
                  </td>
                  <td className="px-4 py-3">
                    <Var>filteredData</Var>
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-medium text-foreground">
                    {`{{ variable }}`}
                  </td>
                  <td className="px-4 py-3">
                    A live preview hint shown in dialog descriptions
                  </td>
                  <td className="px-4 py-3">
                    <Var>{`{{filteredData}}`}</Var>
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-medium text-foreground">
                    Column field
                  </td>
                  <td className="px-4 py-3">
                    A column header from the upstream file (autocompletes)
                  </td>
                  <td className="px-4 py-3">
                    <Var>email</Var>, <Var>age</Var>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <Tip>
            Name variables for what they hold (<Var>cleanContacts</Var>,{" "}
            <Var>over30</Var>) rather than the node type. When a workflow has ten nodes, descriptive
            names make the input dropdowns far easier to read.
          </Tip>

          <DocImage
            alt="Output variable name field with the auto badge and live preview hint"
            caption="The output variable name field: auto-suggested name with the 'auto' badge; edit freely."
          />
          <DocImage
            alt="A column field autocompleting real header names from the upstream parsed file"
            caption="Column autocomplete: header names pulled from the upstream file's parsed schema."
          />
        </section>

        {/* ── 5. Run & read results ────────────────────────────────────────────── */}
        <section id="run" className="mt-12 scroll-mt-6">
          <SectionLabel n="5">Run &amp; read results</SectionLabel>
          <ul className="space-y-2.5">
            <Step>
              Click <strong className="text-foreground">Run</strong> in the editor toolbar. AutoPilot
              calculates the correct execution order automatically (topological sort) and runs each node
              in sequence.
            </Step>
            <Step>
              A <strong className="text-foreground">progress panel</strong> opens on the right. Node
              indicators turn{" "}
              <span className="text-blue-500">blue</span> while running and{" "}
              <span className="text-green-600 dark:text-green-400">green</span> when done; large files
              show a live progress bar.
            </Step>
            <Step>
              If a node fails it turns{" "}
              <span className="text-red-600">red</span> with an error message, and the run stops there
              so you can fix the configuration and re-run.
            </Step>
            <Step>
              When the run finishes, open the{" "}
              <strong className="text-foreground">execution panel</strong> and click any node's output
              row to preview it. Hit{" "}
              <strong className="text-foreground">Export</strong> to download the data as{" "}
              <strong className="text-foreground">CSV, Excel (.xlsx), TXT, or PDF</strong>. Toggle{" "}
              <strong className="text-foreground">"Download in segments"</strong> to split very large
              results into multiple files — either by specifying the number of files or the target rows
              per file.
            </Step>
            <Step>
              Every run is saved under <strong className="text-foreground">Executions</strong> in the
              sidebar — open any past run to see per-node timing, a paginated dataset preview, and to
              re-download results at any time.
            </Step>
          </ul>
          <DocImage
            alt="Progress panel mid-run showing node list with status indicators and a progress bar"
            caption="Progress panel during a run: status dots update live and large files show a per-node progress bar."
          />
          <DocImage
            alt="Execution panel showing a node's output with the Export button and CSV / Excel / chunk options"
            caption="Execution panel: click Export on any node's output to download as CSV, Excel, TXT, or PDF — with segment options for large files."
          />
        </section>

        {/* ── Worked example ───────────────────────────────────────────────────── */}
        <section id="example" className="mt-12 scroll-mt-6">
          <SectionLabel n={<ListOrdered className="h-4 w-4" aria-hidden />}>
            Worked example
          </SectionLabel>
          <p className="text-muted-foreground">
            Filter a contact list down to people over 30 and export it. Three nodes, end to end.
          </p>

          <div className="mt-5 space-y-3">
            {[
              {
                Icon: Upload,
                name: "Upload File",
                variant: "blue" as const,
                rows: [
                  ["Drop in", "your contacts.csv file"],
                  ["Output variable", "data"],
                ],
              },
              {
                Icon: Table2,
                name: "CSV Parse",
                variant: "default" as const,
                rows: [
                  ["Input variable", "data"],
                  ["Has header", "on"],
                  ["Delimiter", "auto-detect"],
                  ["Output variable", "parsedData"],
                ],
              },
              {
                Icon: Filter,
                name: "CSV Filter",
                variant: "default" as const,
                rows: [
                  ["Input variable", "parsedData"],
                  ["Condition", "age > 30"],
                  ["Logic", "AND"],
                  ["Output variable", "filteredData"],
                ],
              },
            ].map((step, i) => {
              const iconStyles = {
                primary: "bg-primary/10 text-primary",
                blue: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
                green: "bg-green-500/10 text-green-600 dark:text-green-400",
                default: "bg-muted text-muted-foreground",
              };
              return (
                <div
                  key={step.name}
                  className="rounded-xl border border-border bg-card p-4"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold bg-primary/10 text-primary">
                      {i + 1}
                    </span>
                    <span
                      className={`flex h-8 w-8 items-center justify-center rounded-lg ${iconStyles[step.variant]}`}
                    >
                      <step.Icon className="h-[18px] w-[18px]" aria-hidden />
                    </span>
                    <p className="font-semibold text-foreground">{step.name}</p>
                  </div>
                  <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 pl-9 sm:grid-cols-2">
                    {step.rows.map(([k, v]) => (
                      <div
                        key={k}
                        className="flex items-baseline justify-between gap-3 border-b border-dashed border-border py-1"
                      >
                        <dt className="text-sm text-muted-foreground">{k}</dt>
                        <dd className="text-sm font-medium text-foreground">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm font-medium text-primary">
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            Click Run, then export <Var>filteredData</Var> from the execution panel — pick CSV or Excel
            and optionally split into segments.
          </div>
        </section>

        {/* ── Node reference ───────────────────────────────────────────────────── */}
        <section id="reference" className="mt-12 scroll-mt-6">
          <SectionLabel n={<Database className="h-4 w-4" aria-hidden />}>
            Node reference
          </SectionLabel>
          <p className="text-muted-foreground text-sm mb-4">
            All 21 nodes available in the canvas, grouped by category. Derived from the live node
            registry — no phantom nodes.
          </p>

          <h3 className="mb-3 mt-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Triggers &amp; input
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {triggerNodes.map((n) => (
              <NodeCard key={n.name} {...n} />
            ))}
          </div>

          <h3 className="mb-3 mt-6 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            CSV transforms
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {csvNodes.map((n) => (
              <NodeCard key={n.name} {...n} />
            ))}
          </div>

          <h3 className="mb-3 mt-6 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            PDF operations
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {pdfNodes.map((n) => (
              <NodeCard key={n.name} {...n} />
            ))}
          </div>

          <div className="mt-6 rounded-xl border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">Exporting results.</strong> There is no export node —
              run the workflow, then export any node's output straight from the execution panel as CSV,
              Excel, TXT, or PDF, with segment options for large datasets.
            </p>
          </div>
        </section>

        {/* ── CTA ──────────────────────────────────────────────────────────────── */}
        <div className="mt-14 flex flex-col items-center gap-4 rounded-2xl border border-border bg-card p-10 text-center">
          <h2 className="text-2xl font-bold tracking-tight text-foreground">
            Build your first workflow
          </h2>
          <p className="max-w-md text-muted-foreground">
            It takes about a minute. Add a trigger, drop in a file, chain a couple of nodes, and hit Run.
          </p>
          <a
            href="/workflows"
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <MousePointerClick className="h-4 w-4" aria-hidden />
            Open the editor
          </a>
        </div>

      </div>
    </div>
  );
}
