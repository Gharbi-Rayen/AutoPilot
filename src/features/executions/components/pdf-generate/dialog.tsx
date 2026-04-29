"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { useVariableNameSuggestion } from "../csv-shared/use-variable-name-suggestion";
import { VariableNameInput } from "../csv-shared/variable-name-input";

const formSchema = z.object({
  variableName: z.string().min(1, "Variable name is required"),
  contentVariable: z.string().min(1, "Content variable is required"),
  title: z.string().optional(),
  fileName: z.string().optional(),
});

export type PdfGenerateFormValues = z.infer<typeof formSchema>;

interface PdfGenerateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: PdfGenerateFormValues) => void;
  defaultValues?: Partial<PdfGenerateFormValues>;
  nodeId?: string;
}

export function PdfGenerateDialog({
  open,
  onOpenChange,
  onSubmit,
  defaultValues,
  nodeId,
}: PdfGenerateDialogProps) {
  const form = useForm<PdfGenerateFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      variableName: "pdfReport",
      contentVariable: "",
      title: "",
      fileName: "",
      ...defaultValues,
    },
  });

  const watchContentVariable = form.watch("contentVariable");
  const suggestion = useVariableNameSuggestion({ nodeId, sourceVariable: watchContentVariable, suffix: "pdf", open });

  const handleSubmit = (values: PdfGenerateFormValues) => {
    onSubmit(values);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>PDF Generate Settings</DialogTitle>
          <DialogDescription>
            Generate a PDF file from a text content variable.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(handleSubmit)}
            className="space-y-4"
          >
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
                    The variable name where the generated PDF file will be
                    stored.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="contentVariable"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Content Source Variable</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. aiSummary" {...field} />
                  </FormControl>
                  <FormDescription>
                    The variable containing the text content to include in the
                    PDF.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title (Optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Weekly Report" {...field} />
                  </FormControl>
                  <FormDescription>
                    A title to display at the top of the PDF page.
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
                  <FormLabel>File Name (Optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. report.pdf" {...field} />
                  </FormControl>
                  <FormDescription>
                    The name of the file when downloaded. Defaults to
                    [variableName].pdf
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="submit">Save changes</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
