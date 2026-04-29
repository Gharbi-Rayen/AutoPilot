"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { SourceVariableInput } from "../csv-shared/source-variable-input";
import { useUpstreamVariableMetadata } from "../csv-shared/use-upstream-variable-metadata";
import { useVariableNameSuggestion } from "../csv-shared/use-variable-name-suggestion";
import { VariableNameInput } from "../csv-shared/variable-name-input";

// ─── Schema ───────────────────────────────────────────────────────────────────

const outputColumnSchema = z.object({
  type: z.enum(["passthrough", "computed"]),
  name: z.string().min(1, "Column name is required"),
  expression: z.string().optional(),
});

const formSchema = z.object({
  sourceVariable: z.string().min(1, "Source variable is required"),
  outputColumns: z
    .array(outputColumnSchema)
    .min(1, "At least one output column is required"),
  variableName: z
    .string()
    .min(1, { message: "Variable name is required" })
    .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, {
      message:
        "Must start with a letter or underscore and contain only alphanumeric characters",
    }),
});

export type OutputColumn = z.infer<typeof outputColumnSchema>;
export type CsvRestructureFormValues = z.infer<typeof formSchema>;

// ─── Props ────────────────────────────────────────────────────────────────────

interface CsvRestructureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: CsvRestructureFormValues) => void;
  defaultValues?: Partial<CsvRestructureFormValues>;
  nodeId: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const CsvRestructureDialog = ({
  open,
  onOpenChange,
  onSubmit,
  defaultValues = {},
  nodeId,
}: CsvRestructureDialogProps) => {
  const defaultValuesRef = useRef(defaultValues);
  defaultValuesRef.current = defaultValues;

  const form = useForm<CsvRestructureFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      sourceVariable: defaultValues.sourceVariable ?? "",
      outputColumns: defaultValues.outputColumns ?? [],
      variableName: defaultValues.variableName ?? "",
    },
  });

  const { fields, append, remove, swap } = useFieldArray({
    control: form.control,
    name: "outputColumns",
  });

  const watchSourceVariable = form.watch("sourceVariable");
  const watchOutputColumns = form.watch("outputColumns") ?? [];
  const { getColumns } = useUpstreamVariableMetadata(nodeId, open);

  const suggestion = useVariableNameSuggestion({
    nodeId,
    sourceVariable: watchSourceVariable,
    suffix: "restructured",
    open,
  });

  // Reset when dialog opens
  useEffect(() => {
    if (!open) return;
    const dv = defaultValuesRef.current;
    form.reset({
      sourceVariable: dv.sourceVariable ?? "",
      outputColumns: dv.outputColumns ?? [],
      variableName: dv.variableName ?? "",
    });
  }, [open, form]);

  // Pre-populate passthrough columns when source variable changes
  const prevSourceRef = useRef<string>("");
  useEffect(() => {
    if (!open || !watchSourceVariable) return;
    if (watchSourceVariable === prevSourceRef.current) return;
    prevSourceRef.current = watchSourceVariable;

    const cols = getColumns(watchSourceVariable);
    if (cols.length === 0) return;

    const existing = form.getValues("outputColumns");
    const computed = existing.filter((c) => c.type === "computed");
    const newCols: OutputColumn[] = [
      ...cols.map((name) => ({ type: "passthrough" as const, name, expression: "" })),
      ...computed,
    ];
    form.setValue("outputColumns", newCols, { shouldValidate: false });
  }, [watchSourceVariable, open, getColumns, form]);

  // Reset prevSource when dialog closes so next open re-evaluates
  useEffect(() => {
    if (!open) prevSourceRef.current = "";
  }, [open]);

  const handleSubmit = (values: CsvRestructureFormValues) => {
    onSubmit(values);
    onOpenChange(false);
  };

  const hasComputed = watchOutputColumns.some((c) => c.type === "computed");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>CSV Restructure</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-4">
          <Form {...form}>
            <form
              id="csv-restructure-form"
              onSubmit={form.handleSubmit(handleSubmit)}
              className="space-y-5"
            >
              {/* Source Variable */}
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
                        placeholder="parsedData"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Output Columns */}
              <div className="space-y-2">
                <FormLabel>Output Columns</FormLabel>

                {fields.length === 0 && (
                  <p className="text-sm text-muted-foreground py-2">
                    Select a source variable to auto-populate columns, or add a
                    computed column manually.
                  </p>
                )}

                <div className="space-y-1.5">
                  {fields.map((field, index) => {
                    const colType = watchOutputColumns[index]?.type;
                    return (
                      <div
                        key={field.id}
                        className="flex items-start gap-2 rounded-md border bg-muted/30 p-2"
                      >
                        {/* Reorder buttons */}
                        <div className="flex flex-col gap-0.5 pt-0.5 shrink-0">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-5"
                            disabled={index === 0}
                            onClick={() => swap(index, index - 1)}
                          >
                            <ChevronUp className="size-3" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-5"
                            disabled={index === fields.length - 1}
                            onClick={() => swap(index, index + 1)}
                          >
                            <ChevronDown className="size-3" />
                          </Button>
                        </div>

                        {/* Column content */}
                        <div className="flex-1 min-w-0 space-y-1">
                          {colType === "passthrough" ? (
                            <Badge
                              variant="secondary"
                              className="font-mono text-xs max-w-full truncate"
                            >
                              {watchOutputColumns[index]?.name}
                            </Badge>
                          ) : (
                            <div className="space-y-1">
                              <FormField
                                control={form.control}
                                name={`outputColumns.${index}.name`}
                                render={({ field: nameField }) => (
                                  <FormItem>
                                    <FormControl>
                                      <Input
                                        placeholder="new_column"
                                        className="h-7 text-xs font-mono"
                                        {...nameField}
                                      />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                              <FormField
                                control={form.control}
                                name={`outputColumns.${index}.expression`}
                                render={({ field: exprField }) => (
                                  <FormItem>
                                    <FormControl>
                                      <Input
                                        placeholder="e.g. {{price}} * {{qty}}"
                                        className="h-7 text-xs font-mono"
                                        {...exprField}
                                      />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            </div>
                          )}
                        </div>

                        {/* Type badge + remove */}
                        <div className="flex items-center gap-1 shrink-0">
                          <Badge
                            variant={colType === "computed" ? "default" : "outline"}
                            className="text-[10px] px-1.5 py-0"
                          >
                            {colType}
                          </Badge>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-6 text-muted-foreground hover:text-destructive"
                            onClick={() => remove(index)}
                          >
                            <X className="size-3" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full mt-1"
                  onClick={() =>
                    append({ type: "computed", name: "", expression: "" })
                  }
                >
                  <Plus className="size-4 mr-1" />
                  Add Computed Column
                </Button>

                {form.formState.errors.outputColumns?.message && (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.outputColumns.message}
                  </p>
                )}
              </div>

              {/* Expression hint (shown when at least one computed column exists) */}
              {hasComputed && (
                <p className="text-xs text-muted-foreground">
                  Reference columns with{" "}
                  <span className="font-mono">{"{{columnName}}"}</span>. Math
                  operators, comparisons, and{" "}
                  <span className="font-mono">Math.*</span> functions are
                  supported.
                </p>
              )}

              {/* Output Variable Name */}
              <FormField
                control={form.control}
                name="variableName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Output Variable Name</FormLabel>
                    <FormControl>
                      <VariableNameInput
                        value={field.value}
                        onChange={field.onChange}
                        suggestion={suggestion}
                        open={open}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </form>
          </Form>
        </div>

        <DialogFooter className="pt-2 border-t">
          <Button type="submit" form="csv-restructure-form">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
