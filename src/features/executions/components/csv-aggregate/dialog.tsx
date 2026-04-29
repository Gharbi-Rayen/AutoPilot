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

const operations = ["count", "sum", "avg", "min", "max"] as const;

const formSchema = z
  .object({
    sourceVariable: z
      .string()
      .min(1, { message: "Source variable is required" }),
    variableName: z
      .string()
      .min(1, { message: "Variable name is required" })
      .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, {
        message:
          "Must start with a letter, underscore, or dollar sign and contain only alphanumeric characters",
      }),
    groupBy: z.string().min(1, { message: "Group by field is required" }),
    operation: z.enum(operations),
    targetField: z.string().optional(),
  })
  .superRefine((values, ctx) => {
    if (values.operation !== "count" && !values.targetField) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Target field is required for sum, avg, min, and max",
        path: ["targetField"],
      });
    }
  });

export type CsvAggregateFormValues = z.infer<typeof formSchema>;

interface CsvAggregateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: CsvAggregateFormValues) => void;
  defaultValues?: Partial<CsvAggregateFormValues>;
  nodeId: string;
}

export const CsvAggregateDialog = ({
  open,
  onOpenChange,
  onSubmit,
  defaultValues = {},
  nodeId,
}: CsvAggregateDialogProps) => {
  const form = useForm<CsvAggregateFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      sourceVariable: defaultValues.sourceVariable || "",
      variableName: defaultValues.variableName || "",
      groupBy: defaultValues.groupBy || "",
      operation: defaultValues.operation || "count",
      targetField: defaultValues.targetField || "",
    },
  });

  const watchOperation = form.watch("operation");
  const watchVariableName = form.watch("variableName") || "aggregatedData";
  const watchSourceVariable = form.watch("sourceVariable");
  const { getColumns } = useUpstreamVariableMetadata(nodeId, open);
  const fieldSuggestions = getColumns(watchSourceVariable);
  const suggestion = useVariableNameSuggestion({ nodeId, sourceVariable: watchSourceVariable, suffix: "aggregated", open });

  const handleSubmit = (values: CsvAggregateFormValues) => {
    onSubmit(values);
    onOpenChange(false);
  };

  useEffect(() => {
    if (open) {
      form.reset({
        sourceVariable: defaultValues.sourceVariable || "",
        variableName: defaultValues.variableName || "",
        groupBy: defaultValues.groupBy || "",
        operation: defaultValues.operation || "count",
        targetField: defaultValues.targetField || "",
      });
    }
  }, [open, defaultValues, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Aggregate CSV</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(handleSubmit)}
              className="space-y-5"
            >
              <FormField
                control={form.control}
                name="sourceVariable"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Source Variable</FormLabel>
                    <FormControl>
                      <SourceVariableInput nodeId={nodeId} value={field.value} onValueChange={field.onChange} placeholder="csvRecords" />
                    </FormControl>
                    <FormDescription>
                      Input records to aggregate
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="groupBy"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Group By Field</FormLabel>
                    <FormControl>
                      <FieldSuggestionInput
                        placeholder="category"
                        value={field.value}
                        onValueChange={field.onChange}
                        suggestions={fieldSuggestions}
                        mode="single"
                      />
                    </FormControl>
                    <FormDescription>
                      Records will be grouped by this key
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="operation"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Operation</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select operation" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="count">Count</SelectItem>
                        <SelectItem value="sum">Sum</SelectItem>
                        <SelectItem value="avg">Average</SelectItem>
                        <SelectItem value="min">Minimum</SelectItem>
                        <SelectItem value="max">Maximum</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {watchOperation !== "count" && (
                <FormField
                  control={form.control}
                  name="targetField"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Target Field</FormLabel>
                      <FormControl>
                        <FieldSuggestionInput
                          placeholder="amount"
                          value={field.value || ""}
                          onValueChange={field.onChange}
                          suggestions={fieldSuggestions}
                          mode="single"
                        />
                      </FormControl>
                      <FormDescription>
                        Numeric field used by selected operation
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

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
                      Store output rows as {`{{${watchVariableName}}}`}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button type="submit">Save</Button>
              </DialogFooter>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  );
};
