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
import { FieldSuggestionInput } from "../csv-shared/field-suggestion-input";
import { SourceVariableInput } from "../csv-shared/source-variable-input";
import { useUpstreamVariableMetadata } from "../csv-shared/use-upstream-variable-metadata";

const formSchema = z.object({
  sourceVariable: z.string().min(1, { message: "Source variable is required" }),
  column: z.string().optional(),
  variableName: z
    .string()
    .min(1, { message: "Variable name is required" })
    .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, {
      message: "Must start with a letter, underscore, or dollar sign",
    }),
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
      sourceVariable: defaultValues.sourceVariable ?? "",
      column: defaultValues.column ?? "",
      variableName: defaultValues.variableName ?? "",
    },
  });

  const watchVariableName = form.watch("variableName") || "duplicateRows";
  const watchSourceVariable = form.watch("sourceVariable");
  const { getColumns } = useUpstreamVariableMetadata(nodeId, open);
  const fieldSuggestions = getColumns(watchSourceVariable);

  const handleSubmit = (values: CsvDeduplicateFormValues) => {
    onSubmit(values);
    onOpenChange(false);
  };

  useEffect(() => {
    if (open) {
      form.reset({
        sourceVariable: defaultValues.sourceVariable ?? "",
        column: defaultValues.column ?? "",
        variableName: defaultValues.variableName ?? "",
      });
    }
  }, [open, defaultValues, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Detect Duplicates</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            id="csv-deduplicate-form"
            onSubmit={form.handleSubmit(handleSubmit)}
            className="space-y-5 py-4"
          >
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
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="column"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Detect by column</FormLabel>
                  <FormControl>
                    <FieldSuggestionInput
                      placeholder="Leave empty to compare full rows"
                      value={field.value ?? ""}
                      onValueChange={field.onChange}
                      suggestions={fieldSuggestions}
                      mode="single"
                    />
                  </FormControl>
                  <FormDescription>
                    Pick a column to find duplicate values in. Leave empty to
                    detect fully identical rows.
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
                    <Input placeholder="duplicateRows" {...field} />
                  </FormControl>
                  <FormDescription>
                    Duplicate rows + count →{" "}
                    <span className="font-mono text-xs">{`{{${watchVariableName}}}`}</span>
                    {" · "}
                    Unique rows (first occurrence) →{" "}
                    <span className="font-mono text-xs">{`{{${watchVariableName}_unique}}`}</span>
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>

        <DialogFooter>
          <Button type="submit" form="csv-deduplicate-form">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
