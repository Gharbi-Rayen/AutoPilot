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
import { SourceVariableInput } from "../csv-shared/source-variable-input";
import { useVariableNameSuggestion } from "../csv-shared/use-variable-name-suggestion";
import { VariableNameInput } from "../csv-shared/variable-name-input";

const formSchema = z.object({
  pdfVariable: z
    .string()
    .min(1, { message: "Source PDF variable is required" }),
  variableName: z
    .string()
    .min(1, { message: "Variable name is required" })
    .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, {
      message:
        "Must start with a letter, underscore, or dollar sign and contain only alphanumeric characters",
    }),
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
      pdfVariable: defaultValues.pdfVariable || "",
      variableName: defaultValues.variableName || "",
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
        pdfVariable: defaultValues.pdfVariable || "",
        variableName: defaultValues.variableName || "",
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
            <form
              onSubmit={form.handleSubmit(handleSubmit)}
              className="space-y-5"
            >
              <FormField
                control={form.control}
                name="pdfVariable"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Source PDF Variable</FormLabel>
                    <FormControl>
                      <SourceVariableInput nodeId={nodeId} value={field.value} onValueChange={field.onChange} placeholder="pdfFile" />
                    </FormControl>
                    <FormDescription>
                      Reference to PDF file object from previous node(e.g.,
                      downloadedPDF)
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
                      Store extracted text as {`{{${watchVariableName}}}`}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="includeMetadata"
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
                        Include PDF Metadata
                      </FormLabel>
                      <FormDescription>
                        Also extract PDF metadata and info pages
                      </FormDescription>
                    </div>
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
