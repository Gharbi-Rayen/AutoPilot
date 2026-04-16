/**
 * Performance Settings
 *
 * User-adjustable limits persisted to localStorage.
 * These are read by the main thread (worker-manager, union-executor) and
 * automatically injected into every worker job input by worker-manager.ts.
 *
 * Workers never read localStorage directly — they receive these values
 * as part of their job input via postMessage.
 */

const STORAGE_KEY = "autopilot:performance-settings";

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

export const DEFAULT_PERFORMANCE_SETTINGS: PerformanceSettings = {
  chunkSize: PERFORMANCE_PRESETS.balanced.chunkSize,
  maxUnionRows: PERFORMANCE_PRESETS.balanced.maxUnionRows,
};

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

export function savePerformanceSettings(settings: PerformanceSettings): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
