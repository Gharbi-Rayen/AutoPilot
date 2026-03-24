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
import { Textarea } from "@/components/ui/textarea";

const formSchema = z.object({
  fileUrl: z
    .string()
    .url("Must be a valid URL")
    .min(1, { message: "File URL is required" }),
  variableName: z
    .string()
    .min(1, { message: "Variable name is required" })
    .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, {
      message:
        "Must start with a letter, underscore, or dollar sign and contain only alphanumeric characters",
    }),
  fileName: z.string().optional(),
});

export type DownloadFileFormValues = z.infer<typeof formSchema>;

interface DownloadFileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: DownloadFileFormValues) => void;
  defaultValues?: Partial<DownloadFileFormValues>;
}

export const DownloadFileDialog = ({
  open,
  onOpenChange,
  onSubmit,
  defaultValues = {},
}: DownloadFileDialogProps) => {
  const form = useForm<DownloadFileFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      fileUrl: defaultValues.fileUrl || "",
      variableName: defaultValues.variableName || "",
      fileName: defaultValues.fileName || "",
    },
  });

  const watchVariableName = form.watch("variableName") || "downloadedFile";

  const handleSubmit = (values: DownloadFileFormValues) => {
    onSubmit(values);
    onOpenChange(false);
  };

  useEffect(() => {
    if (open) {
      form.reset({
        fileUrl: defaultValues.fileUrl || "",
        variableName: defaultValues.variableName || "",
        fileName: defaultValues.fileName || "",
      });
    }
  }, [open, defaultValues, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Download File</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(handleSubmit)}
              className="space-y-5"
            >
              <FormField
                control={form.control}
                name="fileUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>File URL</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="https://example.com/file.pdf"
                        className="resize-none"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      The URL of the file to download. Supports variable syntax
                      like <code>{"{{variable}}"}</code>
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
                      <Input placeholder="document.pdf" {...field} />
                    </FormControl>
                    <FormDescription>
                      Name for the downloaded file
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
                    <FormLabel>Variable Name</FormLabel>
                    <FormControl>
                      <Input placeholder="downloadedFile" {...field} />
                    </FormControl>
                    <FormDescription>
                      Name to store the file. Use as{" "}
                      {`{{${watchVariableName}}}`}
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
