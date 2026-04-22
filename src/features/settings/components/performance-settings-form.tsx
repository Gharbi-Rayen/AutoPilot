"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckIcon, CpuIcon, HardDriveIcon, MemoryStickIcon, Trash2Icon, ZapIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { useRemoveAllExecutions } from "@/features/executions/hooks/use-executions";
import { db } from "@/lib/db";
import { cn } from "@/lib/utils";
import {
  DEFAULT_PERFORMANCE_SETTINGS,
  PERFORMANCE_PRESETS,
  getPerformanceSettings,
  savePerformanceSettings,
  type PerformanceSettings,
} from "@/lib/performance-settings";

type PresetKey = keyof typeof PERFORMANCE_PRESETS;

const PRESET_ICONS: Record<PresetKey, React.ElementType> = {
  balanced: CpuIcon,
  performance: ZapIcon,
  maximum: MemoryStickIcon,
};

const PRESET_COLORS: Record<PresetKey, string> = {
  balanced: "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950",
  performance: "border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950",
  maximum: "border-purple-200 bg-purple-50 dark:border-purple-900 dark:bg-purple-950",
};

const PRESET_BADGE_COLORS: Record<PresetKey, string> = {
  balanced: "bg-green-100 text-green-700 border-green-200",
  performance: "bg-blue-100 text-blue-700 border-blue-200",
  maximum: "bg-purple-100 text-purple-700 border-purple-200",
};

function detectActivePreset(settings: PerformanceSettings): PresetKey | null {
  for (const [key, preset] of Object.entries(PERFORMANCE_PRESETS) as [PresetKey, typeof PERFORMANCE_PRESETS[PresetKey]][]) {
    if (settings.chunkSize === preset.chunkSize && settings.maxUnionRows === preset.maxUnionRows) {
      return key;
    }
  }
  return null;
}

export function PerformanceSettingsForm() {
  const [settings, setSettings] = useState<PerformanceSettings>(DEFAULT_PERFORMANCE_SETTINGS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSettings(getPerformanceSettings());
  }, []);

  const activePreset = detectActivePreset(settings);

  const applyPreset = (key: PresetKey) => {
    const preset = PERFORMANCE_PRESETS[key];
    setSettings({ chunkSize: preset.chunkSize, maxUnionRows: preset.maxUnionRows });
    setSaved(false);
  };

  const handleSave = () => {
    savePerformanceSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const formatRows = (n: number) =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${(n / 1_000).toFixed(0)}K`;

  return (
    <div className="flex flex-col gap-y-6">

      {/* ── Preset cards ─────────────────────────────────────────── */}
      <div>
        <h3 className="text-sm font-medium mb-3">Quick Presets</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {(Object.entries(PERFORMANCE_PRESETS) as [PresetKey, typeof PERFORMANCE_PRESETS[PresetKey]][]).map(([key, preset]) => {
            const Icon = PRESET_ICONS[key];
            const isActive = activePreset === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => applyPreset(key)}
                className={cn(
                  "relative text-left rounded-lg border-2 p-4 transition-all duration-150 hover:shadow-sm",
                  isActive ? PRESET_COLORS[key] : "border-border bg-card hover:border-muted-foreground/30",
                )}
              >
                {isActive && (
                  <span className="absolute top-2 right-2">
                    <CheckIcon className="size-4 text-green-600" />
                  </span>
                )}
                <div className="flex items-center gap-2 mb-2">
                  <Icon className="size-4 text-muted-foreground" />
                  <span className="font-semibold text-sm">{preset.label}</span>
                </div>
                <p className="text-xs text-muted-foreground mb-3">{preset.description}</p>
                <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                  <span>Chunk size: {formatRows(preset.chunkSize)} rows</span>
                  <span>Max union: {formatRows(preset.maxUnionRows)} rows</span>
                </div>
                <Badge
                  variant="outline"
                  className={cn("mt-3 text-xs", isActive ? PRESET_BADGE_COLORS[key] : "")}
                >
                  {preset.minRamGb}GB+ RAM required
                </Badge>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Custom sliders ────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Custom Limits</CardTitle>
          <CardDescription className="text-xs">
            Fine-tune individual settings. Changes take effect on the next workflow run.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-y-6">

          {/* Chunk size */}
          <div className="flex flex-col gap-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm">
                OPFS Chunk Size
                <span className="ml-2 font-mono text-muted-foreground">
                  {formatRows(settings.chunkSize)} rows / file
                </span>
              </Label>
              <Badge variant="outline" className="text-xs font-mono">
                {settings.chunkSize.toLocaleString()}
              </Badge>
            </div>
            <Slider
              min={5_000}
              max={100_000}
              step={5_000}
              value={[settings.chunkSize]}
              onValueChange={([v]) => { setSettings(s => ({ ...s, chunkSize: v })); setSaved(false); }}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>5K — less RAM, more files</span>
              <span>100K — more RAM, fewer files</span>
            </div>
            <p className="text-xs text-muted-foreground bg-muted rounded p-2">
              <strong>What this does:</strong> Controls how many rows are written per chunk file in OPFS storage.
              Larger chunks mean fewer file operations (faster on SSD) but each operation uses more RAM.
              Increase this if you have 8GB+ RAM and want faster CSV processing.
            </p>
          </div>

          {/* Max union rows */}
          <div className="flex flex-col gap-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm">
                Union / Join Row Limit
                <span className="ml-2 font-mono text-muted-foreground">
                  {formatRows(settings.maxUnionRows)} rows max
                </span>
              </Label>
              <Badge variant="outline" className="text-xs font-mono">
                {settings.maxUnionRows.toLocaleString()}
              </Badge>
            </div>
            <Slider
              min={100_000}
              max={10_000_000}
              step={100_000}
              value={[settings.maxUnionRows]}
              onValueChange={([v]) => { setSettings(s => ({ ...s, maxUnionRows: v })); setSaved(false); }}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>100K — safe on 4GB RAM</span>
              <span>10M — needs 16GB+ RAM</span>
            </div>
            <p className="text-xs text-muted-foreground bg-muted rounded p-2">
              <strong>What this does:</strong> Sets the maximum number of rows the CSV Join (Union) node will
              deduplicate in a single operation. The entire combined dataset is held in memory during
              deduplication. Increase this only if your computer has enough RAM — roughly 1GB of free RAM
              per 2 million rows.
            </p>
          </div>

        </CardContent>
      </Card>

      {/* ── RAM guide ─────────────────────────────────────────────── */}
      <Card className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-amber-800 dark:text-amber-200">
            How to choose the right settings for your PC
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-amber-900 dark:text-amber-100">
            <div className="flex flex-col gap-1">
              <span className="font-semibold">4 GB RAM (low-end laptop)</span>
              <span>→ Use <strong>Balanced</strong> preset</span>
              <span>→ Chunk: 10K, Union limit: 500K</span>
              <span>→ Max recommended CSV: ~200MB</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-semibold">8 GB RAM (modern laptop)</span>
              <span>→ Use <strong>Performance</strong> preset</span>
              <span>→ Chunk: 25K, Union limit: 2M</span>
              <span>→ Max recommended CSV: ~500MB</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-semibold">16 GB RAM (workstation)</span>
              <span>→ Use <strong>Maximum</strong> preset</span>
              <span>→ Chunk: 50K, Union limit: 5M</span>
              <span>→ Max recommended CSV: ~1GB</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-semibold">32 GB+ RAM (high-end)</span>
              <span>→ Use <strong>Custom</strong> sliders</span>
              <span>→ Chunk: 100K, Union limit: 10M</span>
              <span>→ Max recommended CSV: 2GB+</span>
            </div>
          </div>
          <p className="text-xs text-amber-800 dark:text-amber-200 mt-3">
            <strong>Note:</strong> These limits apply per workflow run. If a workflow fails with an
            out-of-memory error, lower the chunk size and union limit, then try again.
            Settings are saved locally and persist between sessions.
          </p>
        </CardContent>
      </Card>

      {/* ── Save button ───────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saved}>
          {saved ? (
            <>
              <CheckIcon className="size-4 mr-2" />
              Saved
            </>
          ) : (
            "Save Settings"
          )}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setSettings({ ...DEFAULT_PERFORMANCE_SETTINGS });
            setSaved(false);
          }}
        >
          Reset to Defaults
        </Button>
        {!saved && activePreset === null && (
          <span className="text-xs text-muted-foreground">Unsaved changes</span>
        )}
      </div>

      <StorageManagementSection />
    </div>
  );
}

function StorageManagementSection() {
  const [quota, setQuota] = useState<{ usage: number; quota: number } | null>(null);
  const [execCount, setExecCount] = useState<number | null>(null);
  const removeAll = useRemoveAllExecutions();

  const loadStats = useCallback(() => {
    navigator.storage.estimate().then((est) => {
      setQuota({ usage: est.usage ?? 0, quota: est.quota ?? 0 });
    });
    db.executions.count().then(setExecCount);
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const fmt = (bytes: number) => {
    if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
    if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(0)} KB`;
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <HardDriveIcon className="size-4 text-muted-foreground" />
          Storage Management
        </CardTitle>
        <CardDescription className="text-xs">
          Execution data (CSV chunks) is stored in your browser's private file system (OPFS).
          It is never uploaded anywhere but accumulates over time.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg border bg-muted/40 p-3 flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Browser storage used</span>
            <span className="font-semibold">
              {quota ? fmt(quota.usage) : "—"}
              {quota && quota.quota > 0 && (
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  of {fmt(quota.quota)}
                </span>
              )}
            </span>
          </div>
          <div className="rounded-lg border bg-muted/40 p-3 flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Saved executions</span>
            <span className="font-semibold">{execCount ?? "—"}</span>
          </div>
        </div>

        <Button
          variant="destructive"
          size="sm"
          className="w-fit gap-2"
          disabled={removeAll.isPending || execCount === 0}
          onClick={() => {
            if (confirm("Delete all execution data? This cannot be undone.")) {
              removeAll.mutate(undefined, { onSuccess: loadStats });
            }
          }}
        >
          <Trash2Icon className="size-3.5" />
          {removeAll.isPending ? "Clearing..." : "Clear All Execution Data"}
        </Button>
      </CardContent>
    </Card>
  );
}
