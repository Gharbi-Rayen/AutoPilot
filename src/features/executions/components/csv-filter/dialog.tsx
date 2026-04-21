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

const operators = [
  "eq",
  "ne",
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "gt",
  "gte",
  "lt",
  "lte",
  "is_empty",
  "is_not_empty",
] as const;

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
    field: z.string().min(1, { message: "Field is required" }),
    operator: z.enum(operators),
    value: z.string().optional(),
  })
  .superRefine((values, ctx) => {
    const needsValue =
      values.operator !== "is_empty" && values.operator !== "is_not_empty";

    if (needsValue && (!values.value || values.value.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Value is required for selected operator",
        path: ["value"],
      });
    }
  });

export type CsvFilterFormValues = z.infer<typeof formSchema>;

interface CsvFilterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: CsvFilterFormValues) => void;
  defaultValues?: Partial<CsvFilterFormValues>;
  nodeId: string;
}

export const CsvFilterDialog = ({
  open,
  onOpenChange,
  onSubmit,
  defaultValues = {},
  nodeId,
}: CsvFilterDialogProps) => {
  const form = useForm<CsvFilterFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      sourceVariable: defaultValues.sourceVariable || "",
      variableName: defaultValues.variableName || "",
      field: defaultValues.field || "",
      operator: defaultValues.operator || "eq",
      value: defaultValues.value || "",
    },
  });

  const watchVariableName = form.watch("variableName") || "filteredData";
  const watchOperator = form.watch("operator");
  const watchSourceVariable = form.watch("sourceVariable");
  const { getColumns } = useUpstreamVariableMetadata(nodeId, open);
  const fieldSuggestions = getColumns(watchSourceVariable);

  const handleSubmit = (values: CsvFilterFormValues) => {
    onSubmit(values);
    onOpenChange(false);
  };

  useEffect(() => {
    if (open) {
      form.reset({
        sourceVariable: defaultValues.sourceVariable || "",
        variableName: defaultValues.variableName || "",
        field: defaultValues.field || "",
        operator: defaultValues.operator || "eq",
        value: defaultValues.value || "",
      });
    }
  }, [open, defaultValues, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Filter CSV</DialogTitle>
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
                      Parsed CSV records to filter
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="field"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Field</FormLabel>
                    <FormControl>
                      <FieldSuggestionInput
                        placeholder="status"
                        value={field.value}
                        onValueChange={field.onChange}
                        suggestions={fieldSuggestions}
                        mode="single"
                      />
                    </FormControl>
                    <FormDescription>
                      Record key used for filtering
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="operator"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Operator</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select operator" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="eq">Equals</SelectItem>
                        <SelectItem value="ne">Not equals</SelectItem>
                        <SelectItem value="contains">Contains</SelectItem>
                        <SelectItem value="not_contains">
                          Does not contain
                        </SelectItem>
                        <SelectItem value="starts_with">Starts with</SelectItem>
                        <SelectItem value="ends_with">Ends with</SelectItem>
                        <SelectItem value="gt">Greater than</SelectItem>
                        <SelectItem value="gte">
                          Greater than or equal
                        </SelectItem>
                        <SelectItem value="lt">Less than</SelectItem>
                        <SelectItem value="lte">Less than or equal</SelectItem>
                        <SelectItem value="is_empty">Is empty</SelectItem>
                        <SelectItem value="is_not_empty">
                          Is not empty
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {watchOperator !== "is_empty" &&
                watchOperator !== "is_not_empty" && (
                  <FormField
                    control={form.control}
                    name="value"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Value</FormLabel>
                        <FormControl>
                          <Input placeholder="active" {...field} />
                        </FormControl>
                        <FormDescription>
                          Value compared against selected field
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
                      <Input placeholder="filteredData" {...field} />
                    </FormControl>
                    <FormDescription>
                      Store filtered rows as {`{{${watchVariableName}}}`}
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
