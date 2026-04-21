"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import z from "zod";

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

const comparisonModes = [
  "integer-step",
  "number-step",
  "date-step",
  "alphabetic-step",
  "custom-expression",
] as const;

const dateUnits = ["millisecond", "second", "minute", "hour", "day"] as const;

const formSchema = z
  .object({
    sourceVariable: z
      .string()
      .min(1, { message: "Source variable is required" }),
    analysisColumn: z
      .string()
      .min(1, { message: "Analysis column is required" }),
    groupByColumns: z.string().optional(),
    comparisonMode: z.enum(comparisonModes),
    comparisonStep: z.coerce
      .number({ invalid_type_error: "Comparison step is required" })
      .positive({ message: "Comparison step must be greater than 0" })
      .optional(),
    dateStepUnit: z.enum(dateUnits).optional(),
    numberTolerance: z.coerce.number().nonnegative().optional(),
    customComparisonExpression: z.string().optional(),
    variableName: z
      .string()
      .min(1, { message: "Variable name is required" })
      .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, {
        message:
          "Must start with a letter, underscore, or dollar sign and contain only alphanumeric characters",
      }),
    minimumSequenceLength: z.coerce
      .number({ invalid_type_error: "Minimum sequence length is required" })
      .int({ message: "Minimum sequence length must be a whole number" })
      .min(1, { message: "Minimum sequence length must be at least 1" }),
  })
  .superRefine((values, ctx) => {
    if (
      values.comparisonMode === "custom-expression" &&
      (!values.customComparisonExpression ||
        values.customComparisonExpression.trim().length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customComparisonExpression"],
        message: "Custom comparison expression is required",
      });
    }
  });

export type CsvConsecutiveSequenceFormValues = z.infer<typeof formSchema>;

interface CsvConsecutiveSequenceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: CsvConsecutiveSequenceFormValues) => void;
  defaultValues?: Partial<CsvConsecutiveSequenceFormValues>;
  nodeId: string;
}

export const CsvConsecutiveSequenceDialog = ({
  open,
  onOpenChange,
  onSubmit,
  defaultValues = {},
  nodeId,
}: CsvConsecutiveSequenceDialogProps) => {
  const form = useForm<CsvConsecutiveSequenceFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      sourceVariable: defaultValues.sourceVariable || "",
      analysisColumn: defaultValues.analysisColumn || "",
      groupByColumns: defaultValues.groupByColumns || "",
      comparisonMode: defaultValues.comparisonMode || "integer-step",
      comparisonStep: defaultValues.comparisonStep || 1,
      dateStepUnit: defaultValues.dateStepUnit || "day",
      numberTolerance: defaultValues.numberTolerance ?? 0,
      customComparisonExpression:
        defaultValues.customComparisonExpression || "",
      variableName: defaultValues.variableName || "",
      minimumSequenceLength: defaultValues.minimumSequenceLength || 2,
    },
  });

  const watchVariableName = form.watch("variableName") || "sequenceMetadata";
  const watchSourceVariable = form.watch("sourceVariable");
  const watchComparisonMode = form.watch("comparisonMode");
  const isNumberStepMode = watchComparisonMode === "number-step";
  const { getColumns } = useUpstreamVariableMetadata(nodeId, open);
  const fieldSuggestions = getColumns(watchSourceVariable);

  const handleSubmit = (values: CsvConsecutiveSequenceFormValues) => {
    onSubmit(values);
    onOpenChange(false);
  };

  useEffect(() => {
    if (open) {
      form.reset({
        sourceVariable: defaultValues.sourceVariable || "",
        analysisColumn: defaultValues.analysisColumn || "",
        groupByColumns: defaultValues.groupByColumns || "",
        comparisonMode: defaultValues.comparisonMode || "integer-step",
        comparisonStep: defaultValues.comparisonStep || 1,
        dateStepUnit: defaultValues.dateStepUnit || "day",
        numberTolerance: defaultValues.numberTolerance ?? 0,
        customComparisonExpression:
          defaultValues.customComparisonExpression || "",
        variableName: defaultValues.variableName || "",
        minimumSequenceLength: defaultValues.minimumSequenceLength || 2,
      });
    }
  }, [open, defaultValues, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Consecutive Sequence Analyzer</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(handleSubmit)}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="flex-1 space-y-5 overflow-y-auto py-4 pr-1">
              <FormField
                control={form.control}
                name="sourceVariable"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Source Variable</FormLabel>
                    <FormControl>
                      <SourceVariableInput nodeId={nodeId} value={field.value} onValueChange={field.onChange} placeholder="parsedNumbers" />
                    </FormControl>
                    <FormDescription>
                      Parsed CSV output table from an upstream CSV node
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="analysisColumn"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Analysis Column (Required)</FormLabel>
                    <FormControl>
                      <FieldSuggestionInput
                        placeholder="id"
                        value={field.value}
                        onValueChange={field.onChange}
                        suggestions={fieldSuggestions}
                        mode="single"
                      />
                    </FormControl>
                    <FormDescription>
                      Column used to evaluate sequence continuity
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="groupByColumns"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Grouping Columns (Optional)</FormLabel>
                    <FormControl>
                      <FieldSuggestionInput
                        placeholder="category,region"
                        value={field.value || ""}
                        onValueChange={field.onChange}
                        suggestions={fieldSuggestions}
                        mode="multi"
                      />
                    </FormControl>
                    <FormDescription>
                      Sequences are calculated independently for each selected
                      group
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="comparisonMode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Comparison Mode</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select comparison mode" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="integer-step">
                          Integer Step
                        </SelectItem>
                        <SelectItem value="number-step">Number Step</SelectItem>
                        <SelectItem value="date-step">Date Step</SelectItem>
                        <SelectItem value="alphabetic-step">
                          Alphabetic Step
                        </SelectItem>
                        <SelectItem value="custom-expression">
                          Custom Expression
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Defines how the next value is considered consecutive
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {watchComparisonMode !== "custom-expression" && (
                <FormField
                  control={form.control}
                  name="comparisonStep"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Comparison Step</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={isNumberStepMode ? 0.000001 : 1}
                          step={isNumberStepMode ? "any" : 1}
                          value={field.value ?? 1}
                          onChange={(event) =>
                            field.onChange(event.target.value)
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        Step distance required between consecutive values
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {watchComparisonMode === "date-step" && (
                <FormField
                  control={form.control}
                  name="dateStepUnit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date Step Unit</FormLabel>
                      <Select
                        value={field.value || "day"}
                        onValueChange={field.onChange}
                      >
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select unit" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="millisecond">
                            Millisecond
                          </SelectItem>
                          <SelectItem value="second">Second</SelectItem>
                          <SelectItem value="minute">Minute</SelectItem>
                          <SelectItem value="hour">Hour</SelectItem>
                          <SelectItem value="day">Day</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {watchComparisonMode === "number-step" && (
                <FormField
                  control={form.control}
                  name="numberTolerance"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Number Tolerance</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={0}
                          step="any"
                          value={field.value ?? 0}
                          onChange={(event) =>
                            field.onChange(event.target.value)
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        Allowed delta when comparing decimal values
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {watchComparisonMode === "custom-expression" && (
                <FormField
                  control={form.control}
                  name="customComparisonExpression"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Custom Comparison Expression</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="current - previous === 1"
                          value={field.value || ""}
                          onChange={field.onChange}
                        />
                      </FormControl>
                      <FormDescription>
                        Use previous, current, context, and helpers (for
                        example: toDateTimestamp(current) -
                        toDateTimestamp(previous) === 86400000)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name="minimumSequenceLength"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Minimum Sequence Length</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        step={1}
                        value={field.value}
                        onChange={(event) => field.onChange(event.target.value)}
                      />
                    </FormControl>
                    <FormDescription>
                      Only sequences with at least this length are returned
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
                      <Input placeholder="sequenceMetadata" {...field} />
                    </FormControl>
                    <FormDescription>
                      Store metadata as {`{{${watchVariableName}}}`}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <DialogFooter className="border-t pt-3">
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
