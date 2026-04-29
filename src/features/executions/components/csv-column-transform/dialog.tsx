"use client";

import { createId } from "@paralleldrive/cuid2";
import { Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import z from "zod";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { FieldSuggestionInput } from "../csv-shared/field-suggestion-input";
import { SourceVariableInput } from "../csv-shared/source-variable-input";
import { useUpstreamVariableMetadata } from "../csv-shared/use-upstream-variable-metadata";
import { useVariableNameSuggestion } from "../csv-shared/use-variable-name-suggestion";
import { VariableNameInput } from "../csv-shared/variable-name-input";

// ── Op type definitions ───────────────────────────────────────────────────────

export type ColumnOpType =
  | "prepend"
  | "append"
  | "replace"
  | "remove"
  | "trim"
  | "case"
  | "formula"
  | "set";

export type ColumnOp = {
  id: string;
  type: ColumnOpType;
  // prepend / append / set
  text?: string;
  setValue?: string;
  // replace
  find?: string;
  replacement?: string;
  // remove
  pattern?: string;
  // replace + remove
  useRegex?: boolean;
  // case
  caseMode?: "upper" | "lower" | "title";
  // formula
  expression?: string;
};

export type ColumnTransform = {
  id: string;
  column: string;
  ops: ColumnOp[];
};

// ── Form schema (top-level fields only) ──────────────────────────────────────

const baseSchema = z.object({
  sourceVariable: z.string().min(1, "Source variable is required"),
  variableName: z
    .string()
    .min(1, "Output variable name is required")
    .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, {
      message:
        "Must start with a letter, underscore, or $ and contain only alphanumeric characters",
    }),
});

type BaseFormValues = z.infer<typeof baseSchema>;

export type CsvColumnTransformFormValues = BaseFormValues & {
  transforms: Array<{
    column: string;
    ops: Array<Omit<ColumnOp, "id">>;
  }>;
};

// ── Static metadata ───────────────────────────────────────────────────────────

const OP_LABELS: Record<ColumnOpType, string> = {
  prepend: "Prepend",
  append: "Append",
  replace: "Find & Replace",
  remove: "Remove",
  trim: "Trim Whitespace",
  case: "Change Case",
  formula: "Math Formula",
  set: "Set Value",
};

const OP_HINTS: Record<ColumnOpType, string> = {
  prepend: "Add text before every value in this column.",
  append: "Add text after every value in this column.",
  replace:
    'Find a pattern and swap it — use this to insert text "in the middle" by replacing a known anchor (e.g. replace "_" with "_ extra").',
  remove: "Delete all occurrences of a pattern from every value.",
  trim: "Strip leading and trailing whitespace from every value.",
  case: "Convert every value to UPPERCASE, lowercase, or Title Case.",
  formula:
    "Apply a math expression. Use v for the current numeric value — non-numeric values are left unchanged. Supported: +  −  *  /  **  %  Math.round  Math.abs  Math.floor  Math.ceil  Math.sqrt  Math.min  Math.max  Math.pow  Math.sign",
  set: "Replace every value in this column with a fixed string.",
};

function makeDefaultOp(type: ColumnOpType): ColumnOp {
  const id = createId();
  switch (type) {
    case "prepend":
      return { id, type, text: "" };
    case "append":
      return { id, type, text: "" };
    case "replace":
      return { id, type, find: "", replacement: "", useRegex: false };
    case "remove":
      return { id, type, pattern: "", useRegex: false };
    case "trim":
      return { id, type };
    case "case":
      return { id, type, caseMode: "upper" };
    case "formula":
      return { id, type, expression: "v" };
    case "set":
      return { id, type, setValue: "" };
  }
}

// ── OpRow — a single operation card ──────────────────────────────────────────

function OpRow({
  op,
  onUpdate,
  onRemove,
}: {
  op: ColumnOp;
  onUpdate: (patch: Partial<ColumnOp> & { type?: ColumnOpType }) => void;
  onRemove: () => void;
}) {
  const handleTypeChange = (newType: ColumnOpType) => {
    // Replace with fresh defaults for the new type, keeping the same id
    onUpdate({ ...makeDefaultOp(newType), id: op.id });
  };

  return (
    <div className="rounded-md border bg-muted/25 px-3 py-2.5 space-y-2">
      {/* Type selector row */}
      <div className="flex items-center gap-2">
        <Select value={op.type} onValueChange={(v) => handleTypeChange(v as ColumnOpType)}>
          <SelectTrigger className="h-7 w-44 text-xs font-medium shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(OP_LABELS) as ColumnOpType[]).map((t) => (
              <SelectItem key={t} value={t} className="text-xs">
                {OP_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <button
          type="button"
          onClick={onRemove}
          className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          aria-label="Remove operation"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* Hint */}
      <p className="text-[11px] leading-snug text-muted-foreground">
        {OP_HINTS[op.type]}
      </p>

      {/* Type-specific controls */}
      {op.type === "prepend" && (
        <div className="flex items-center gap-2">
          <Label className="text-xs shrink-0 w-10">Text</Label>
          <Input
            value={op.text ?? ""}
            onChange={(e) => onUpdate({ text: e.target.value })}
            placeholder='e.g.  $  or  "prefix_"'
            className="h-7 text-xs font-mono"
          />
        </div>
      )}

      {op.type === "append" && (
        <div className="flex items-center gap-2">
          <Label className="text-xs shrink-0 w-10">Text</Label>
          <Input
            value={op.text ?? ""}
            onChange={(e) => onUpdate({ text: e.target.value })}
            placeholder='e.g.  %  or  "_suffix"'
            className="h-7 text-xs font-mono"
          />
        </div>
      )}

      {op.type === "replace" && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-0.5">
              <Label className="text-[11px] text-muted-foreground">Find</Label>
              <Input
                value={op.find ?? ""}
                onChange={(e) => onUpdate({ find: e.target.value })}
                placeholder={op.useRegex ? "[^0-9.]" : "old text"}
                className="h-7 text-xs font-mono"
              />
            </div>
            <div className="space-y-0.5">
              <Label className="text-[11px] text-muted-foreground">Replace with</Label>
              <Input
                value={op.replacement ?? ""}
                onChange={(e) => onUpdate({ replacement: e.target.value })}
                placeholder="new text (or empty to delete)"
                className="h-7 text-xs font-mono"
              />
            </div>
          </div>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none w-fit">
            <Checkbox
              checked={op.useRegex ?? false}
              onCheckedChange={(v) => onUpdate({ useRegex: Boolean(v) })}
              className="size-3.5"
            />
            Use regular expression
          </label>
        </div>
      )}

      {op.type === "remove" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label className="text-xs shrink-0">Pattern</Label>
            <Input
              value={op.pattern ?? ""}
              onChange={(e) => onUpdate({ pattern: e.target.value })}
              placeholder={op.useRegex ? "[\\s]+" : "text to remove"}
              className="h-7 text-xs font-mono flex-1"
            />
          </div>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none w-fit">
            <Checkbox
              checked={op.useRegex ?? false}
              onCheckedChange={(v) => onUpdate({ useRegex: Boolean(v) })}
              className="size-3.5"
            />
            Use regular expression
          </label>
        </div>
      )}

      {op.type === "case" && (
        <Select
          value={op.caseMode ?? "upper"}
          onValueChange={(v) => onUpdate({ caseMode: v as "upper" | "lower" | "title" })}
        >
          <SelectTrigger className="h-7 text-xs w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="upper" className="text-xs">
              UPPERCASE
            </SelectItem>
            <SelectItem value="lower" className="text-xs">
              lowercase
            </SelectItem>
            <SelectItem value="title" className="text-xs">
              Title Case
            </SelectItem>
          </SelectContent>
        </Select>
      )}

      {op.type === "formula" && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Label className="text-xs font-mono shrink-0">v =</Label>
            <Input
              value={op.expression ?? "v"}
              onChange={(e) => onUpdate({ expression: e.target.value })}
              placeholder="v * 1.2"
              className="h-7 text-xs font-mono flex-1"
            />
          </div>
        </div>
      )}

      {op.type === "set" && (
        <div className="flex items-center gap-2">
          <Label className="text-xs shrink-0 w-10">Value</Label>
          <Input
            value={op.setValue ?? ""}
            onChange={(e) => onUpdate({ setValue: e.target.value })}
            placeholder="fixed value"
            className="h-7 text-xs font-mono flex-1"
          />
        </div>
      )}
    </div>
  );
}

// ── TransformBlock — one column + its stacked ops ────────────────────────────

function TransformBlock({
  entry,
  availableColumns,
  onColumnChange,
  onRemove,
  onOpsChange,
}: {
  entry: ColumnTransform;
  availableColumns: string[];
  onColumnChange: (col: string) => void;
  onRemove: () => void;
  onOpsChange: (ops: ColumnOp[]) => void;
}) {
  const addOp = () => onOpsChange([...entry.ops, makeDefaultOp("prepend")]);

  const updateOp = (opId: string, patch: Partial<ColumnOp> & { type?: ColumnOpType }) => {
    onOpsChange(
      entry.ops.map((op) =>
        op.id === opId ? { ...op, ...patch, id: opId } : op,
      ),
    );
  };

  const removeOp = (opId: string) =>
    onOpsChange(entry.ops.filter((op) => op.id !== opId));

  return (
    <div className="rounded-lg border bg-background shadow-sm overflow-hidden">
      {/* Column selector header */}
      <div className="flex items-center gap-2 border-b bg-muted/20 px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground shrink-0">
          Column
        </span>
        <div className="flex-1 min-w-0">
          <FieldSuggestionInput
            value={entry.column}
            onValueChange={onColumnChange}
            suggestions={availableColumns}
            mode="single"
            placeholder="Select or type a column name…"
            className="h-7 text-xs"
          />
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          aria-label="Remove this column transform"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      {/* Operations list */}
      <div className="px-3 py-2.5 space-y-2">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          Operations — applied top to bottom
        </p>

        {entry.ops.length === 0 ? (
          <p className="text-xs text-muted-foreground py-1 text-center">
            No operations yet. Add one below.
          </p>
        ) : (
          <div className="space-y-2">
            {entry.ops.map((op, idx) => (
              <div key={op.id} className="flex items-start gap-2">
                <span className="mt-2.5 text-[10px] font-mono text-muted-foreground/60 shrink-0 w-4 text-right">
                  {idx + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <OpRow
                    op={op}
                    onUpdate={(patch) => updateOp(op.id, patch)}
                    onRemove={() => removeOp(op.id)}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 w-full text-xs border-dashed"
          onClick={addOp}
        >
          <Plus className="mr-1 size-3" />
          Add operation
        </Button>
      </div>
    </div>
  );
}

// ── Main dialog ───────────────────────────────────────────────────────────────

interface CsvColumnTransformDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: CsvColumnTransformFormValues) => void;
  defaultValues?: Partial<{
    sourceVariable?: string;
    variableName?: string;
    transforms?: CsvColumnTransformFormValues["transforms"];
  }>;
  nodeId: string;
}

export const CsvColumnTransformDialog = ({
  open,
  onOpenChange,
  onSubmit,
  defaultValues = {},
  nodeId,
}: CsvColumnTransformDialogProps) => {
  // Top-level form (sourceVariable + variableName)
  const form = useForm<BaseFormValues>({
    resolver: zodResolver(baseSchema),
    defaultValues: {
      sourceVariable: defaultValues.sourceVariable ?? "",
      variableName: defaultValues.variableName ?? "transformedData",
    },
  });

  // Transforms managed as plain state (avoids deeply-nested field-array complexity)
  const [transforms, setTransforms] = useState<ColumnTransform[]>([]);
  const [transformError, setTransformError] = useState<string | null>(null);

  // Reset everything when dialog opens
  useEffect(() => {
    if (!open) return;
    form.reset({
      sourceVariable: defaultValues.sourceVariable ?? "",
      variableName: defaultValues.variableName ?? "transformedData",
    });
    setTransforms(
      (defaultValues.transforms ?? []).map((t) => ({
        id: createId(),
        column: t.column,
        ops: t.ops.map((op) => ({ ...op, id: createId() })),
      })),
    );
    setTransformError(null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const watchSourceVariable = form.watch("sourceVariable");
  const watchVariableName = form.watch("variableName") || "transformedData";
  const { getColumns } = useUpstreamVariableMetadata(nodeId, open);
  const availableColumns = getColumns(watchSourceVariable);
  const suggestion = useVariableNameSuggestion({ nodeId, sourceVariable: watchSourceVariable, suffix: "transformed", open });

  // ── Transform list helpers ──────────────────────────────────────────────────

  const addColumn = () => {
    setTransforms((prev) => [
      ...prev,
      { id: createId(), column: "", ops: [makeDefaultOp("prepend")] },
    ]);
    setTransformError(null);
  };

  const removeColumn = (id: string) =>
    setTransforms((prev) => prev.filter((t) => t.id !== id));

  const updateColumnName = (id: string, column: string) =>
    setTransforms((prev) =>
      prev.map((t) => (t.id === id ? { ...t, column } : t)),
    );

  const updateOps = (id: string, ops: ColumnOp[]) =>
    setTransforms((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ops } : t)),
    );

  // ── Submit ──────────────────────────────────────────────────────────────────

  const handleSubmit = form.handleSubmit((formValues) => {
    // Validate transforms manually
    if (transforms.length === 0) {
      setTransformError("Add at least one column transform.");
      return;
    }
    for (const t of transforms) {
      if (!t.column.trim()) {
        setTransformError("Every column block must have a column name selected.");
        return;
      }
      if (t.ops.length === 0) {
        setTransformError(
          `Column "${t.column}" has no operations — add at least one or remove the block.`,
        );
        return;
      }
    }
    setTransformError(null);

    onSubmit({
      ...formValues,
      transforms: transforms.map(({ column, ops }) => ({
        column,
        // strip the runtime-only `id` field before persisting
        ops: ops.map(({ id: _id, ...rest }) => rest),
      })),
    });
    onOpenChange(false);
  });

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Column Transform</DialogTitle>
        </DialogHeader>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          <Form {...form}>
            <form
              id="csv-column-transform-form"
              onSubmit={handleSubmit}
              className="space-y-5 py-1 pr-0.5"
            >
              {/* ── Source Variable ── */}
              <FormField
                control={form.control}
                name="sourceVariable"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Source Variable</FormLabel>
                    <FormControl>
                      <SourceVariableInput
                        nodeId={nodeId}
                        value={field.value}
                        onValueChange={field.onChange}
                        placeholder="csvRecords"
                      />
                    </FormControl>
                    <FormDescription>
                      The dataset whose column values you want to transform.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="border-t" />

              {/* ── Column Transforms ── */}
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Column Transforms</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Pick a column and stack one or more operations — they run
                      top-to-bottom in order.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0"
                    onClick={addColumn}
                  >
                    <Plus className="mr-1 size-3" />
                    Add Column
                  </Button>
                </div>

                {transforms.length === 0 ? (
                  <button
                    type="button"
                    onClick={addColumn}
                    className={cn(
                      "w-full rounded-lg border-2 border-dashed py-6 text-center transition-colors",
                      "text-muted-foreground hover:border-primary/40 hover:text-foreground",
                    )}
                  >
                    <Plus className="mx-auto mb-1 size-4 opacity-50" />
                    <span className="text-sm">Click to add your first column transform</span>
                  </button>
                ) : (
                  <div className="space-y-3">
                    {transforms.map((entry) => (
                      <TransformBlock
                        key={entry.id}
                        entry={entry}
                        availableColumns={availableColumns}
                        onColumnChange={(col) => updateColumnName(entry.id, col)}
                        onRemove={() => removeColumn(entry.id)}
                        onOpsChange={(ops) => updateOps(entry.id, ops)}
                      />
                    ))}
                  </div>
                )}

                {transformError && (
                  <p className="text-xs text-destructive font-medium">{transformError}</p>
                )}
              </div>

              <div className="border-t" />

              {/* ── Output Variable ── */}
              <FormField
                control={form.control}
                name="variableName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Output Variable Name</FormLabel>
                    <FormControl>
                      <VariableNameInput value={field.value} onChange={field.onChange} suggestion={suggestion} open={open} />
                    </FormControl>
                    <FormDescription>
                      Store the transformed rows as{" "}
                      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                        {`{{${watchVariableName}}}`}
                      </code>
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </form>
          </Form>
        </div>

        <DialogFooter className="border-t pt-3 shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="submit" size="sm" form="csv-column-transform-form">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
