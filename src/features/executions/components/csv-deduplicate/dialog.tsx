"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
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
import { useUpstreamVariableMetadata } from "../csv-shared/use-upstream-variable-metadata";

const keepModes = ["first", "last"] as const;

const formSchema = z.object({
  sourceVariable: z.string().min(1, { message: "Source variable is required" }),
  variableName: z
    .string()
    .min(1, { message: "Variable name is required" })
    .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, {
      message:
        "Must start with a letter, underscore, or dollar sign and contain only alphanumeric characters",
    }),
  duplicatesVariableName: z
    .string()
    .regex(/^$|^[A-Za-z_$][A-Za-z0-9_$]*$/, {
      message:
        "Must start with a letter, underscore, or dollar sign and contain only alphanumeric characters",
    })
    .optional(),
  fields: z.string().optional(),
  keep: z.enum(keepModes),
  includeDuplicates: z.boolean().optional(),
});

export type CsvDeduplicateFormValues = z.infer<typeof formSchema>;

interface CsvDeduplicateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: CsvDeduplicateFormValues) => void;
  defaultValues?: Partial<CsvDeduplicateFormValues>;
  nodeId: string;
}

export const CsvDeduplicateDialog = ({
  open,
  onOpenChange,
  onSubmit,
  defaultValues = {},
  nodeId,
}: CsvDeduplicateDialogProps) => {
  const form = useForm<CsvDeduplicateFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      sourceVariable: defaultValues.sourceVariable || "",
      variableName: defaultValues.variableName || "",
      duplicatesVariableName: defaultValues.duplicatesVariableName || "",
      fields: defaultValues.fields || "",
      keep: defaultValues.keep || "first",
      includeDuplicates: defaultValues.includeDuplicates ?? false,
    },
  });

  const watchVariableName = form.watch("variableName") || "deduplicatedData";
  const watchSourceVariable = form.watch("sourceVariable");
  const watchIncludeDuplicates = form.watch("includeDuplicates");
  const { getColumns } = useUpstreamVariableMetadata(nodeId, open);
  const fieldSuggestions = getColumns(watchSourceVariable);

  const defaultDupName = watchVariableName
    ? `${watchVariableName}_duplicates`
    : "deduplicatedData_duplicates";

  const handleSubmit = (values: CsvDeduplicateFormValues) => {
    onSubmit(values);
    onOpenChange(false);
  };

  useEffect(() => {
    if (open) {
      form.reset({
        sourceVariable: defaultValues.sourceVariable || "",
        variableName: defaultValues.variableName || "",
        duplicatesVariableName: defaultValues.duplicatesVariableName || "",
        fields: defaultValues.fields || "",
        keep: defaultValues.keep || "first",
        includeDuplicates: defaultValues.includeDuplicates ?? false,
      });
    }
  }, [open, defaultValues, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Deduplicate CSV</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-1 py-4 min-h-0">
          <Form {...form}>
            <form
              id="csv-deduplicate-form"
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
                      <Input placeholder="csvRecords" {...field} />
                    </FormControl>
                    <FormDescription>Records to deduplicate</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="fields"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fields</FormLabel>
                    <FormControl>
                      <FieldSuggestionInput
                        placeholder="email, phone  (leave empty = all columns)"
                        value={field.value || ""}
                        onValueChange={field.onChange}
                        suggestions={fieldSuggestions}
                        mode="multi"
                      />
                    </FormControl>
                    <FormDescription>
                      Comma-separated columns used to detect duplicates. Leave
                      empty to compare the entire row across all columns.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="keep"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Keep</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select mode" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="first">First occurrence</SelectItem>
                        <SelectItem value="last">Last occurrence</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Which row to keep when duplicates are found.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="includeDuplicates"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-4 shadow-sm">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel className="cursor-pointer">
                        Also output removed duplicates
                      </FormLabel>
                      <FormDescription>
                        The removed rows are stored as a separate dataset you
                        can use downstream.
                      </FormDescription>
                    </div>
                  </FormItem>
                )}
              />

              {watchIncludeDuplicates && (
                <FormField
                  control={form.control}
                  name="duplicatesVariableName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Duplicates Variable Name</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={defaultDupName}
                          {...field}
                          value={field.value || ""}
                        />
                      </FormControl>
                      <FormDescription>
                        Leave empty to auto-name as{" "}
                        <span className="font-mono">{defaultDupName}</span>
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
                      <Input placeholder="deduplicatedData" {...field} />
                    </FormControl>
                    <FormDescription>
                      Store deduplicated rows as{" "}
                      <span className="font-mono">{`{{${watchVariableName}}}`}</span>
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </form>
          </Form>
        </div>

        <DialogFooter className="border-t pt-4 flex-shrink-0">
          <Button type="submit" form="csv-deduplicate-form">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
