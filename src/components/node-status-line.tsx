"use client";

import { cn } from "@/lib/utils";

const DELAYS = ["0ms", "150ms", "300ms"] as const;

interface NodeStatusLineProps {
  text: string;
  className?: string;
}

/**
 * Unified running/loading feedback strip.
 * Three bouncing dots + one line of text — no spinner, no extra titles.
 */
export const NodeStatusLine = ({ text, className }: NodeStatusLineProps) => (
  <div
    className={cn(
      "flex items-center gap-2.5 rounded-md border border-border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground",
      className,
    )}
  >
    <span className="flex shrink-0 items-end gap-[3px]" aria-hidden>
      {DELAYS.map((delay) => (
        <span
          key={delay}
          className="inline-block size-1.5 animate-bounce rounded-full bg-current"
          style={{ animationDelay: delay }}
        />
      ))}
    </span>
    <span>{text}</span>
  </div>
);
