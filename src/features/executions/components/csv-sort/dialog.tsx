"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import z from "zod";

import { cn } from "@/lib/utils";
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

const sortDirections = ["asc", "desc"] as const;
const compareModes = ["string", "number", "date"] as const;
const nullModes = ["first", "last"] as const;
const sortModes = ["single-field", "full-row"] as const;

const formSchema = z
  .object({
    sourceVariable: z.string().min(1, { message: "Source variable is required" }),
    variableName: z
      .string()
      .min(1, { message: "Variable name is required" })
      .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, {
        message:
          "Must start with a letter, underscore, or dollar sign and contain only alphanumeric characters",
      }),
    sortMode: z.enum(sortModes),
    sortField: z.string().optional(),
    direction: z.enum(sortDirections),
    compareAs: z.enum(compareModes),
    nulls: z.enum(nullModes),
  })
  .superRefine((data, ctx) => {
    if (data.sortMode === "single-field" && !data.sortField?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Sort field is required",
        path: ["sortField"],
      });
    }
  });

export type CsvSortFormValues = z.infer<typeof formSchema>;

interface CsvSortDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: CsvSortFormValues) => void;
  defaultValues?: Partial<CsvSortFormValues>;
  nodeId: string;
}

export const CsvSortDialog = ({
  open,
  onOpenChange,
  onSubmit,
  defaultValues = {},
  nodeId,
}: CsvSortDialogProps) => {
  const form = useForm<CsvSortFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      sourceVariable: defaultValues.sourceVariable || "",
      variableName: defaultValues.variableName || "",
      sortMode: defaultValues.sortMode || "single-field",
      sortField: defaultValues.sortField || "",
      direction: defaultValues.direction || "asc",
      compareAs: defaultValues.compareAs || "string",
      nulls: defaultValues.nulls || "last",
    },
  });

  const watchVariableName = form.watch("variableName") || "sortedData";
  const watchSourceVariable = form.watch("sourceVariable");
  const watchSortMode = form.watch("sortMode");
  const { getColumns } = useUpstreamVariableMetadata(nodeId, open);
  const fieldSuggestions = getColumns(watchSourceVariable);
  const suggestion = useVariableNameSuggestion({ nodeId, sourceVariable: watchSourceVariable, suffix: "sorted", open });

  const handleSubmit = (values: CsvSortFormValues) => {
    onSubmit(values);
    onOpenChange(false);
  };

  useEffect(() => {
    if (open) {
      form.reset({
        sourceVariable: defaultValues.sourceVariable || "",
        variableName: defaultValues.variableName || "",
        sortMode: defaultValues.sortMode || "single-field",
        sortField: defaultValues.sortField || "",
        direction: defaultValues.direction || "asc",
        compareAs: defaultValues.compareAs || "string",
        nulls: defaultValues.nulls || "last",
      });
    }
  }, [open, defaultValues, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Sort CSV</DialogTitle>
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
                    <FormDescription>Records to sort</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Sort mode toggle */}
              <FormField
                control={form.control}
                name="sortMode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sort Mode</FormLabel>
                    <FormControl>
                      <div className="flex gap-1 rounded-md border p-0.5 w-fit">
                        {(["single-field", "full-row"] as const).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => field.onChange(mode)}
                            className={cn(
                              "rounded px-3 py-1 text-xs font-medium transition-colors",
                              field.value === mode
                                ? "bg-primary text-primary-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                          >
                            {mode === "single-field" ? "By column" : "By full row"}
                          </button>
                        ))}
                      </div>
                    </FormControl>
                    <FormDescription>
                      {watchSortMode === "full-row"
                        ? "Compares all columns in order (lexicographic)"
                        : "Sort by a single chosen column"}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Sort field — only shown for single-field mode */}
              <div
                className={cn(
                  "overflow-hidden transition-all duration-200",
                  watchSortMode === "single-field"
                    ? "max-h-40 opacity-100"
                    : "max-h-0 opacity-0 pointer-events-none",
                )}
              >
                <FormField
                  control={form.control}
                  name="sortField"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sort Field</FormLabel>
                      <FormControl>
                        <FieldSuggestionInput
                          placeholder="createdAt"
                          value={field.value ?? ""}
                          onValueChange={field.onChange}
                          suggestions={fieldSuggestions}
                          mode="single"
                        />
                      </FormControl>
                      <FormDescription>Column used to order the rows</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="direction"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Direction</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select direction" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="asc">Ascending</SelectItem>
                        <SelectItem value="desc">Descending</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Compare As — only relevant for single-field mode */}
              <div
                className={cn(
                  "overflow-hidden transition-all duration-200",
                  watchSortMode === "single-field"
                    ? "max-h-28 opacity-100"
                    : "max-h-0 opacity-0 pointer-events-none",
                )}
              >
                <FormField
                  control={form.control}
                  name="compareAs"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Compare As</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select compare mode" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="string">String</SelectItem>
                          <SelectItem value="number">Number</SelectItem>
                          <SelectItem value="date">Date</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="nulls"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Null Values</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select null ordering" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="first">Place first</SelectItem>
                        <SelectItem value="last">Place last</SelectItem>
                      </SelectContent>
                    </Select>
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
                      Store sorted rows as {`{{${watchVariableName}}}`}
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
