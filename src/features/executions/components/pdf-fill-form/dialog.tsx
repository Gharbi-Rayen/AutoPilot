"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

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
import { Textarea } from "@/components/ui/textarea";
import { SourceVariableInput } from "../csv-shared/source-variable-input";

const formSchema = z.object({
  pdfVariable: z
    .string()
    .min(1, { message: "Source PDF variable is required" }),
  formDataVariable: z
    .string()
    .min(1, { message: "Form data variable is required" }),
  variableName: z
    .string()
    .min(1, { message: "Variable name is required" })
    .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, {
      message:
        "Must start with a letter, underscore, or dollar sign and contain only alphanumeric characters",
    }),
  flatten: z.boolean().optional(),
  fileName: z.string().optional(),
  fallbackFormDataJson: z.string().optional(),
});

export type PdfFillFormFormValues = z.infer<typeof formSchema>;

interface PdfFillFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: PdfFillFormFormValues) => void;
  defaultValues?: Partial<PdfFillFormFormValues>;
  nodeId: string;
}

export const PdfFillFormDialog = ({
  open,
  onOpenChange,
  onSubmit,
  defaultValues = {},
  nodeId,
}: PdfFillFormDialogProps) => {
  const form = useForm<PdfFillFormFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      pdfVariable: defaultValues.pdfVariable || "",
      formDataVariable: defaultValues.formDataVariable || "",
      variableName: defaultValues.variableName || "",
      flatten: defaultValues.flatten ?? true,
      fileName: defaultValues.fileName || "",
      fallbackFormDataJson: defaultValues.fallbackFormDataJson || "",
    },
  });

  const watchVariableName = form.watch("variableName") || "filledPdf";

  const handleSubmit = (values: PdfFillFormFormValues) => {
    onSubmit(values);
    onOpenChange(false);
  };

  useEffect(() => {
    if (open) {
      form.reset({
        pdfVariable: defaultValues.pdfVariable || "",
        formDataVariable: defaultValues.formDataVariable || "",
        variableName: defaultValues.variableName || "",
        flatten: defaultValues.flatten ?? true,
        fileName: defaultValues.fileName || "",
        fallbackFormDataJson: defaultValues.fallbackFormDataJson || "",
      });
    }
  }, [open, defaultValues, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>PDF Fill Form</DialogTitle>
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
                      <SourceVariableInput nodeId={nodeId} value={field.value} onValueChange={field.onChange} placeholder="pdfTemplate" />
                    </FormControl>
                    <FormDescription>
                      PDF variable containing an AcroForm template
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="formDataVariable"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Form Data Variable</FormLabel>
                    <FormControl>
                      <SourceVariableInput nodeId={nodeId} value={field.value} onValueChange={field.onChange} placeholder="invoiceFormData" />
                    </FormControl>
                    <FormDescription>
                      Variable containing key/value fields to inject into the
                      PDF form
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="fallbackFormDataJson"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fallback Form Data JSON (Optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder='{"full_name":"Jane Doe","invoice_total":"$1,240.00"}'
                        className="min-h-24"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Optional JSON used when the form data variable is empty
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
                      <Input placeholder="filled-form.pdf" {...field} />
                    </FormControl>
                    <FormDescription>
                      Defaults to [variableName].pdf when left empty
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="flatten"
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
                        Flatten form fields
                      </FormLabel>
                      <FormDescription>
                        Lock values into the PDF so fields are no longer
                        editable
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
                      <Input placeholder="filledPdf" {...field} />
                    </FormControl>
                    <FormDescription>
                      Store generated file as {`{{${watchVariableName}}}`}
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
