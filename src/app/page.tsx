"use client";

import {
  ArrowRightIcon,
  BrainCircuitIcon,
  FileSpreadsheetIcon,
  FlameIcon,
  LockKeyholeIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  ZapIcon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const features = [
  {
    icon: LockKeyholeIcon,
    title: "100% Private",
    description:
      "Every byte stays in your browser. No uploads, no servers, no accounts — your data never leaves your machine.",
  },
  {
    icon: FlameIcon,
    title: "Built for Scale",
    description:
      "Stream millions of rows without breaking a sweat. OPFS-backed chunked processing means no memory crashes.",
  },
  {
    icon: BrainCircuitIcon,
    title: "Visual Pipelines",
    description:
      "Drag, drop, and connect processing nodes. Filter → Sort → Deduplicate → Transform in minutes.",
  },
  {
    icon: ZapIcon,
    title: "Instant Execution",
    description:
      "Real-time progress tracking. Watch your pipeline run live with per-node status and timing.",
  },
  {
    icon: SlidersHorizontalIcon,
    title: "Powerful Operations",
    description:
      "Filter with 12+ operators, multi-key sort, smart deduplication, conditional transforms, joins, and aggregations.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Works Offline",
    description:
      "Install as a PWA and run entirely offline. No internet required after the first load.",
  },
];

const steps = [
  {
    number: "01",
    title: "Import your CSV",
    description:
      "Drag and drop any CSV file — local or from your filesystem. The parser handles headers, delimiters, and large files automatically.",
    icon: FileSpreadsheetIcon,
  },
  {
    number: "02",
    title: "Build your pipeline",
    description:
      "Add processing nodes and connect them visually. Filter rows, sort by any column, remove duplicates, join datasets, and more.",
    icon: BrainCircuitIcon,
  },
  {
    number: "03",
    title: "Run and export",
    description:
      "Execute with one click. Monitor progress live, inspect results inline, then download your clean data — segmented or as one file.",
    icon: ZapIcon,
  },
];

export default function IntroPage() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* ── Nav ─────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2.5 select-none">
            <Image
              src="/logos/logoTT.png"
              alt="AutoPilot"
              width={28}
              height={20}
              className="object-contain"
              priority
            />
            <span className="font-semibold text-sm tracking-tight">AutoPilot</span>
          </Link>
          <Button asChild size="sm">
            <Link href="/workflows">
              Open App
              <ArrowRightIcon className="ml-1.5 size-3.5" />
            </Link>
          </Button>
        </div>
      </header>

      <main className="flex-1">
        {/* ── Hero ────────────────────────────────────────────────── */}
        <section className="mx-auto flex max-w-4xl flex-col items-center px-6 pt-24 pb-20 text-center">
          <Badge
            variant="outline"
            className="mb-6 gap-1.5 rounded-full px-3 py-1 text-xs text-muted-foreground"
          >
            <span className="inline-block size-1.5 rounded-full bg-emerald-500" />
            Fully offline · No account needed · Free forever
          </Badge>

          <h1 className="text-5xl font-bold tracking-tight leading-[1.1] sm:text-6xl md:text-7xl">
            Automate your
            <br />
            <span className="text-muted-foreground">CSV workflows</span>
          </h1>

          <p className="mt-6 max-w-xl text-lg text-muted-foreground leading-relaxed">
            Build powerful data pipelines entirely in your browser — no code, no servers, no
            limits. Filter, sort, deduplicate, and transform millions of rows in seconds.
          </p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg" className="h-12 px-8 text-base">
              <Link href="/workflows">
                Get Started
                <ArrowRightIcon className="ml-2 size-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="h-12 px-8 text-base">
              <a href="#how-it-works">See how it works</a>
            </Button>
          </div>

          {/* Stat row */}
          <div className="mt-16 flex flex-wrap items-center justify-center gap-x-10 gap-y-4 text-sm text-muted-foreground">
            {[
              ["10M+", "rows processed per run"],
              ["100%", "browser-native, zero upload"],
              ["8", "node types built-in"],
            ].map(([value, label]) => (
              <div key={label} className="flex items-baseline gap-1.5">
                <span className="text-2xl font-bold text-foreground">{value}</span>
                <span>{label}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ── Features ────────────────────────────────────────────── */}
        <section className="border-t border-border/60 bg-accent/20">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <div className="mb-12 text-center">
              <h2 className="text-3xl font-bold tracking-tight">Everything you need</h2>
              <p className="mt-3 text-muted-foreground">
                Professional-grade data processing, running entirely in your browser.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((f) => (
                <div
                  key={f.title}
                  className="rounded-xl border border-border/60 bg-background p-6 transition-shadow hover:shadow-sm"
                >
                  <div className="mb-4 flex size-10 items-center justify-center rounded-lg bg-primary/10">
                    <f.icon className="size-5 text-primary" />
                  </div>
                  <h3 className="mb-2 font-semibold">{f.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {f.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── How it works ────────────────────────────────────────── */}
        <section id="how-it-works" className="border-t border-border/60">
          <div className="mx-auto max-w-5xl px-6 py-20">
            <div className="mb-14 text-center">
              <h2 className="text-3xl font-bold tracking-tight">How it works</h2>
              <p className="mt-3 text-muted-foreground">
                From raw CSV to clean, processed data in three steps.
              </p>
            </div>

            <div className="relative grid grid-cols-1 gap-10 md:grid-cols-3">
              {/* Connector line (desktop only) */}
              <div className="absolute top-8 left-[calc(16.67%+2rem)] right-[calc(16.67%+2rem)] hidden h-px bg-border md:block" />

              {steps.map((step, i) => (
                <div
                  key={step.number}
                  className="relative flex flex-col items-center text-center"
                >
                  <div className="relative mb-6 flex size-16 items-center justify-center rounded-full border-2 border-border bg-background">
                    <step.icon className="size-6 text-foreground" />
                    <span className="absolute -top-2 -right-2 flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                      {i + 1}
                    </span>
                  </div>
                  <div className="mb-1 font-mono text-xs text-muted-foreground">
                    {step.number}
                  </div>
                  <h3 className="mb-2 text-base font-semibold">{step.title}</h3>
                  <p className="max-w-xs text-sm text-muted-foreground leading-relaxed">
                    {step.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Bottom CTA ──────────────────────────────────────────── */}
        <section className="border-t border-border/60 bg-accent/20">
          <div className="mx-auto flex max-w-3xl flex-col items-center px-6 py-20 text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Ready to clean your data?
            </h2>
            <p className="mt-4 max-w-md text-muted-foreground">
              No sign-up. No installation. Open AutoPilot and start building your first workflow
              right now.
            </p>
            <Button asChild size="lg" className="mt-8 h-12 px-10 text-base">
              <Link href="/workflows">
                Open AutoPilot
                <ArrowRightIcon className="ml-2 size-4" />
              </Link>
            </Button>
          </div>
        </section>
      </main>

      {/* ── Footer ──────────────────────────────────────────────── */}
      <footer className="border-t border-border/60">
        <div className="mx-auto flex h-12 max-w-6xl items-center justify-between px-6 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} AutoPilot</span>
          <span>All processing happens in your browser</span>
        </div>
      </footer>
    </div>
  );
}
