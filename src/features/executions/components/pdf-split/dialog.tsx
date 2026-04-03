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
  pageRanges: z.string().optional(),
  filePrefix: z.string().optional(),
});

export type PdfSplitFormValues = z.infer<typeof formSchema>;

interface PdfSplitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: PdfSplitFormValues) => void;
  defaultValues?: Partial<PdfSplitFormValues>;
}

export const PdfSplitDialog = ({
  open,
  onOpenChange,
  onSubmit,
  defaultValues = {},
}: PdfSplitDialogProps) => {
  const form = useForm<PdfSplitFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      pdfVariable: defaultValues.pdfVariable || "",
      variableName: defaultValues.variableName || "",
      pageRanges: defaultValues.pageRanges || "",
      filePrefix: defaultValues.filePrefix || "",
    },
  });

  const watchVariableName = form.watch("variableName") || "pdfSplitResult";

  const handleSubmit = (values: PdfSplitFormValues) => {
    onSubmit(values);
    onOpenChange(false);
  };

  useEffect(() => {
    if (open) {
      form.reset({
        pdfVariable: defaultValues.pdfVariable || "",
        variableName: defaultValues.variableName || "",
        pageRanges: defaultValues.pageRanges || "",
        filePrefix: defaultValues.filePrefix || "",
      });
    }
  }, [open, defaultValues, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>PDF Split</DialogTitle>
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
                      <Input placeholder="pdfFile" {...field} />
                    </FormControl>
                    <FormDescription>
                      PDF variable to split into multiple files
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="pageRanges"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Page Ranges (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="1-2,4,6-8" {...field} />
                    </FormControl>
                    <FormDescription>
                      Comma-separated ranges. Leave empty to split by page.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="filePrefix"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>File Prefix (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="invoice_part" {...field} />
                    </FormControl>
                    <FormDescription>
                      Prefix used for generated split file names
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
                      <Input placeholder="pdfSplitResult" {...field} />
                    </FormControl>
                    <FormDescription>
                      Store split files as {`{{${watchVariableName}}}`}
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
