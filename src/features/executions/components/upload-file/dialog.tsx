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

export interface SerializedUploadFile {
  name: string;
  mimeType: string;
  size: number;
  lastModified: number;
  fileRef?: string;
  contentBase64?: string;
}

interface UploadFileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (
    values: UploadFileFormValues & { file?: SerializedUploadFile },
  ) => void;
  defaultValues?: Partial<UploadFileFormValues> & {
    file?: SerializedUploadFile;
  };
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

  const hasPersistedFile =
    !!defaultValues.file &&
    ((typeof defaultValues.file.fileRef === "string" &&
      defaultValues.file.fileRef.length > 0) ||
      (typeof defaultValues.file.contentBase64 === "string" &&
        defaultValues.file.contentBase64.length > 0));

  const persistSelectedFile = async (
    file: File,
  ): Promise<SerializedUploadFile> => {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch("/api/workflow-file-assets", {
      method: "POST",
      body: formData,
    });

    const payload = (await response.json()) as {
      error?: string;
      asset?: SerializedUploadFile;
    };

    if (!response.ok || !payload.asset) {
      throw new Error(payload.error ?? "Failed to store uploaded file.");
    }

    return payload.asset;
  };

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

  const handleSubmit = async (values: UploadFileFormValues) => {
    if (!selectedFile && !hasPersistedFile) {
      form.setError("fileName", {
        message: "Please select a file",
      });
      return;
    }

    let filePayload: SerializedUploadFile | undefined;

    if (selectedFile) {
      try {
        filePayload = await persistSelectedFile(selectedFile);
      } catch (error) {
        form.setError("fileName", {
          message:
            error instanceof Error
              ? error.message
              : "Failed to store uploaded file.",
        });
        return;
      }
    } else if (hasPersistedFile) {
      filePayload = defaultValues.file;
    }

    const allowedTypes = values.allowedTypes
      ?.split(",")
      .map((type) => type.trim())
      .filter(Boolean)
      .join(",");

    onSubmit({
      ...values,
      allowedTypes,
      file: filePayload,
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
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleFileInputChange}
              />

              {/* biome-ignore lint/a11y/useSemanticElements: Drag and drop region requires div container */}
              <div
                role="button"
                tabIndex={0}
                className={`relative w-full rounded-lg border-2 border-dashed transition-colors ${
                  isDragging
                    ? "border-primary bg-primary/5"
                    : "border-muted-foreground/25 bg-muted/50"
                } p-6 cursor-pointer hover:border-primary/50 flex flex-col items-center justify-center min-h-[160px]`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    fileInputRef.current?.click();
                  }
                }}
              >
                {selectedFile ? (
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-3">
                      <div className="rounded bg-primary/10 p-2">
                        <Upload className="size-4 text-primary" />
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-sm">
                          {selectedFile.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {(selectedFile.size / 1024).toFixed(2)} KB
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center">
                    <Upload className="size-8 mx-auto mb-2 text-muted-foreground" />
                    {hasPersistedFile && defaultValues.file ? (
                      <>
                        <p className="font-medium text-sm">
                          {defaultValues.file.name}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {(defaultValues.file.size / 1024).toFixed(2)} KB
                          (saved)
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Click to replace file
                        </p>
                      </>
                    ) : defaultValues.file ? (
                      <>
                        <p className="font-medium text-sm">
                          Saved file is invalid
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Please select the file again, then save workflow.
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="font-medium text-sm">
                          Drag file here or click to select
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Select a file to upload
                        </p>
                      </>
                    )}
                  </div>
                )}
              </div>

              {selectedFile ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  onClick={() => setSelectedFile(null)}
                >
                  <X className="size-4" />
                  Clear selected file
                </Button>
              ) : null}

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
                            e.target.value
                              ? parseInt(e.target.value, 10)
                              : undefined,
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
                      Comma-separated MIME types or extensions (e.g., image/*,
                      .pdf, .csv)
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
                      <Input placeholder="uploadedFile" {...field} />
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
