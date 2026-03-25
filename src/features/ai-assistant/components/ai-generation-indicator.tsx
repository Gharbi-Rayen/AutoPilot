"use client";

// Small loading pill centered on the React Flow canvas.
// Lives at z-index 40 so the AI panel (z-50) always renders on top of it.
// pointer-events: none means it never blocks clicks on the canvas or panel.

import { useAtomValue } from "jotai";
import { Loader2 } from "lucide-react";
import { aiGeneratingAtom, aiGenerationStepAtom } from "../store/atoms";

const STEPS = [
  "Reading your request…",
  "Selecting nodes…",
  "Writing code & templates…",
  "Calculating layout…",
];

export function AiGenerationIndicator() {
  const isGenerating = useAtomValue(aiGeneratingAtom);
  const currentStep = useAtomValue(aiGenerationStepAtom);

  if (!isGenerating) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: 40,
        pointerEvents: "none",
      }}
    >
      <div
        className="bg-background border rounded-xl shadow-lg"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          padding: "16px 20px",
          width: "260px",
        }}
      >
        {/* Top row: spinner + current step text */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <Loader2
            className="text-primary animate-spin"
            style={{ width: "16px", height: "16px", flexShrink: 0 }}
          />
          <span
            className="text-foreground"
            style={{
              fontSize: "13px",
              fontWeight: 500,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {STEPS[currentStep]}
          </span>
        </div>

        {/* Step dots — 4 dots, past steps filled+faded, active dot wide,
            future steps are border-only. Smooth CSS transitions. */}
        <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={
                i < currentStep
                  ? "bg-primary"       // past step: filled, faded
                  : i === currentStep
                  ? "bg-primary"       // active step: filled, full opacity, wider
                  : "bg-border"        // future step: unfilled
              }
              style={{
                height: "4px",
                borderRadius: "2px",
                flexShrink: 0,
                // Active dot is wider to show progress
                width: i === currentStep ? "28px" : "8px",
                opacity: i < currentStep ? 0.35 : 1,
                transition: "width 0.4s ease, opacity 0.4s ease",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}