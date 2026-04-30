import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BookOpenIcon, CheckIcon, XIcon, MinusIcon } from "lucide-react";

const techBadges = [
  "Next.js 15", "React 19", "TypeScript 5", "Tailwind v4",
  "OPFS", "Dexie / IndexedDB", "Jotai", "@xyflow/react",
  "TanStack Query", "Zod", "Radix UI", "Biome",
];

const problems = [
  {
    title: "No Privacy with Cloud Tools",
    desc: "SaaS platforms like Google Sheets and Trifacta require uploading sensitive CSVs to third-party servers, violating data governance policies.",
  },
  {
    title: "Scale Limits in Spreadsheets",
    desc: "Excel and Google Sheets crash or freeze past ~100k rows. Users resort to sampling their data, losing accuracy.",
  },
  {
    title: "Code Required for Pipelines",
    desc: "Python pandas, R dplyr, or SQL require engineering skills. Business analysts cannot build pipelines without developer support.",
  },
  {
    title: "No Offline Support",
    desc: "All mainstream ETL tools require a stable internet connection and a live server — useless in air-gapped or restricted environments.",
  },
  {
    title: "Vendor Lock-in & Cost",
    desc: "Alteryx, Trifacta, and Databricks charge thousands per seat annually and use proprietary formats that trap your workflows.",
  },
  {
    title: "Slow Server-Side Queues",
    desc: "Cloud ETL tools queue jobs on remote servers. A 5-minute job becomes a 30-minute wait during peak hours.",
  },
];

type Ternary = "yes" | "no" | "partial";

interface CompetitorRow {
  tool: string;
  type: string;
  offline: Ternary;
  noCode: Ternary;
  free: Ternary;
  scale: Ternary;
  privacy: Ternary;
}

const competitors: CompetitorRow[] = [
  { tool: "AutoPilot", type: "Browser PWA",     offline: "yes",     noCode: "yes",     free: "yes",     scale: "yes",     privacy: "yes"     },
  { tool: "Excel",     type: "Desktop App",      offline: "yes",     noCode: "yes",     free: "no",      scale: "no",      privacy: "yes"     },
  { tool: "Trifacta",  type: "Cloud SaaS",       offline: "no",      noCode: "yes",     free: "partial", scale: "yes",     privacy: "no"      },
  { tool: "Alteryx",   type: "Desktop + Cloud",  offline: "partial", noCode: "yes",     free: "no",      scale: "yes",     privacy: "partial" },
  { tool: "Pandas",    type: "Python Library",   offline: "yes",     noCode: "no",      free: "yes",     scale: "partial", privacy: "yes"     },
  { tool: "G. Sheets", type: "Cloud SaaS",       offline: "no",      noCode: "yes",     free: "yes",     scale: "no",      privacy: "no"      },
  { tool: "Databricks","type": "Cloud Platform", offline: "no",      noCode: "partial", free: "no",      scale: "yes",     privacy: "no"      },
];

const TernaryIcon = ({ value }: { value: Ternary }) => {
  if (value === "yes") return <CheckIcon className="size-4 text-green-600 dark:text-green-400 mx-auto" />;
  if (value === "no") return <XIcon className="size-4 text-red-500 dark:text-red-400 mx-auto" />;
  return <MinusIcon className="size-4 text-amber-500 dark:text-amber-400 mx-auto" />;
};

const techSections = [
  {
    title: "Execution Engine",
    body: "Workflow nodes are sorted into a deterministic execution order using DFS post-order topological sort (via toposort). Each node runs sequentially, receiving an ExecutionContext that carries DatasetRef pointers from upstream nodes. Lazy dynamic imports mean executor code is only loaded when a node type is first used — keeping initial bundle size small.",
  },
  {
    title: "Data Storage (DatasetRef)",
    body: "Small results (≤5,000 rows) stay in-memory as plain arrays. Larger results are automatically promoted to disk-backed DatasetRefs stored as chunked JSONL files in OPFS, with their manifest (row count, chunk list, schema) persisted in IndexedDB via Dexie. This threshold prevents the browser tab from running out of heap memory on large pipelines.",
  },
  {
    title: "Resource Governance",
    body: "A global ResourceBudget object enforces: 256 MB peak pipeline memory, 4 GB total OPFS disk usage, and a maximum of 1 concurrent heavy operation (sort, join, compare). Each node executor checks these limits before allocating. The join planner performs cardinality estimation and rejects unsafe large×large cross joins before any data is read.",
  },
  {
    title: "Streaming Algorithms",
    body: "Sort uses external merge sort: a run-generation phase creates sorted OPFS chunks, then a k-way merge produces the final output without loading all rows into memory. Hash join materialises the smaller (build) side into a hash map, then streams the probe side row-by-row. Compare indexes the smaller dataset by key, then streams the larger one for diff detection.",
  },
  {
    title: "State Architecture",
    body: "Three state layers work together: Jotai atoms hold transient execution state (progress %, node status, current metrics) that drive live UI updates. IndexedDB (Dexie) holds persistent structured data: workflow definitions, execution history, dataset manifests. OPFS holds the raw binary-adjacent row data as JSONL chunks. URL query state (Nuqs) handles navigation filters.",
  },
];

const perks = [
  { title: "100% Private",         desc: "No data ever leaves the browser tab. Zero server uploads, zero telemetry." },
  { title: "Works Offline",        desc: "Full PWA — installable on desktop. Operates with zero internet after first load." },
  { title: "Scales to Millions",   desc: "OPFS-backed streaming processes datasets that would crash any spreadsheet." },
  { title: "No-Code Pipelines",    desc: "12+ node types, drag-and-drop editor — no Python, SQL, or config files needed." },
  { title: "Real-Time Metrics",    desc: "Per-node CPU, GC, bytes in/out, and timing data visible during execution." },
  { title: "Zero Infrastructure",  desc: "No server, no database, no account, no subscription, no deployment cost." },
];

const downsides = [
  { title: "Browser Resource Limits",    desc: "Bound by the tab's memory and the browser's OPFS disk quota (typically 60% of free disk)." },
  { title: "No Collaboration",           desc: "Workflows are local to one device. There is no shared workspace or multi-user editing." },
  { title: "No Pipeline Versioning",     desc: "Workflow version history is not yet implemented — accidental overwrites are permanent." },
  { title: "Deduplicate Not Production-Safe", desc: "The deduplicate node is incomplete for very large datasets and may cause memory pressure." },
  { title: "Mobile Unfriendly",          desc: "The canvas editor and data tables are designed for keyboard + mouse on desktop screens." },
  { title: "Single Browser Tab",         desc: "Heavy operations run on the main thread. Opening two heavy pipelines in parallel may degrade both." },
];

export const Documentation = () => {
  return (
    <div className="p-4 md:px-10 md:py-6 h-full">
      <div className="mx-auto max-w-4xl w-full flex flex-col gap-y-10">

        {/* ── Header ── */}
        <div className="flex items-start gap-4">
          <div className="p-2 rounded-lg bg-muted mt-0.5">
            <BookOpenIcon className="size-5 text-muted-foreground" />
          </div>
          <div className="flex flex-col gap-y-2">
            <div>
              <h1 className="text-xl font-semibold">Documentation</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Architecture, design decisions, and competitive context for AutoPilot.
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {techBadges.map((t) => (
                <Badge key={t} variant="secondary" className="text-xs font-normal">{t}</Badge>
              ))}
            </div>
          </div>
        </div>

        {/* ── Project Intro ── */}
        <section className="flex flex-col gap-y-3">
          <h2 className="text-base font-semibold">What is AutoPilot?</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            AutoPilot is a <strong className="text-foreground">100% browser-native, offline-capable data pipeline platform</strong> for
            processing CSV files and PDF documents — with zero server uploads and no account required. Users build visual
            drag-and-drop workflows composed of typed nodes (Parse, Filter, Sort, Join, Aggregate, Compare, PDF Extract, …),
            execute them locally in the browser using OPFS-backed streaming, and export the results to CSV or Excel.
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            The entire execution engine runs in the browser tab. Large datasets that would crash a spreadsheet are handled via
            chunked OPFS storage and streaming algorithms (external merge sort, grace hash join) that never materialise the full
            dataset in heap memory at once. A resource governor enforces hard limits on memory, disk, and concurrency so the
            tab stays stable regardless of input size.
          </p>
        </section>

        {/* ── Problem Solved ── */}
        <section className="flex flex-col gap-y-4">
          <div>
            <h2 className="text-base font-semibold">Problems Solved</h2>
            <p className="text-sm text-muted-foreground mt-0.5">Why existing tools fall short for local data work.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {problems.map((p) => (
              <Card key={p.title} className="border bg-card">
                <CardHeader className="pb-1 pt-4 px-4">
                  <CardTitle className="text-sm font-medium">{p.title}</CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <p className="text-xs text-muted-foreground leading-relaxed">{p.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* ── Competition ── */}
        <section className="flex flex-col gap-y-4">
          <div>
            <h2 className="text-base font-semibold">Competition</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              How AutoPilot compares to other data processing tools across the dimensions that matter most.
            </p>
          </div>
          <div className="rounded-lg border overflow-hidden text-sm">
            <table className="w-full">
              <thead>
                <tr className="bg-muted/60 text-left text-xs font-medium text-muted-foreground">
                  <th className="px-4 py-2.5">Tool</th>
                  <th className="px-3 py-2.5">Type</th>
                  <th className="px-3 py-2.5 text-center">Offline</th>
                  <th className="px-3 py-2.5 text-center">No-Code</th>
                  <th className="px-3 py-2.5 text-center">Free</th>
                  <th className="px-3 py-2.5 text-center">Scales</th>
                  <th className="px-3 py-2.5 text-center">Private</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {competitors.map((row, i) => (
                  <tr key={row.tool} className={i === 0 ? "bg-green-50/60 dark:bg-green-950/30 font-medium" : "hover:bg-muted/30 transition-colors"}>
                    <td className="px-4 py-2.5 text-sm">{row.tool}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{row.type}</td>
                    <td className="px-3 py-2.5"><TernaryIcon value={row.offline} /></td>
                    <td className="px-3 py-2.5"><TernaryIcon value={row.noCode} /></td>
                    <td className="px-3 py-2.5"><TernaryIcon value={row.free} /></td>
                    <td className="px-3 py-2.5"><TernaryIcon value={row.scale} /></td>
                    <td className="px-3 py-2.5"><TernaryIcon value={row.privacy} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-2 bg-muted/30 border-t flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><CheckIcon className="size-3 text-green-600" /> Yes</span>
              <span className="flex items-center gap-1"><MinusIcon className="size-3 text-amber-500" /> Partial</span>
              <span className="flex items-center gap-1"><XIcon className="size-3 text-red-500" /> No</span>
            </div>
          </div>
        </section>

        {/* ── Architecture Diagram ── */}
        <section className="flex flex-col gap-y-4">
          <div>
            <h2 className="text-base font-semibold">Architecture Diagram</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Key modules and their relationships across the UI, engine, and storage layers.
            </p>
          </div>
          <div className="rounded-lg border bg-muted/20 p-6 overflow-x-auto">
            <svg
              viewBox="0 0 720 460"
              className="w-full min-w-[560px]"
              aria-label="AutoPilot architecture diagram"
            >
              <defs>
                <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                  <path d="M0,0 L0,6 L8,3 z" className="fill-muted-foreground" fill="currentColor" opacity="0.5" />
                </marker>
              </defs>

              {/* Layer labels */}
              <text x="8" y="60" fontSize="9" fontFamily="monospace" opacity="0.4" transform="rotate(-90,8,60)" textAnchor="middle">UI</text>
              <text x="8" y="180" fontSize="9" fontFamily="monospace" opacity="0.4" transform="rotate(-90,8,180)" textAnchor="middle">ENGINE</text>
              <text x="8" y="300" fontSize="9" fontFamily="monospace" opacity="0.4" transform="rotate(-90,8,300)" textAnchor="middle">DATA</text>
              <text x="8" y="420" fontSize="9" fontFamily="monospace" opacity="0.4" transform="rotate(-90,8,420)" textAnchor="middle">STORE</text>

              {/* Layer backgrounds */}
              <rect x="24" y="20"  width="688" height="90"  rx="6" fill="currentColor" className="text-blue-500/5" />
              <rect x="24" y="130" width="688" height="90"  rx="6" fill="currentColor" className="text-violet-500/5" />
              <rect x="24" y="240" width="688" height="90"  rx="6" fill="currentColor" className="text-amber-500/5" />
              <rect x="24" y="350" width="688" height="90"  rx="6" fill="currentColor" className="text-green-500/5" />

              {/* ── UI Layer ── */}
              {/* AppSidebar */}
              <rect x="36" y="38" width="140" height="56" rx="6" stroke="currentColor" strokeWidth="1" fill="currentColor" className="text-blue-100 dark:text-blue-950 stroke-blue-300 dark:stroke-blue-700" />
              <text x="106" y="58" fontSize="11" fontWeight="600" textAnchor="middle" className="fill-foreground">AppSidebar</text>
              <text x="106" y="72" fontSize="9"  textAnchor="middle" opacity="0.55">Navigation shell</text>
              <text x="106" y="84" fontSize="9"  textAnchor="middle" opacity="0.55">Jotai + Next.js Link</text>

              {/* PipelineEditor */}
              <rect x="270" y="38" width="180" height="56" rx="6" stroke="currentColor" strokeWidth="1" fill="currentColor" className="text-blue-100 dark:text-blue-950 stroke-blue-300 dark:stroke-blue-700" />
              <text x="360" y="58" fontSize="11" fontWeight="600" textAnchor="middle" className="fill-foreground">PipelineEditor</text>
              <text x="360" y="72" fontSize="9"  textAnchor="middle" opacity="0.55">@xyflow/react canvas</text>
              <text x="360" y="84" fontSize="9"  textAnchor="middle" opacity="0.55">nodes, edges, dagre layout</text>

              {/* ExecutionContext */}
              <rect x="544" y="38" width="156" height="56" rx="6" stroke="currentColor" strokeWidth="1" fill="currentColor" className="text-blue-100 dark:text-blue-950 stroke-blue-300 dark:stroke-blue-700" />
              <text x="622" y="58" fontSize="11" fontWeight="600" textAnchor="middle" className="fill-foreground">ExecutionContext</text>
              <text x="622" y="72" fontSize="9"  textAnchor="middle" opacity="0.55">Jotai atoms</text>
              <text x="622" y="84" fontSize="9"  textAnchor="middle" opacity="0.55">progress, status, metrics</text>

              {/* ── Engine Layer ── */}
              {/* NodeRegistry */}
              <rect x="36" y="148" width="160" height="56" rx="6" stroke="currentColor" strokeWidth="1" fill="currentColor" className="text-violet-100 dark:text-violet-950 stroke-violet-300 dark:stroke-violet-700" />
              <text x="116" y="168" fontSize="11" fontWeight="600" textAnchor="middle" className="fill-foreground">NodeRegistry</text>
              <text x="116" y="182" fontSize="9"  textAnchor="middle" opacity="0.55">NodeType → executor map</text>
              <text x="116" y="194" fontSize="9"  textAnchor="middle" opacity="0.55">lazy dynamic imports</text>

              {/* ExecutionEngine */}
              <rect x="270" y="148" width="180" height="56" rx="6" stroke="currentColor" strokeWidth="1" fill="currentColor" className="text-violet-100 dark:text-violet-950 stroke-violet-300 dark:stroke-violet-700" />
              <text x="360" y="168" fontSize="11" fontWeight="600" textAnchor="middle" className="fill-foreground">ExecutionEngine</text>
              <text x="360" y="182" fontSize="9"  textAnchor="middle" opacity="0.55">toposort → sequential run</text>
              <text x="360" y="194" fontSize="9"  textAnchor="middle" opacity="0.55">ResourceBudget enforcer</text>

              {/* ResourceGovernor */}
              <rect x="530" y="148" width="170" height="56" rx="6" stroke="currentColor" strokeWidth="1" fill="currentColor" className="text-violet-100 dark:text-violet-950 stroke-violet-300 dark:stroke-violet-700" />
              <text x="615" y="168" fontSize="11" fontWeight="600" textAnchor="middle" className="fill-foreground">ResourceGovernor</text>
              <text x="615" y="182" fontSize="9"  textAnchor="middle" opacity="0.55">256 MB mem · 4 GB disk</text>
              <text x="615" y="194" fontSize="9"  textAnchor="middle" opacity="0.55">1 concurrent heavy op</text>

              {/* ── Data Layer ── */}
              {/* DatasetRef */}
              <rect x="210" y="258" width="300" height="56" rx="6" stroke="currentColor" strokeWidth="1" fill="currentColor" className="text-amber-100 dark:text-amber-950 stroke-amber-300 dark:stroke-amber-700" />
              <text x="360" y="278" fontSize="11" fontWeight="600" textAnchor="middle" className="fill-foreground">DatasetRef</text>
              <text x="360" y="292" fontSize="9"  textAnchor="middle" opacity="0.55">inline (≤5k rows) OR disk-backed pointer</text>
              <text x="360" y="304" fontSize="9"  textAnchor="middle" opacity="0.55">auto-promotion threshold · schema metadata</text>

              {/* ── Storage Layer ── */}
              {/* OPFSStorage */}
              <rect x="80" y="368" width="200" height="56" rx="6" stroke="currentColor" strokeWidth="1" fill="currentColor" className="text-green-100 dark:text-green-950 stroke-green-300 dark:stroke-green-700" />
              <text x="180" y="388" fontSize="11" fontWeight="600" textAnchor="middle" className="fill-foreground">OPFSStorage</text>
              <text x="180" y="402" fontSize="9"  textAnchor="middle" opacity="0.55">chunked JSONL files</text>
              <text x="180" y="414" fontSize="9"  textAnchor="middle" opacity="0.55">Origin Private File System</text>

              {/* DexieDB */}
              <rect x="440" y="368" width="200" height="56" rx="6" stroke="currentColor" strokeWidth="1" fill="currentColor" className="text-green-100 dark:text-green-950 stroke-green-300 dark:stroke-green-700" />
              <text x="540" y="388" fontSize="11" fontWeight="600" textAnchor="middle" className="fill-foreground">DexieDB (IndexedDB)</text>
              <text x="540" y="402" fontSize="9"  textAnchor="middle" opacity="0.55">manifests · workflows</text>
              <text x="540" y="414" fontSize="9"  textAnchor="middle" opacity="0.55">executions · settings</text>

              {/* ── Arrows ── */}
              {/* AppSidebar → PipelineEditor */}
              <line x1="176" y1="66" x2="268" y2="66" stroke="currentColor" strokeWidth="1" opacity="0.35" markerEnd="url(#arrow)" />
              {/* PipelineEditor → ExecutionContext */}
              <line x1="450" y1="66" x2="542" y2="66" stroke="currentColor" strokeWidth="1" opacity="0.35" markerEnd="url(#arrow)" />
              {/* PipelineEditor → ExecutionEngine */}
              <line x1="360" y1="94" x2="360" y2="146" stroke="currentColor" strokeWidth="1" opacity="0.35" markerEnd="url(#arrow)" />
              {/* PipelineEditor → NodeRegistry */}
              <line x1="270" y1="80" x2="196" y2="148" stroke="currentColor" strokeWidth="1" opacity="0.35" markerEnd="url(#arrow)" />
              {/* ExecutionContext → ExecutionEngine */}
              <line x1="622" y1="94" x2="450" y2="176" stroke="currentColor" strokeWidth="1" opacity="0.35" markerEnd="url(#arrow)" />
              {/* ExecutionEngine → ResourceGovernor */}
              <line x1="450" y1="176" x2="528" y2="176" stroke="currentColor" strokeWidth="1" opacity="0.35" markerEnd="url(#arrow)" />
              {/* ExecutionEngine → DatasetRef */}
              <line x1="360" y1="204" x2="360" y2="256" stroke="currentColor" strokeWidth="1" opacity="0.35" markerEnd="url(#arrow)" />
              {/* NodeRegistry → ExecutionEngine */}
              <line x1="196" y1="176" x2="268" y2="176" stroke="currentColor" strokeWidth="1" opacity="0.35" markerEnd="url(#arrow)" />
              {/* DatasetRef → OPFSStorage */}
              <line x1="288" y1="314" x2="230" y2="366" stroke="currentColor" strokeWidth="1" opacity="0.35" markerEnd="url(#arrow)" />
              {/* DatasetRef → DexieDB */}
              <line x1="432" y1="314" x2="490" y2="366" stroke="currentColor" strokeWidth="1" opacity="0.35" markerEnd="url(#arrow)" />
            </svg>
          </div>
        </section>

        {/* ── Technical Explanation ── */}
        <section className="flex flex-col gap-y-4">
          <div>
            <h2 className="text-base font-semibold">Technical Deep Dive</h2>
            <p className="text-sm text-muted-foreground mt-0.5">How the key subsystems work under the hood.</p>
          </div>
          <div className="flex flex-col gap-y-3">
            {techSections.map((s) => (
              <Card key={s.title} className="border">
                <CardHeader className="pb-1 pt-4 px-4">
                  <CardTitle className="text-sm font-medium">{s.title}</CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <p className="text-xs text-muted-foreground leading-relaxed">{s.body}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* ── Perks ── */}
        <section className="flex flex-col gap-y-4">
          <div>
            <h2 className="text-base font-semibold">Perks</h2>
            <p className="text-sm text-muted-foreground mt-0.5">What AutoPilot does exceptionally well.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {perks.map((p) => (
              <div key={p.title} className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/40 p-4 flex flex-col gap-y-1.5">
                <div className="flex items-center gap-2">
                  <CheckIcon className="size-4 text-green-600 dark:text-green-400 shrink-0" />
                  <span className="text-sm font-medium">{p.title}</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed pl-6">{p.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Downsides ── */}
        <section className="flex flex-col gap-y-4 pb-10">
          <div>
            <h2 className="text-base font-semibold">Downsides & Current Limitations</h2>
            <p className="text-sm text-muted-foreground mt-0.5">Honest trade-offs and known gaps to be aware of.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {downsides.map((d) => (
              <div key={d.title} className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-4 flex flex-col gap-y-1.5">
                <div className="flex items-center gap-2">
                  <XIcon className="size-4 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span className="text-sm font-medium">{d.title}</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed pl-6">{d.desc}</p>
              </div>
            ))}
          </div>
        </section>

      </div>
    </div>
  );
};
