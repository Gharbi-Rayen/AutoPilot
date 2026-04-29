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
import { SourceVariableInput } from "../csv-shared/source-variable-input";
import { useVariableNameSuggestion } from "../csv-shared/use-variable-name-suggestion";
import { VariableNameInput } from "../csv-shared/variable-name-input";

const formSchema = z.object({
  csvVariable: z
    .string()
    .min(1, { message: "Source CSV variable is required" }),
  variableName: z
    .string()
    .min(1, { message: "Variable name is required" })
    .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, {
      message:
        "Must start with a letter, underscore, or dollar sign and contain only alphanumeric characters",
    }),
  hasHeader: z.boolean().optional(),
  delimiter: z.string().optional(),
});

export type CsvParseFormValues = z.infer<typeof formSchema>;

interface CsvParseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: CsvParseFormValues) => void;
  defaultValues?: Partial<CsvParseFormValues>;
  nodeId: string;
}

export const CsvParseDialog = ({
  open,
  onOpenChange,
  onSubmit,
  defaultValues = {},
  nodeId,
}: CsvParseDialogProps) => {
  const form = useForm<CsvParseFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      csvVariable: defaultValues.csvVariable || "",
      variableName: defaultValues.variableName || "",
      hasHeader: defaultValues.hasHeader ?? true,
      delimiter: defaultValues.delimiter || "auto",
    },
  });

  const watchVariableName = form.watch("variableName") || "csvData";
  const watchCsvVariable = form.watch("csvVariable");
  const suggestion = useVariableNameSuggestion({ nodeId, sourceVariable: watchCsvVariable, suffix: "parsed", open });

  const handleSubmit = (values: CsvParseFormValues) => {
    onSubmit(values);
    onOpenChange(false);
  };

  useEffect(() => {
    if (open) {
      form.reset({
        csvVariable: defaultValues.csvVariable || "",
        variableName: defaultValues.variableName || "",
        hasHeader: defaultValues.hasHeader ?? true,
        delimiter: defaultValues.delimiter || "auto",
      });
    }
  }, [open, defaultValues, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Parse CSV</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(handleSubmit)}
              className="space-y-5"
            >
              <FormField
                control={form.control}
                name="csvVariable"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Source CSV Variable</FormLabel>
                    <FormControl>
                      <SourceVariableInput nodeId={nodeId} value={field.value} onValueChange={field.onChange} placeholder="csvFile" />
                    </FormControl>
                    <FormDescription>
                      Reference to CSV file or data from previous node
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="delimiter"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Delimiter</FormLabel>
                    <FormControl>
                      <Input placeholder="auto" {...field} />
                    </FormControl>
                    <FormDescription>
                      Leave empty (or use "auto") for auto-detect. Supports
                      comma, semicolon, tab, pipe, and colon.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="hasHeader"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel className="cursor-pointer">
                        Use First Row as Headers
                      </FormLabel>
                      <FormDescription>
                        Treat the first row as column names
                      </FormDescription>
                    </div>
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
                      Store parsed data as {`{{${watchVariableName}}}`}
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
