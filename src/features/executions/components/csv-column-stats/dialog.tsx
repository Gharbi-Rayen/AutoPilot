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
  variableName: z
    .string()
    .min(1, { message: "Variable name is required" })
    .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, {
      message:
        "Must start with a letter, underscore, or dollar sign and contain only alphanumeric characters",
    }),
  fields: z.string().optional(),
});

export type CsvColumnStatsFormValues = z.infer<typeof formSchema>;

interface CsvColumnStatsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: CsvColumnStatsFormValues) => void;
  defaultValues?: Partial<CsvColumnStatsFormValues>;
  nodeId: string;
}

export const CsvColumnStatsDialog = ({
  open,
  onOpenChange,
  onSubmit,
  defaultValues = {},
  nodeId,
}: CsvColumnStatsDialogProps) => {
  const form = useForm<CsvColumnStatsFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      sourceVariable: defaultValues.sourceVariable || "",
      variableName: defaultValues.variableName || "",
      fields: defaultValues.fields || "",
    },
  });

  const watchVariableName = form.watch("variableName") || "columnStats";
  const watchSourceVariable = form.watch("sourceVariable");
  const { getColumns } = useUpstreamVariableMetadata(nodeId, open);
  const fieldSuggestions = getColumns(watchSourceVariable);

  const handleSubmit = (values: CsvColumnStatsFormValues) => {
    onSubmit(values);
    onOpenChange(false);
  };

  useEffect(() => {
    if (open) {
      form.reset({
        sourceVariable: defaultValues.sourceVariable || "",
        variableName: defaultValues.variableName || "",
        fields: defaultValues.fields || "",
      });
    }
  }, [open, defaultValues, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>CSV Column Stats</DialogTitle>
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
                    <FormDescription>Input records to analyze</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="fields"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fields (Optional)</FormLabel>
                    <FormControl>
                      <FieldSuggestionInput
                        placeholder="amount,category,status"
                        value={field.value || ""}
                        onValueChange={field.onChange}
                        suggestions={fieldSuggestions}
                        mode="multi"
                      />
                    </FormControl>
                    <FormDescription>
                      Comma-separated fields. Leave empty to analyze all fields.
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
                      <Input placeholder="columnStats" {...field} />
                    </FormControl>
                    <FormDescription>
                      Store statistics as {`{{${watchVariableName}}}`}
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
