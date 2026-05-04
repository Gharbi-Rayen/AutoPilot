/**
 * FILE: src/lib/performance-settings.ts
 *
 * PURPOSE:
 *   Manages user-adjustable performance settings — the chunk size and max union rows
 *   that control how much data is processed in memory at once.  Settings are stored
 *   in localStorage so they survive page refreshes and are user-specific.
 *
 * WHAT IS localStorage?
 *   localStorage is a browser API that stores key-value pairs persistently.
 *   Unlike a session cookie, localStorage survives closing and reopening the browser.
 *   It is synchronous (no Promise needed) and stores only strings.
 *   Each origin (e.g. http://localhost:3000) has its own isolated localStorage.
 *
 *   API:
 *     localStorage.setItem("key", "value") — save
 *     localStorage.getItem("key")           — read (returns null if not found)
 *     localStorage.removeItem("key")        — delete
 *
 * WHY WORKERS CANNOT READ localStorage:
 *   Web Workers run in a separate global scope (DedicatedWorkerGlobalScope).
 *   The `window` object is NOT available inside a worker.
 *   localStorage is a property of `window`, so workers cannot access it.
 *   Solution: the main thread reads localStorage via getPerformanceSettings(),
 *   then injects the values into every worker job message via worker-manager.ts.
 *
 * WHAT ARE PERFORMANCE SETTINGS?
 *   chunkSize    — how many rows per OPFS chunk file.
 *                  Larger chunks = fewer files but more RAM per read.
 *   maxUnionRows — the threshold above which join/compare use grace hash join
 *                  (OPFS partitioning) instead of an in-memory Map.
 *
 * USED IN:
 *   src/lib/worker-manager.ts                               — injects into every job via postMessage
 *   src/features/settings/components/performance-settings.tsx — settings form reads/writes these
 *   src/workers/csv-sort.worker.ts                          — reads input.chunkSize
 *   src/workers/csv-join.worker.ts                          — reads input.maxUnionRows
 *   src/workers/csv-compare.worker.ts                       — reads input.maxUnionRows
 */

/**
 * STORAGE_KEY
 *
 * WHY THIS EXISTS:
 *   A constant key string used for localStorage to avoid magic strings scattered
 *   throughout the code.  If the key ever changes, only one line needs updating.
 *   The "autopilot:" prefix namespaces it to avoid collisions with any other
 *   library or future feature that also uses localStorage.
 */
const STORAGE_KEY = "autopilot:performance-settings";

/**
 * PerformanceSettings
 *
 * WHY THIS EXISTS:
 *   Defines the shape of the performance settings object.  Both getPerformanceSettings()
 *   (reads from localStorage) and savePerformanceSettings() (writes to localStorage)
 *   use this type to ensure consistency.  Workers also receive this as part of their
 *   job input, typed loosely as part of the input object.
 *
 * FIELD MEANINGS:
 *   chunkSize    — number of rows written per OPFS chunk file.
 *                  Tradeoff: larger = faster sequential processing, more RAM per chunk read.
 *                  Range: 5 000 – 100 000.  Default: 10 000.
 *   maxUnionRows — maximum rows in the "right side" of a join or compare before the
 *                  algorithm switches from in-memory Map to grace hash join (disk-based).
 *                  Range: 100 000 – 10 000 000.  Default: 500 000.
 *
 * USED IN:
 *   PERFORMANCE_PRESETS        — each preset has these two fields
 *   DEFAULT_PERFORMANCE_SETTINGS — default values
 *   getPerformanceSettings()   — return type
 *   savePerformanceSettings()  — parameter type
 *   worker-manager.ts          — merged into every job's input payload
 */
export type PerformanceSettings = {
  /**
   * Rows per OPFS chunk file.
   * Larger = fewer files written, faster sequential I/O, more RAM per operation.
   * Default: 10 000  Min: 5 000  Max: 100 000
   */
  chunkSize: number;

  /**
   * Maximum rows processed by CSV union/join deduplication.
   * Larger = bigger merges supported, but holds the full set in a Map in-memory.
   * Default: 500 000  Min: 100 000  Max: 10 000 000
   */
  maxUnionRows: number;
};

/**
 * PERFORMANCE_PRESETS
 *
 * WHY THIS EXISTS:
 *   Provides three named configurations so users don't need to understand the raw
 *   numbers.  The Settings page shows these as labelled buttons: "Balanced",
 *   "Performance", "Maximum".  Clicking one fills the form with these values.
 *
 * WHAT IS `as const`?
 *   Normally TypeScript widens literal types:
 *     const x = { a: 10 } → TypeScript infers { a: number }
 *   With `as const`, TypeScript keeps the exact literal values:
 *     const x = { a: 10 } as const → TypeScript infers { a: 10 } (not number)
 *   This is useful because it prevents accidentally setting chunkSize to an arbitrary number
 *   — the type is exactly the preset value.
 *
 * FIELD MEANINGS per preset:
 *   label       — displayed name in the UI
 *   description — short human-readable description
 *   minRamGb    — recommended minimum RAM to use this preset without risk of OOM
 *   chunkSize   — rows per chunk for this preset
 *   maxUnionRows — join/compare threshold for this preset
 *
 * USED IN:
 *   src/features/settings/components/performance-settings.tsx — preset buttons
 *   DEFAULT_PERFORMANCE_SETTINGS — borrows the "balanced" preset values
 */
export const PERFORMANCE_PRESETS = {
  balanced: {
    label: "Balanced",
    description: "Works reliably on any PC",
    minRamGb: 4,
    chunkSize: 10_000,
    maxUnionRows: 500_000,
  },
  performance: {
    label: "Performance",
    description: "Faster processing, larger datasets",
    minRamGb: 8,
    chunkSize: 25_000,
    maxUnionRows: 2_000_000,
  },
  maximum: {
    label: "Maximum",
    description: "Best for high-RAM workstations",
    minRamGb: 16,
    chunkSize: 50_000,
    maxUnionRows: 5_000_000,
  },
} as const;

/**
 * DEFAULT_PERFORMANCE_SETTINGS
 *
 * WHY THIS EXISTS:
 *   Used as the fallback when no settings have been saved to localStorage yet
 *   (first-time user) or when the stored JSON is invalid/corrupted.
 *   Defaults to the "balanced" preset — the safest choice for unknown hardware.
 *
 * USED IN:
 *   getPerformanceSettings() — returned when localStorage has no value or fails to parse
 */
export const DEFAULT_PERFORMANCE_SETTINGS: PerformanceSettings = {
  chunkSize: PERFORMANCE_PRESETS.balanced.chunkSize,
  maxUnionRows: PERFORMANCE_PRESETS.balanced.maxUnionRows,
};

/**
 * getPerformanceSettings()
 *
 * WHY THIS EXISTS:
 *   Reads the current performance settings from localStorage, with safe fallback
 *   to defaults if the value is missing or unparseable.
 *
 * WHY `typeof window === "undefined"`?
 *   During Next.js static build (running in Node.js), `window` does not exist.
 *   Calling localStorage without this guard would throw "ReferenceError: window is not defined".
 *   The guard makes this function safe to call in both browser and build environments.
 *
 * WHY Partial<PerformanceSettings>?
 *   The stored JSON may be an older version missing some fields.
 *   Casting to Partial<PerformanceSettings> lets us safely use `??` to fill in
 *   any missing fields with defaults — no runtime error if a field is undefined.
 *
 * WHAT IS the `??` (nullish coalescing) operator?
 *   `a ?? b` returns `a` if a is not null/undefined, otherwise returns `b`.
 *   This is different from `a || b` which also replaces falsy values like 0 or "".
 *   Here we want to keep 0 if the user set chunkSize to 0 (though that's invalid),
 *   so `??` is more precise than `||`.
 *
 * RETURNS:
 *   PerformanceSettings — either the user's saved settings or the defaults
 *
 * CALLED FROM:
 *   src/lib/worker-manager.ts — dispatchWorkerJob() calls this before every postMessage
 */
export function getPerformanceSettings(): PerformanceSettings {
  if (typeof window === "undefined") return { ...DEFAULT_PERFORMANCE_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PERFORMANCE_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<PerformanceSettings>;
    return {
      chunkSize: parsed.chunkSize ?? DEFAULT_PERFORMANCE_SETTINGS.chunkSize,
      maxUnionRows: parsed.maxUnionRows ?? DEFAULT_PERFORMANCE_SETTINGS.maxUnionRows,
    };
  } catch {
    return { ...DEFAULT_PERFORMANCE_SETTINGS };
  }
}

/**
 * savePerformanceSettings()
 *
 * WHY THIS EXISTS:
 *   Persists the user's chosen performance settings to localStorage so they
 *   survive page reload.  Uses JSON.stringify because localStorage only stores strings.
 *
 * WHY `typeof window === "undefined"` guard?
 *   Same reason as getPerformanceSettings() — prevents errors during SSR/build.
 *
 * WHAT IS JSON.stringify?
 *   Converts a JavaScript object to a JSON string for storage:
 *     JSON.stringify({ chunkSize: 10000, maxUnionRows: 500000 })
 *     → '{"chunkSize":10000,"maxUnionRows":500000}'
 *   The string is what actually gets stored in localStorage.
 *
 * CALLED FROM:
 *   src/features/settings/components/performance-settings.tsx — form submit handler
 */
export function savePerformanceSettings(settings: PerformanceSettings): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
