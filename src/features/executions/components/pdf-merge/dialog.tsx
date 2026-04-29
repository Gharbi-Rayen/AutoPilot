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
import { SourceVariableInput } from "../csv-shared/source-variable-input";
import { useVariableNameSuggestion } from "../csv-shared/use-variable-name-suggestion";
import { VariableNameInput } from "../csv-shared/variable-name-input";

const formSchema = z.object({
  pdfVariables: z
    .string()
    .min(1, { message: "At least one PDF variable is required" }),
  variableName: z
    .string()
    .min(1, { message: "Variable name is required" })
    .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, {
      message:
        "Must start with a letter, underscore, or dollar sign and contain only alphanumeric characters",
    }),
  fileName: z.string().optional(),
});

export type PdfMergeFormValues = z.infer<typeof formSchema>;

interface PdfMergeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: PdfMergeFormValues) => void;
  defaultValues?: Partial<PdfMergeFormValues>;
  nodeId: string;
}

export const PdfMergeDialog = ({
  open,
  onOpenChange,
  onSubmit,
  defaultValues = {},
  nodeId,
}: PdfMergeDialogProps) => {
  const form = useForm<PdfMergeFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      pdfVariables: defaultValues.pdfVariables || "",
      variableName: defaultValues.variableName || "",
      fileName: defaultValues.fileName || "",
    },
  });

  const watchVariableName = form.watch("variableName") || "mergedPdf";
  const watchPdfVariables = form.watch("pdfVariables");
  const primaryPdfVariable = watchPdfVariables?.split(",")[0]?.trim();
  const suggestion = useVariableNameSuggestion({ nodeId, sourceVariable: primaryPdfVariable, suffix: "merged", open });

  const handleSubmit = (values: PdfMergeFormValues) => {
    onSubmit(values);
    onOpenChange(false);
  };

  useEffect(() => {
    if (open) {
      form.reset({
        pdfVariables: defaultValues.pdfVariables || "",
        variableName: defaultValues.variableName || "",
        fileName: defaultValues.fileName || "",
      });
    }
  }, [open, defaultValues, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>PDF Merge</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(handleSubmit)}
              className="space-y-5"
            >
              <FormField
                control={form.control}
                name="pdfVariables"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>PDF Variables</FormLabel>
                    <FormControl>
                      <SourceVariableInput nodeId={nodeId} value={field.value} onValueChange={field.onChange} placeholder="coverPdf,reportPdf,appendixPdf" mode="multi" />
                    </FormControl>
                    <FormDescription>
                      Comma-separated list of PDF file variables to merge in
                      order
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="fileName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Output File Name (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="combined-report.pdf" {...field} />
                    </FormControl>
                    <FormDescription>
                      Final merged PDF file name
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
                      <VariableNameInput value={field.value} onChange={field.onChange} suggestion={suggestion} open={open} />
                    </FormControl>
                    <FormDescription>
                      Store merged file as {`{{${watchVariableName}}}`}
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
