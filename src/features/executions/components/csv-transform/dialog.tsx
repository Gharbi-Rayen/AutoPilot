"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { useEffect } from "react";
import { useFieldArray, useForm } from "react-hook-form";
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

const OPERATORS = [
  { value: "eq", label: "equals" },
  { value: "ne", label: "not equals" },
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "does not contain" },
  { value: "starts_with", label: "starts with" },
  { value: "ends_with", label: "ends with" },
  { value: "is_empty", label: "is empty" },
  { value: "is_not_empty", label: "is not empty" },
  { value: "regex", label: "matches regex" },
  { value: "gt", label: "> (greater than)" },
  { value: "gte", label: ">= (greater or equal)" },
  { value: "lt", label: "< (less than)" },
  { value: "lte", label: "<= (less or equal)" },
] as const;

const ACTIONS = [
  {
    value: "replace_value",
    label: "Replace value",
    hasReplacement: true,
    hasTarget: false,
  },
  {
    value: "clear_cell",
    label: "Clear cell",
    hasReplacement: false,
    hasTarget: false,
  },
  {
    value: "delete_row",
    label: "Delete row",
    hasReplacement: false,
    hasTarget: false,
  },
  {
    value: "set_value",
    label: "Set column value",
    hasReplacement: true,
    hasTarget: true,
  },
] as const;

const NO_SEARCH_VALUE_OPERATORS = new Set(["is_empty", "is_not_empty"]);

const ruleSchema = z.object({
  column: z.string().min(1, { message: "Column is required" }),
  operator: z.enum([
    "eq",
    "ne",
    "contains",
    "not_contains",
    "starts_with",
    "ends_with",
    "is_empty",
    "is_not_empty",
    "regex",
    "gt",
    "gte",
    "lt",
    "lte",
  ]),
  searchValue: z.string().optional(),
  action: z.enum(["replace_value", "clear_cell", "delete_row", "set_value"]),
  replacement: z.string().optional(),
  targetColumn: z.string().optional(),
});

const formSchema = z.object({
  sourceVariable: z.string().min(1, { message: "Source variable is required" }),
  variableName: z
    .string()
    .min(1, { message: "Variable name is required" })
    .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, {
      message:
        "Must start with a letter, underscore, or dollar sign and contain only alphanumeric characters",
    }),
  rules: z
    .array(ruleSchema)
    .min(1, { message: "At least one rule is required" }),
  matchMode: z.enum(["all", "any"]),
  caseSensitive: z.boolean().optional(),
});

export type CsvTransformFormValues = z.infer<typeof formSchema>;

const defaultRule = (): z.infer<typeof ruleSchema> => ({
  column: "",
  operator: "eq",
  searchValue: "",
  action: "replace_value",
  replacement: "",
  targetColumn: "",
});

interface CsvTransformDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: CsvTransformFormValues) => void;
  defaultValues?: Partial<CsvTransformFormValues>;
  nodeId: string;
}

export const CsvTransformDialog = ({
  open,
  onOpenChange,
  onSubmit,
  defaultValues = {},
  nodeId,
}: CsvTransformDialogProps) => {
  const form = useForm<CsvTransformFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      sourceVariable: defaultValues.sourceVariable || "",
      variableName: defaultValues.variableName || "",
      rules: defaultValues.rules?.length
        ? defaultValues.rules
        : [defaultRule()],
      matchMode: defaultValues.matchMode || "all",
      caseSensitive: defaultValues.caseSensitive ?? false,
    },
  });

  const { fields, append, remove } = useFieldArray({
    name: "rules",
    control: form.control,
  });

  const watchVariableName = form.watch("variableName") || "transformedData";
  const watchSourceVariable = form.watch("sourceVariable");
  const watchRules = form.watch("rules");
  const { getColumns } = useUpstreamVariableMetadata(nodeId, open);
  const fieldSuggestions = getColumns(watchSourceVariable);

  useEffect(() => {
    if (open) {
      form.reset({
        sourceVariable: defaultValues.sourceVariable || "",
        variableName: defaultValues.variableName || "",
        rules: defaultValues.rules?.length
          ? defaultValues.rules
          : [defaultRule()],
        matchMode: defaultValues.matchMode || "all",
        caseSensitive: defaultValues.caseSensitive ?? false,
      });
    }
  }, [open, defaultValues, form]);

  const handleSubmit = (values: CsvTransformFormValues) => {
    onSubmit(values);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>CSV Transform</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-1 py-4 min-h-0">
          <Form {...form}>
            <form
              id="csv-transform-form"
              onSubmit={form.handleSubmit(handleSubmit)}
              className="space-y-5"
            >
              {/* Source & output */}
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="sourceVariable"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Source Variable</FormLabel>
                      <FormControl>
                        <SourceVariableInput nodeId={nodeId} value={field.value} onValueChange={field.onChange} placeholder="csvRecords" />
                      </FormControl>
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
                        <Input placeholder="transformedData" {...field} />
                      </FormControl>
                      <FormDescription>
                        <span className="font-mono">{`{{${watchVariableName}}}`}</span>
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Match mode + case sensitivity */}
              <div className="flex items-center gap-6 rounded-md border p-3 shadow-sm">
                <FormField
                  control={form.control}
                  name="matchMode"
                  render={({ field }) => (
                    <FormItem className="flex items-center gap-2 space-y-0">
                      <FormLabel className="text-sm whitespace-nowrap">
                        Match rules
                      </FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <FormControl>
                          <SelectTrigger className="w-32 h-8">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="all">ALL (AND)</SelectItem>
                          <SelectItem value="any">ANY (OR)</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="caseSensitive"
                  render={({ field }) => (
                    <FormItem className="flex items-center gap-2 space-y-0">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <FormLabel className="cursor-pointer text-sm">
                        Case-sensitive
                      </FormLabel>
                    </FormItem>
                  )}
                />
              </div>

              {/* Rules */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <FormLabel>
                    Rules{" "}
                    <span className="text-xs text-muted-foreground font-normal">
                      ({fields.length})
                    </span>
                  </FormLabel>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => append(defaultRule())}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add Rule
                  </Button>
                </div>

                {fields.map((field, index) => {
                  const rule = watchRules?.[index];
                  const actionMeta = ACTIONS.find(
                    (a) => a.value === rule?.action,
                  );
                  const hideSearch = NO_SEARCH_VALUE_OPERATORS.has(
                    rule?.operator as string,
                  );

                  return (
                    <div
                      key={field.id}
                      className="rounded-md border p-3 space-y-3 shadow-sm"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                          Rule {index + 1}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => remove(index)}
                        >
                          <Trash2 className="h-4 w-4" />
                          <span className="sr-only">Remove rule</span>
                        </Button>
                      </div>

                      {/* Column + Operator + Search value */}
                      <div className="grid grid-cols-3 gap-2">
                        <FormField
                          control={form.control}
                          name={`rules.${index}.column`}
                          render={({ field: f }) => (
                            <FormItem>
                              <FormLabel className="text-xs">Column</FormLabel>
                              <FormControl>
                                <FieldSuggestionInput
                                  placeholder="columnName"
                                  value={f.value}
                                  onValueChange={f.onChange}
                                  suggestions={fieldSuggestions}
                                  mode="single"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name={`rules.${index}.operator`}
                          render={({ field: f }) => (
                            <FormItem>
                              <FormLabel className="text-xs">
                                Operator
                              </FormLabel>
                              <Select
                                value={f.value}
                                onValueChange={f.onChange}
                              >
                                <FormControl>
                                  <SelectTrigger className="h-9">
                                    <SelectValue />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {OPERATORS.map((op) => (
                                    <SelectItem key={op.value} value={op.value}>
                                      {op.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        {!hideSearch ? (
                          <FormField
                            control={form.control}
                            name={`rules.${index}.searchValue`}
                            render={({ field: f }) => (
                              <FormItem>
                                <FormLabel className="text-xs">
                                  Search Value
                                </FormLabel>
                                <FormControl>
                                  <Input
                                    placeholder="value to find"
                                    {...f}
                                    value={f.value || ""}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        ) : (
                          <div />
                        )}
                      </div>

                      {/* Action + replacement / target */}
                      <div className="grid grid-cols-3 gap-2">
                        <FormField
                          control={form.control}
                          name={`rules.${index}.action`}
                          render={({ field: f }) => (
                            <FormItem>
                              <FormLabel className="text-xs">Action</FormLabel>
                              <Select
                                value={f.value}
                                onValueChange={f.onChange}
                              >
                                <FormControl>
                                  <SelectTrigger className="h-9">
                                    <SelectValue />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {ACTIONS.map((a) => (
                                    <SelectItem key={a.value} value={a.value}>
                                      {a.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        {actionMeta?.hasTarget && (
                          <FormField
                            control={form.control}
                            name={`rules.${index}.targetColumn`}
                            render={({ field: f }) => (
                              <FormItem>
                                <FormLabel className="text-xs">
                                  Target Column
                                </FormLabel>
                                <FormControl>
                                  <FieldSuggestionInput
                                    placeholder={rule?.column || "column"}
                                    value={f.value || ""}
                                    onValueChange={f.onChange}
                                    suggestions={fieldSuggestions}
                                    mode="single"
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        )}

                        {actionMeta?.hasReplacement && (
                          <FormField
                            control={form.control}
                            name={`rules.${index}.replacement`}
                            render={({ field: f }) => (
                              <FormItem>
                                <FormLabel className="text-xs">
                                  Replacement
                                </FormLabel>
                                <FormControl>
                                  <Input
                                    placeholder="new value"
                                    {...f}
                                    value={f.value || ""}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}

                {form.formState.errors.rules?.root && (
                  <p className="text-[0.8rem] font-medium text-destructive">
                    {form.formState.errors.rules.root.message}
                  </p>
                )}
                {form.formState.errors.rules?.message && (
                  <p className="text-[0.8rem] font-medium text-destructive">
                    {form.formState.errors.rules.message}
                  </p>
                )}
              </div>
            </form>
          </Form>
        </div>

        <DialogFooter className="border-t pt-4 flex-shrink-0">
          <Button type="submit" form="csv-transform-form">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
