"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import z from "zod";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FieldSuggestionInput } from "../csv-shared/field-suggestion-input";
import { SourceVariableInput } from "../csv-shared/source-variable-input";
import { useUpstreamVariableMetadata } from "../csv-shared/use-upstream-variable-metadata";
import { useVariableNameSuggestion } from "../csv-shared/use-variable-name-suggestion";
import { VariableNameInput } from "../csv-shared/variable-name-input";

const formSchemaBase = z.object({
  leftVariable: z.string().min(1, { message: "Left variable is required" }),
  rightVariable: z.string().min(1, { message: "Right variable is required" }),
  keyPairs: z.array(
    z.object({
      leftKey: z.string(),
      rightKey: z.string(),
    }),
  ),
  joinType: z.enum([
    "inner",
    "left",
    "right",
    "full",
    "full_exclusive",
    "left_exclusive",
    "right_exclusive",
  ]),
  caseInsensitive: z.boolean().optional(),
  outputColumns: z
    .array(
      z.object({
        source: z.enum(["left", "right"]),
        column: z.string().min(1, { message: "Column is required" }),
        alias: z.string().optional(),
      }),
    )
    .optional(),
  variableName: z
    .string()
    .min(1, { message: "Variable name is required" })
    .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, {
      message:
        "Must start with a letter, underscore, or dollar sign and contain only alphanumeric characters",
    }),
});

const formSchema = formSchemaBase.superRefine((data, ctx) => {
  if (data.keyPairs.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "At least one key pair is required",
      path: ["keyPairs"],
    });

    return;
  }

  data.keyPairs.forEach((pair, index) => {
    if (!pair.leftKey.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Left key is required",
        path: ["keyPairs", index, "leftKey"],
      });
    }

    if (!pair.rightKey.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Right key is required",
        path: ["keyPairs", index, "rightKey"],
      });
    }
  });
});

export type CsvJoinFormValues = z.infer<typeof formSchemaBase>;

interface CsvJoinDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: CsvJoinFormValues) => void;
  defaultValues?: Partial<CsvJoinFormValues> & {
    leftKey?: string;
    rightKey?: string;
  };
  nodeId: string;
}

export const CsvJoinDialog = ({
  open,
  onOpenChange,
  onSubmit,
  defaultValues = {},
  nodeId,
}: CsvJoinDialogProps) => {
  const form = useForm<CsvJoinFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      leftVariable: defaultValues.leftVariable || "",
      rightVariable: defaultValues.rightVariable || "",
      joinType: defaultValues.joinType || "inner",
      caseInsensitive: defaultValues.caseInsensitive ?? false,
      variableName: defaultValues.variableName || "",
      keyPairs:
        defaultValues.keyPairs ||
        (defaultValues.leftKey && defaultValues.rightKey
          ? [
              {
                leftKey: defaultValues.leftKey,
                rightKey: defaultValues.rightKey,
              },
            ]
          : []),
    },
  });

  const { fields, append, remove } = useFieldArray({
    name: "keyPairs",
    control: form.control,
  });

  const {
    fields: outputFields,
    append: appendOutput,
    remove: removeOutput,
  } = useFieldArray({
    name: "outputColumns",
    control: form.control,
  });

  const watchVariableName = form.watch("variableName") || "joinedData";
  const watchJoinType = form.watch("joinType");
  const watchLeftVariable = form.watch("leftVariable");
  const watchRightVariable = form.watch("rightVariable");

  const [isOutputColumnsOpen, setIsOutputColumnsOpen] = useState(false);
  const { getColumns, getRowCount } = useUpstreamVariableMetadata(nodeId, open);
  const leftFieldSuggestions = getColumns(watchLeftVariable);
  const rightFieldSuggestions = getColumns(watchRightVariable);
  const suggestion = useVariableNameSuggestion({ nodeId, sourceVariable: watchLeftVariable, secondaryVariable: watchRightVariable, suffix: "joined", open });
  const leftRowCount = getRowCount(watchLeftVariable);
  const rightRowCount = getRowCount(watchRightVariable);

  const estimateFromPreview = useMemo(() => {
    if (typeof leftRowCount !== "number" || typeof rightRowCount !== "number") {
      return null;
    }

    let estimatedOutputRows = 0;
    if (watchJoinType === "full") {
      // Worst case (zero key overlap) = L + R.
      estimatedOutputRows = leftRowCount + rightRowCount;
    } else if (watchJoinType === "full_exclusive") {
      // Upper bound: rows with no match on either side = L + R.
      estimatedOutputRows = leftRowCount + rightRowCount;
    } else if (watchJoinType === "left") {
      estimatedOutputRows = leftRowCount;
    } else if (watchJoinType === "left_exclusive") {
      estimatedOutputRows = leftRowCount;
    } else if (watchJoinType === "right") {
      estimatedOutputRows = rightRowCount;
    } else if (watchJoinType === "right_exclusive") {
      estimatedOutputRows = rightRowCount;
    } else {
      // inner: upper bound = min(L, R).
      estimatedOutputRows = Math.min(leftRowCount, rightRowCount);
    }

    const riskLevel =
      estimatedOutputRows >= 1_000_000
        ? "high"
        : estimatedOutputRows >= 100_000
          ? "medium"
          : "low";

    return {
      estimatedOutputRows,
      riskLevel,
    };
  }, [leftRowCount, rightRowCount, watchJoinType]);

  useEffect(() => {
    if (open) {
      form.reset({
        leftVariable: defaultValues.leftVariable || "",
        rightVariable: defaultValues.rightVariable || "",
        joinType: defaultValues.joinType || "inner",
        caseInsensitive: defaultValues.caseInsensitive ?? false,
        variableName: defaultValues.variableName || "",
        outputColumns: defaultValues.outputColumns || [],
        keyPairs:
          defaultValues.keyPairs ||
          (defaultValues.leftKey && defaultValues.rightKey
            ? [
                {
                  leftKey: defaultValues.leftKey,
                  rightKey: defaultValues.rightKey,
                },
              ]
            : []),
      });
    }
  }, [open, defaultValues, form]);

  const handleSubmit = (values: CsvJoinFormValues) => {
    const normalizedValues: CsvJoinFormValues = {
      ...values,
      keyPairs: values.keyPairs
        .map((pair) => ({
          leftKey: pair.leftKey.trim(),
          rightKey: pair.rightKey.trim(),
        }))
        .filter((pair) => pair.leftKey.length > 0 && pair.rightKey.length > 0),
    };

    onSubmit(normalizedValues);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Join CSV Datasets</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-1 py-4 min-h-0">
          <Form {...form}>
            <form
              id="csv-join-form"
              onSubmit={form.handleSubmit(handleSubmit)}
              className="space-y-5"
            >
              <FormField
                control={form.control}
                name="leftVariable"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Left Variable</FormLabel>
                    <FormControl>
                      <SourceVariableInput nodeId={nodeId} value={field.value} onValueChange={field.onChange} placeholder="customersData" />
                    </FormControl>
                    <FormDescription>Primary dataset records</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="rightVariable"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Right Variable</FormLabel>
                    <FormControl>
                      <SourceVariableInput nodeId={nodeId} value={field.value} onValueChange={field.onChange} placeholder="ordersData" />
                    </FormControl>
                    <FormDescription>
                      Dataset to merge with left
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <FormLabel>Key Pairs</FormLabel>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => append({ leftKey: "", rightKey: "" })}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add Key Pair
                  </Button>
                </div>

                {fields.map((field, index) => (
                  <div key={field.id} className="flex items-end gap-2">
                    <div className="grid flex-1 grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name={`keyPairs.${index}.leftKey`}
                        render={({ field: inputField }) => (
                          <FormItem>
                            {index === 0 && <FormLabel>Left Key</FormLabel>}
                            <FormControl>
                              <FieldSuggestionInput
                                placeholder="customerId"
                                value={inputField.value}
                                onValueChange={inputField.onChange}
                                suggestions={leftFieldSuggestions}
                                mode="single"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name={`keyPairs.${index}.rightKey`}
                        render={({ field: inputField }) => (
                          <FormItem>
                            {index === 0 && <FormLabel>Right Key</FormLabel>}
                            <FormControl>
                              <FieldSuggestionInput
                                placeholder="id"
                                value={inputField.value}
                                onValueChange={inputField.onChange}
                                suggestions={rightFieldSuggestions}
                                mode="single"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="mb-0.5"
                      onClick={() => remove(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="sr-only">Remove</span>
                    </Button>
                  </div>
                ))}
                {form.formState.errors.keyPairs?.root && (
                  <p className="text-[0.8rem] font-medium text-destructive">
                    {form.formState.errors.keyPairs.root.message}
                  </p>
                )}
                {form.formState.errors.keyPairs &&
                  !form.formState.errors.keyPairs.root &&
                  Array.isArray(form.formState.errors.keyPairs) === false && (
                    <p className="text-[0.8rem] font-medium text-destructive">
                      {form.formState.errors.keyPairs.message as string}
                    </p>
                  )}
                <FormField
                  control={form.control}
                  name="caseInsensitive"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 shadow-sm mt-4">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <div className="space-y-1 leading-none">
                        <FormLabel>Case-insensitive key matching</FormLabel>
                        <FormDescription>
                          Treats 'USA' and 'usa' as equal when matching keys.
                        </FormDescription>
                      </div>
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="joinType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Join Type</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select join type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="inner">Inner Join</SelectItem>
                        <SelectItem value="left">Left Join</SelectItem>
                        <SelectItem value="right">Right Join</SelectItem>
                        <SelectItem value="full">Full Outer Join</SelectItem>
                        <SelectItem value="full_exclusive">
                          Full Exclusive Join
                        </SelectItem>
                        <SelectItem value="left_exclusive">
                          Left Exclusive Join
                        </SelectItem>
                        <SelectItem value="right_exclusive">
                          Right Exclusive Join
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      {field.value === "full_exclusive"
                        ? "Rows that have no match on either side (left-exclusive ∪ right-exclusive)."
                        : "Inner, left, right, full, and exclusive joins are supported."}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

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
                      Store joined rows as {`{{${watchVariableName}}}`}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {watchLeftVariable && watchRightVariable && (
                <Collapsible
                  open={isOutputColumnsOpen}
                  onOpenChange={setIsOutputColumnsOpen}
                  className="w-full space-y-2 rounded-md border p-4 shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <h4 className="text-sm font-semibold">Output Columns</h4>
                      <p className="text-xs text-muted-foreground">
                        Select columns to include in the output
                      </p>
                    </div>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="w-9 p-0">
                        <ChevronDown
                          className={`h-4 w-4 transition-transform duration-200 ${
                            isOutputColumnsOpen ? "rotate-180" : ""
                          }`}
                        />
                        <span className="sr-only">Toggle output columns</span>
                      </Button>
                    </CollapsibleTrigger>
                  </div>

                  <CollapsibleContent className="space-y-4">
                    {outputFields.length === 0 ? (
                      <p className="text-sm text-muted-foreground italic">
                        All columns included by default.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {outputFields.map((field, index) => (
                          <div key={field.id} className="flex items-end gap-2">
                            <FormField
                              control={form.control}
                              name={`outputColumns.${index}.source`}
                              render={({ field: sourceField }) => (
                                <FormItem className="w-1/4">
                                  {index === 0 && <FormLabel>Source</FormLabel>}
                                  <Select
                                    onValueChange={sourceField.onChange}
                                    defaultValue={sourceField.value}
                                  >
                                    <FormControl>
                                      <SelectTrigger>
                                        <SelectValue placeholder="Select" />
                                      </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                      <SelectItem value="left">Left</SelectItem>
                                      <SelectItem value="right">
                                        Right
                                      </SelectItem>
                                    </SelectContent>
                                  </Select>
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={form.control}
                              name={`outputColumns.${index}.column`}
                              render={({ field: inputField }) => (
                                <FormItem className="w-2/4">
                                  {index === 0 && <FormLabel>Column</FormLabel>}
                                  <FormControl>
                                    <FieldSuggestionInput
                                      placeholder="Column Name"
                                      value={inputField.value ?? ""}
                                      onValueChange={inputField.onChange}
                                      suggestions={
                                        form.watch(
                                          `outputColumns.${index}.source`,
                                        ) === "right"
                                          ? rightFieldSuggestions
                                          : leftFieldSuggestions
                                      }
                                      mode="single"
                                    />
                                  </FormControl>
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={form.control}
                              name={`outputColumns.${index}.alias`}
                              render={({ field: inputField }) => (
                                <FormItem className="w-1/4">
                                  {index === 0 && <FormLabel>Alias</FormLabel>}
                                  <FormControl>
                                    <Input
                                      placeholder="Alias (optional)"
                                      {...inputField}
                                      value={inputField.value || ""}
                                    />
                                  </FormControl>
                                </FormItem>
                              )}
                            />

                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="mb-[2px] transition-colors hover:border-destructive hover:bg-destructive hover:text-destructive-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                              onClick={() => removeOutput(index)}
                            >
                              <Trash2 className="h-4 w-4" />
                              <span className="sr-only">Remove column</span>
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      onClick={() =>
                        appendOutput({
                          source: "left",
                          column: "",
                          alias: "",
                        })
                      }
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Add Column
                    </Button>
                  </CollapsibleContent>
                </Collapsible>
              )}

              {estimateFromPreview &&
                estimateFromPreview.estimatedOutputRows >= 0 && (
                  <div className="my-4 rounded-md border p-3 flex justify-between items-center bg-muted/30">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">
                        Estimated Output
                      </span>
                      <span className="text-xs text-muted-foreground">
                        ~
                        {estimateFromPreview.estimatedOutputRows.toLocaleString()}{" "}
                        rows
                      </span>
                    </div>
                    {estimateFromPreview.riskLevel !== "low" && (
                      <div
                        className={`px-2 py-1 rounded text-xs font-semibold border ${estimateFromPreview.riskLevel === "high" ? "bg-red-100 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-300" : "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300"}`}
                      >
                        {estimateFromPreview.riskLevel.toUpperCase()} RISK
                      </div>
                    )}
                  </div>
                )}
            </form>
          </Form>
        </div>

        <DialogFooter className="border-t pt-4 flex-shrink-0">
          <Button type="submit" form="csv-join-form">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
