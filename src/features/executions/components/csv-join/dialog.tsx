"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Plus, Trash2, X } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
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
import { useTRPC } from "@/trpc/client";

const formSchemaBase = z.object({
  leftVariable: z.string().min(1, { message: "Left variable is required" }),
  rightVariable: z.string().min(1, { message: "Right variable is required" }),
  keyPairs: z.array(
    z.object({
      leftKey: z.string().min(1, "Left key is required"),
      rightKey: z.string().min(1, "Right key is required"),
    }),
  ),
  joinType: z.enum([
    "inner",
    "left",
    "right",
    "full",
    "left_exclusive",
    "right_exclusive",
    "cross",
    "semi",
    "anti",
    "natural",
    "union",
    "union_all",
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
  if (
    data.joinType !== "cross" &&
    data.joinType !== "natural" &&
    data.joinType !== "union" &&
    data.joinType !== "union_all" &&
    data.keyPairs.length === 0
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "At least one key pair is required",
      path: ["keyPairs"],
    });
  }
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
}

export const CsvJoinDialog = ({
  open,
  onOpenChange,
  onSubmit,
  defaultValues = {},
}: CsvJoinDialogProps) => {
  const trpc = useTRPC();

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

  const [dismissedWarnings, setDismissedWarnings] = useState<Set<number>>(
    new Set(),
  );

  const leftVariable = form.watch("leftVariable");
  const rightVariable = form.watch("rightVariable");
  const joinType = form.watch("joinType");
  const keyPairs = form.watch("keyPairs");

  const [debouncedInput, setDebouncedInput] = useState<{
    leftVariable?: string;
    rightVariable?: string;
    joinType?:
      | "inner"
      | "left"
      | "right"
      | "full"
      | "left_exclusive"
      | "right_exclusive"
      | "cross"
      | "semi"
      | "anti"
      | "natural"
      | "union"
      | "union_all";
    keyPairs?: { leftKey: string; rightKey: string }[];
  }>({});

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedInput({
        leftVariable,
        rightVariable,
        joinType,
        keyPairs,
      });
    }, 500);
    return () => clearTimeout(handler);
  }, [leftVariable, rightVariable, joinType, keyPairs]);

  // Using params as Record<string, string> because it's dynamic
  const params = useParams() as Record<string, string>;
  const workflowId = params.workflowId || params.id;

  const { data: estimate } = useQuery({
    ...trpc.csvJoin.estimateOutput.queryOptions({
      workflowId: workflowId,
      ...debouncedInput,
      joinType: debouncedInput.joinType as
        | "inner"
        | "left"
        | "right"
        | "full"
        | "cross"
        | "natural"
        | "union"
        | "union_all"
        | undefined,
    }),
    enabled:
      open &&
      !!workflowId &&
      !!debouncedInput.leftVariable &&
      !!debouncedInput.rightVariable,
  });

  const estimationWarnings: string[] = estimate?.warnings || [];
  const activeWarnings = estimationWarnings.filter(
    (_, i) => !dismissedWarnings.has(i),
  );

  const dismissWarning = (index: number) => {
    const newDismissed = new Set(dismissedWarnings);
    newDismissed.add(index);
    setDismissedWarnings(newDismissed);
  };

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Join CSV Datasets</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-1 py-4 space-y-4">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <FormField
                control={form.control}
                name="leftVariable"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Left Variable</FormLabel>
                    <FormControl>
                      <Input placeholder="customersData" {...field} />
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
                      <Input placeholder="ordersData" {...field} />
                    </FormControl>
                    <FormDescription>
                      Dataset to merge with left
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {watchJoinType === "natural" && (
                <div className="rounded-md border p-4 shadow-sm">
                  <FormLabel>Key Pairs</FormLabel>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Keys are automatically matched on shared column names.
                  </p>
                </div>
              )}
              {watchJoinType !== "cross" &&
                watchJoinType !== "natural" &&
                watchJoinType !== "union" &&
                watchJoinType !== "union_all" && (
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
                                  <Input
                                    placeholder="customerId"
                                    {...inputField}
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
                                {index === 0 && (
                                  <FormLabel>Right Key</FormLabel>
                                )}
                                <FormControl>
                                  <Input placeholder="id" {...inputField} />
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
                      Array.isArray(form.formState.errors.keyPairs) ===
                        false && (
                        <p className="text-[0.8rem] font-medium text-destructive">
                          {form.formState.errors.keyPairs.message as string}
                        </p>
                      )}

                    {activeWarnings.length > 0 && (
                      <div className="space-y-3 mt-4">
                        {activeWarnings.map((warning, index) => (
                          <div
                            key={warning}
                            className="flex items-start justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 pr-2 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300"
                          >
                            <div className="flex flex-col gap-1">
                              <p className="font-semibold">
                                Type Mismatch Warning
                              </p>
                              <p className="leading-snug opacity-90">
                                {warning}
                              </p>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="-mt-1 -mr-1 h-6 w-6 shrink-0 text-amber-600 hover:bg-amber-100 hover:text-amber-900 dark:text-amber-400 dark:hover:bg-amber-900/50 hover:dark:text-amber-100"
                              onClick={() => dismissWarning(index)}
                            >
                              <X className="h-4 w-4" />
                              <span className="sr-only">Dismiss warning</span>
                            </Button>
                          </div>
                        ))}
                      </div>
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
                              Treats 'USA' and 'usa' as equal when matching
                              keys.
                            </FormDescription>
                          </div>
                        </FormItem>
                      )}
                    />
                  </div>
                )}

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
                        <SelectItem value="left_exclusive">
                          Left Exclusive Join
                        </SelectItem>
                        <SelectItem value="right_exclusive">
                          Right Exclusive Join
                        </SelectItem>
                        <SelectItem value="cross">Cross Join</SelectItem>
                        <SelectItem value="semi">Semi Join</SelectItem>
                        <SelectItem value="anti">Anti Join</SelectItem>
                        <SelectItem value="natural">Natural Join</SelectItem>
                        <SelectItem value="union">Union</SelectItem>
                        <SelectItem value="union_all">Union All</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      {field.value === "semi" || field.value === "anti" ? (
                        <span className="font-medium text-amber-600 dark:text-amber-500">
                          Output contains only left dataset columns.
                        </span>
                      ) : field.value === "natural" ? (
                        <span className="font-medium text-blue-600 dark:text-blue-500">
                          Keys are automatically matched on shared column names.
                        </span>
                      ) : field.value === "union" ||
                        field.value === "union_all" ? (
                        <span className="flex flex-col gap-1 mt-1">
                          <span className="text-muted-foreground">
                            Stacks both datasets vertically. Columns should     
                            match in both datasets.
                          </span>
                          {field.value === "union" && (
                            <span className="font-medium text-amber-600 dark:text-amber-500 text-xs">
                              Deduplication is limited to 500,000 rows. Use CSV 
                              Deduplicate for larger datasets.
                            </span>
                          )}
                        </span>
                      ) : (
                        "Inner, left, right, full, cross, exclusive, semi, and anti joins are supported."
                      )}
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
                      <Input placeholder="joinedData" {...field} />
                    </FormControl>
                    <FormDescription>
                      Store joined rows as {`{{${watchVariableName}}}`}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {watchJoinType !== "union" &&
                watchJoinType !== "union_all" &&
                watchLeftVariable &&
                watchRightVariable && (
                  <Collapsible
                    open={isOutputColumnsOpen}
                    onOpenChange={setIsOutputColumnsOpen}
                    className="w-full space-y-2 rounded-md border p-4 shadow-sm"
                  >
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <h4 className="text-sm font-semibold">
                          Output Columns
                        </h4>
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
                            <div
                              key={field.id}
                              className="flex items-end gap-2"
                            >
                              <FormField
                                control={form.control}
                                name={`outputColumns.${index}.source`}
                                render={({ field: sourceField }) => (
                                  <FormItem className="w-1/4">
                                    {index === 0 && (
                                      <FormLabel>Source</FormLabel>
                                    )}
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
                                        <SelectItem value="left">
                                          Left
                                        </SelectItem>
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
                                    {index === 0 && (
                                      <FormLabel>Column</FormLabel>
                                    )}
                                    <FormControl>
                                      <Input
                                        placeholder="Column Name"
                                        {...inputField}
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
                                    {index === 0 && (
                                      <FormLabel>Alias</FormLabel>
                                    )}
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

              {estimate && estimate.estimatedOutputRows >= 0 && (
                <div className="my-4 rounded-md border p-3 flex justify-between items-center bg-muted/30">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">
                      Estimated Output
                    </span>
                    <span className="text-xs text-muted-foreground">
                      ~{estimate.estimatedOutputRows.toLocaleString()} rows
                    </span>
                  </div>
                  {estimate.riskLevel !== "low" && (
                    <div
                      className={`px-2 py-1 rounded text-xs font-semibold border ${estimate.riskLevel === "high" ? "bg-red-100 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-300" : "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300"}`}
                    >
                      {estimate.riskLevel.toUpperCase()} RISK
                    </div>
                  )}
                </div>
              )}

              <DialogFooter className="pt-4 border-t sticky bottom-0 bg-background/95 backdrop-blur">
                <Button type="submit">Save</Button>
              </DialogFooter>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  );
};
