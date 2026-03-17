"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
  fileName: z.string().optional(),
  variableName: z
    .string()
    .min(1, { message: "Variable name is required" })
    .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, {
      message:
        "Must start with a letter, underscore, or dollar sign and contain only alphanumeric characters",
    }),
  maxSizeMB: z.number().positive().optional(),
  allowedTypes: z.string().optional(),
});

export type UploadFileFormValues = z.infer<typeof formSchema>;

interface UploadFileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: UploadFileFormValues & { file?: File }) => void;
  defaultValues?: Partial<UploadFileFormValues>;
}

export const UploadFileDialog = ({
  open,
  onOpenChange,
  onSubmit,
  defaultValues = {},
}: UploadFileDialogProps) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<UploadFileFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      fileName: defaultValues.fileName || "",
      variableName: defaultValues.variableName || "",
      maxSizeMB: defaultValues.maxSizeMB || 100,
      allowedTypes: defaultValues.allowedTypes || "",
    },
  });

  const watchVariableName = form.watch("variableName") || "uploadedFile";

  const handleFileSelect = (file: File) => {
    setSelectedFile(file);
    if (!form.watch("fileName")) {
      form.setValue("fileName", file.name);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileSelect(e.target.files[0]);
    }
  };

  const handleSubmit = (values: UploadFileFormValues) => {
    if (!selectedFile) {
      form.setError("fileName", {
        message: "Please select a file",
      });
      return;
    }

    onSubmit({
      ...values,
      file: selectedFile,
    });
    onOpenChange(false);
    setSelectedFile(null);
  };

  useEffect(() => {
    if (open) {
      form.reset({
        fileName: defaultValues.fileName || "",
        variableName: defaultValues.variableName || "",
        maxSizeMB: defaultValues.maxSizeMB || 100,
        allowedTypes: defaultValues.allowedTypes || "",
      });
      setSelectedFile(null);
    }
  }, [open, defaultValues, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload File</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(handleSubmit)}
              className="space-y-5"
            >
              {/* File Drop Zone */}
              <div
                className={`relative rounded-lg border-2 border-dashed transition-colors ${
                  isDragging
                    ? "border-primary bg-primary/5"
                    : "border-muted-foreground/25 bg-muted/50"
                } p-6 cursor-pointer hover:border-primary/50`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={handleFileInputChange}
                />

                {selectedFile ? (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="rounded bg-primary/10 p-2">
                        <Upload className="size-4 text-primary" />
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-sm">{selectedFile.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {(selectedFile.size / 1024).toFixed(2)} KB
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedFile(null);
                      }}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                ) : (
                  <div className="text-center">
                    <Upload className="size-8 mx-auto mb-2 text-muted-foreground" />
                    <p className="font-medium text-sm">
                      Drag file here or click to select
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Select a file to upload
                    </p>
                  </div>
                )}
              </div>

              <FormField
                control={form.control}
                name="maxSizeMB"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Max File Size (MB)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="1"
                        max="1000"
                        {...field}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value ? parseInt(e.target.value) : undefined
                          )
                        }
                      />
                    </FormControl>
                    <FormDescription>
                      Maximum file size allowed (0 = unlimited)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="allowedTypes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Allowed File Types (Optional)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="image/*, application/pdf, .csv"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Comma-separated MIME types or extensions (e.g., image/*, .pdf, .csv)
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
                      <Input
                        placeholder="uploadedFile"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Store uploaded file as {`{{${watchVariableName}}}`}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter>
                <Button type="submit">Save Configuration</Button>
              </DialogFooter>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  );
};
