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

const positiveInt = z.coerce
  .number({ invalid_type_error: "Must be a number" })
  .int()
  .positive("Must be ≥ 1")
  .optional();

const formSchema = z.object({
  pdfVariable: z.string().min(1, { message: "Source PDF variable is required" }),
  variableName: z
    .string()
    .min(1, { message: "Variable name is required" })
    .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, {
      message: "Must start with a letter/underscore and contain only alphanumeric characters",
    }),
  fromPage: positiveInt,
  toPage: positiveInt,
  cleanText: z.boolean().optional(),
  includeMetadata: z.boolean().optional(),
});

export type PdfExtractTextFormValues = z.infer<typeof formSchema>;

interface PdfExtractTextDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: PdfExtractTextFormValues) => void;
  defaultValues?: Partial<PdfExtractTextFormValues>;
  nodeId: string;
}

export const PdfExtractTextDialog = ({
  open,
  onOpenChange,
  onSubmit,
  defaultValues = {},
  nodeId,
}: PdfExtractTextDialogProps) => {
  const form = useForm<PdfExtractTextFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      pdfVariable: defaultValues.pdfVariable ?? "",
      variableName: defaultValues.variableName ?? "",
      fromPage: defaultValues.fromPage,
      toPage: defaultValues.toPage,
      cleanText: defaultValues.cleanText ?? false,
      includeMetadata: defaultValues.includeMetadata ?? false,
    },
  });

  const watchVariableName = form.watch("variableName") || "pdfText";
  const watchPdfVariable = form.watch("pdfVariable");
  const suggestion = useVariableNameSuggestion({ nodeId, sourceVariable: watchPdfVariable, suffix: "text", open });

  const handleSubmit = (values: PdfExtractTextFormValues) => {
    onSubmit(values);
    onOpenChange(false);
  };

  useEffect(() => {
    if (open) {
      form.reset({
        pdfVariable: defaultValues.pdfVariable ?? "",
        variableName: defaultValues.variableName ?? "",
        fromPage: defaultValues.fromPage,
        toPage: defaultValues.toPage,
        cleanText: defaultValues.cleanText ?? false,
        includeMetadata: defaultValues.includeMetadata ?? false,
      });
    }
  }, [open, defaultValues, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>PDF Extract Text</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-5">

              <FormField
                control={form.control}
                name="pdfVariable"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Source PDF Variable</FormLabel>
                    <FormControl>
                      <SourceVariableInput nodeId={nodeId} value={field.value} onValueChange={field.onChange} placeholder="pdfFile" />
                    </FormControl>
                    <FormDescription>PDF file object from a previous node</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="fromPage"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>From Page</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          placeholder="1"
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.value === "" ? undefined : Number(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="toPage"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>To Page</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          placeholder="last"
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.value === "" ? undefined : Number(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <p className="text-xs text-muted-foreground -mt-2">Leave blank to extract all pages</p>

              <FormField
                control={form.control}
                name="variableName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Output Variable Name</FormLabel>
                    <FormControl>
                      <VariableNameInput value={field.value} onChange={field.onChange} suggestion={suggestion} open={open} />
                    </FormControl>
                    <FormDescription>Stored as {`{{${watchVariableName}}}`} with pages, fullText, and charCount</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-3">
                <FormField
                  control={form.control}
                  name="cleanText"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                      <FormControl>
                        <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                      <div className="space-y-0.5 leading-none">
                        <FormLabel className="cursor-pointer">Normalize whitespace</FormLabel>
                        <FormDescription>Collapse multiple spaces and trim each page</FormDescription>
                      </div>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="includeMetadata"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                      <FormControl>
                        <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                      <div className="space-y-0.5 leading-none">
                        <FormLabel className="cursor-pointer">Include PDF metadata</FormLabel>
                        <FormDescription>Extract title, author, dates from PDF info dict</FormDescription>
                      </div>
                    </FormItem>
                  )}
                />
              </div>

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
