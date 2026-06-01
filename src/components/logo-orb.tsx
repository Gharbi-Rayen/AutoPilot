"use client";

import { cn } from "@/lib/utils";
import React from "react";

interface LogoOrbProps {
  size?: number;
  spin?: boolean;
  className?: string;
}

const RAINBOW =
  "conic-gradient(from 210deg, #ff3b30 0deg, #ff9500 50deg, #ffd60a 95deg, #34c759 150deg, #00c7be 195deg, #0a84ff 245deg, #5e5ce6 300deg, #bf5af2 340deg, #ff3b30 360deg)";

export function LogoOrb({ size = 36, spin = false, className }: LogoOrbProps) {
  const inset = Math.round(size * 0.11);
  const fontSize = Math.round(size * 0.25);

  return (
    <span
      className={cn("relative inline-flex shrink-0 select-none", className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {/* Outer rainbow ring — rotates */}
      <span
        className={spin ? "logo-orb-spin" : undefined}
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          background: RAINBOW,
        }}
      />
      {/* Inner white disc — counter-rotates to keep "AP" upright */}
      <span
        className={spin ? "logo-orb-counter" : undefined}
        style={{
          position: "absolute",
          inset: inset,
          borderRadius: "50%",
          background: "var(--card, #fff)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            fontWeight: 500,
            fontSize,
            letterSpacing: "-0.03em",
            lineHeight: 1,
            color: "var(--foreground, #18181b)",
          }}
        >
          AP
        </span>
      </span>
    </span>
  );
}
