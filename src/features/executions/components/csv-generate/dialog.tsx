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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

const formSchema = z.object({
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
  delimiter: z.string().min(1, { message: "Delimiter is required" }).max(1),
  includeHeader: z.boolean().optional(),
});

export type CsvGenerateFormValues = z.infer<typeof formSchema>;

interface CsvGenerateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: CsvGenerateFormValues) => void;
  defaultValues?: Partial<CsvGenerateFormValues>;
}

export const CsvGenerateDialog = ({
  open,
  onOpenChange,
  onSubmit,
  defaultValues = {},
}: CsvGenerateDialogProps) => {
  const form = useForm<CsvGenerateFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      sourceVariable: defaultValues.sourceVariable || "",
      variableName: defaultValues.variableName || "",
      delimiter: defaultValues.delimiter || ",",
      includeHeader: defaultValues.includeHeader ?? true,
    },
  });

  const watchVariableName = form.watch("variableName") || "generatedCsv";

  const handleSubmit = (values: CsvGenerateFormValues) => {
    onSubmit(values);
    onOpenChange(false);
  };

  useEffect(() => {
    if (open) {
      form.reset({
        sourceVariable: defaultValues.sourceVariable || "",
        variableName: defaultValues.variableName || "",
        delimiter: defaultValues.delimiter || ",",
        includeHeader: defaultValues.includeHeader ?? true,
      });
    }
  }, [open, defaultValues, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Generate CSV</DialogTitle>
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
                      <Input placeholder="recordsData" {...field} />
                    </FormControl>
                    <FormDescription>
                      Array of objects to convert into CSV rows
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
                      <Input placeholder="," maxLength={1} {...field} />
                    </FormControl>
                    <FormDescription>
                      Character separating columns in output
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="includeHeader"
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
                        Include Header Row
                      </FormLabel>
                      <FormDescription>
                        Add column names as first row
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
                      <Input placeholder="generatedCsv" {...field} />
                    </FormControl>
                    <FormDescription>
                      Store generated CSV as {`{{${watchVariableName}}}`}
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