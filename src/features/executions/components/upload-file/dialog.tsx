"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle, Upload, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Progress } from "@/components/ui/progress";

type ParseJobState =
  | "idle"
  | "uploading"
  | "queued"
  | "running"
  | "canceling"
  | "completed"
  | "failed";

interface ParsePreviewProgress {
  phase?: "probing" | "parsing" | "flushing" | "done";
  rowsParsed?: number;
  rowsFlushed?: number;
  chunkCount?: number;
  bytesRead?: number;
  totalBytes?: number;
  pct?: number;
}

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

export interface UploadPreviewMetadata {
  rowCount: number;
  columnCount: number;
  columns: string[];
  delimiter: string;
}

export interface UploadFileNodeSubmitValues extends UploadFileFormValues {
  file?: SerializedUploadFile;
  previewMetadata?: UploadPreviewMetadata;
  previewJobId?: string;
  previewExecutionId?: string;
  previewState?: "ready";
}

interface UploadFileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: UploadFileNodeSubmitValues) => void;
  defaultValues?: Partial<UploadFileFormValues> & {
    file?: SerializedUploadFile;
    previewMetadata?: UploadPreviewMetadata;
    previewJobId?: string;
    previewExecutionId?: string;
    previewState?: "ready";
  };
  nodeId: string;
}

interface StartPreviewResponse {
  jobId: string;
  previewExecutionId: string;
}

interface PollPreviewResponse {
  jobId: string;
  state:
    | "waiting"
    | "active"
    | "completed"
    | "failed"
    | "delayed"
    | "paused"
    | "prioritized"
    | "waiting-children"
    | "unknown";
  progress?: ParsePreviewProgress | null;
  result?: {
    rowCount?: number;
    columnCount?: number;
    headers?: string[];
    delimiter?: string;
  };
  error?: string;
}

const dotFrames = ["", ".", "..", "..."];

const phaseLabel: Record<string, string> = {
  probing: "Preparing file",
  parsing: "Analyzing content",
  flushing: "Finalizing",
  done: "Done",
};

const computeProgressValue = (
  parseState: ParseJobState,
  progress?: ParsePreviewProgress | null,
) => {
  if (parseState === "completed") {
    return 100;
  }

  if (parseState === "canceling") {
    return 15;
  }

  if (parseState === "failed") {
    return 0;
  }

  const phase = progress?.phase;
  const pct = typeof progress?.pct === "number" ? progress.pct : undefined;

  if (phase === "parsing") {
    return pct !== undefined ? Math.max(12, Math.min(95, pct)) : 42;
  }

  if (phase === "flushing") {
    return pct !== undefined ? Math.max(70, Math.min(98, pct)) : 82;
  }

  if (phase === "done") {
    return 100;
  }

  return 12;
};

const formatPreviewSummary = (metadata?: UploadPreviewMetadata) => {
  if (!metadata) {
    return null;
  }

  return `${metadata.rowCount.toLocaleString()} rows • ${metadata.columnCount.toLocaleString()} columns`;
};

export const UploadFileDialog = ({
  open,
  onOpenChange,
  onSubmit,
  defaultValues = {},
  nodeId,
}: UploadFileDialogProps) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [parseState, setParseState] = useState<ParseJobState>("idle");
  const [parseError, setParseError] = useState<string | null>(null);
  const [parseProgress, setParseProgress] =
    useState<ParsePreviewProgress | null>(null);
  const [previewJobId, setPreviewJobId] = useState<string | null>(
    defaultValues.previewJobId ?? null,
  );
  const [persistedFile, setPersistedFile] = useState<
    SerializedUploadFile | undefined
  >(defaultValues.file);
  const [previewExecutionId, setPreviewExecutionId] = useState<string | null>(
    defaultValues.previewExecutionId ?? null,
  );
  const [previewMetadata, setPreviewMetadata] = useState<
    UploadPreviewMetadata | undefined
  >(defaultValues.previewMetadata);
  const [dotFrame, setDotFrame] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollAbortRef = useRef<AbortController | null>(null);

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
  const stageLabel = useMemo(() => {
    if (parseState === "uploading") {
      return "Uploading file";
    }

    if (parseState === "queued") {
      return "Preparing file";
    }

    if (parseState === "canceling") {
      return "Canceling and removing file";
    }

    if (parseState === "completed") {
      return "File analysis completed";
    }

    if (parseState === "failed") {
      return "File analysis failed";
    }

    if (parseProgress?.phase) {
      return phaseLabel[parseProgress.phase] || "Analyzing content";
    }

    if (parseState === "running") {
      return "Analyzing content";
    }

    return "Ready";
  }, [parseProgress?.phase, parseState]);

  const animatedLabel =
    parseState === "uploading" ||
    parseState === "queued" ||
    parseState === "running" ||
    parseState === "canceling"
      ? `${stageLabel}${dotFrames[dotFrame]}`
      : stageLabel;

  const progressValue = computeProgressValue(parseState, parseProgress);
  const previewSummary = formatPreviewSummary(previewMetadata);

  const clearPolling = useCallback(() => {
    pollAbortRef.current?.abort();
    pollAbortRef.current = null;
  }, []);

  useEffect(() => {
    if (!open) {
      clearPolling();
    }
  }, [open, clearPolling]);

  useEffect(() => {
    if (
      parseState === "uploading" ||
      parseState === "queued" ||
      parseState === "running" ||
      parseState === "canceling"
    ) {
      const timer = setInterval(() => {
        setDotFrame((current) => (current + 1) % dotFrames.length);
      }, 350);
      return () => clearInterval(timer);
    }

    setDotFrame(0);
    return undefined;
  }, [parseState]);

  useEffect(() => {
    if (open) {
      form.reset({
        fileName: defaultValues.fileName || "",
        variableName: defaultValues.variableName || "",
        maxSizeMB: defaultValues.maxSizeMB || 100,
        allowedTypes: defaultValues.allowedTypes || "",
      });

      setSelectedFile(null);
      setParseError(null);
      setParseProgress(null);
      setPersistedFile(defaultValues.file);
      setPreviewMetadata(defaultValues.previewMetadata);
      setPreviewJobId(defaultValues.previewJobId ?? null);
      setPreviewExecutionId(defaultValues.previewExecutionId ?? null);
      setParseState(defaultValues.previewMetadata ? "completed" : "idle");
    }
  }, [open, defaultValues, form]);

  const cancelExistingPreview = async () => {
    if (!previewJobId && !previewExecutionId && !persistedFile?.fileRef) {
      return;
    }

    clearPolling();

    const payload = {
      jobId: previewJobId || undefined,
      previewExecutionId: previewExecutionId || undefined,
      fileRef: persistedFile?.fileRef || undefined,
    };

    await fetch("/api/upload-file/preview-parse", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => undefined);

    setPreviewJobId(null);
    setPreviewExecutionId(null);
    setPersistedFile(undefined);
    setPreviewMetadata(undefined);
    setParseProgress(null);
    setParseError(null);
  };

  const pollPreview = (jobId: string, fileRef: string, executionId: string) => {
    clearPolling();
    const controller = new AbortController();
    pollAbortRef.current = controller;

    const tick = async () => {
      if (controller.signal.aborted) {
        return;
      }

      try {
        const response = await fetch(
          `/api/upload-file/preview-parse?jobId=${encodeURIComponent(jobId)}`,
          {
            method: "GET",
            cache: "no-store",
            signal: controller.signal,
          },
        );

        const payload = (await response.json()) as PollPreviewResponse & {
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error || "Failed to fetch parse progress.");
        }

        setParseProgress(payload.progress || null);

        if (payload.state === "completed") {
          const rowCount =
            typeof payload.result?.rowCount === "number"
              ? Math.max(0, payload.result.rowCount)
              : 0;
          const headers = Array.isArray(payload.result?.headers)
            ? payload.result.headers.filter(
                (entry): entry is string => typeof entry === "string",
              )
            : [];

          const metadata: UploadPreviewMetadata = {
            rowCount,
            columns: headers,
            columnCount:
              typeof payload.result?.columnCount === "number"
                ? Math.max(0, payload.result.columnCount)
                : headers.length,
            delimiter:
              typeof payload.result?.delimiter === "string"
                ? payload.result.delimiter
                : ",",
          };

          setPreviewMetadata(metadata);
          setParseState("completed");
          setParseError(null);
          clearPolling();
          return;
        }

        if (payload.state === "failed") {
          setParseState("failed");
          setParseError(payload.error || "Failed to parse file.");
          clearPolling();
          return;
        }

        if (payload.state === "active") {
          setParseState("running");
        } else {
          setParseState("queued");
        }

        setTimeout(() => {
          void tick();
        }, 600);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setParseState("failed");
        setParseError(
          error instanceof Error ? error.message : "Failed to parse file.",
        );
        clearPolling();

        await fetch("/api/upload-file/preview-parse", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId,
            fileRef,
            previewExecutionId: executionId,
          }),
        }).catch(() => undefined);

        setPersistedFile(undefined);
        setPreviewJobId(null);
        setPreviewExecutionId(null);
        setPreviewMetadata(undefined);
      }
    };

    void tick();
  };

  const startPreviewParse = async (
    asset: SerializedUploadFile,
    fileName: string,
  ) => {
    if (!asset.fileRef) {
      throw new Error("Uploaded file reference is missing.");
    }

    setParseState("queued");

    const response = await fetch("/api/upload-file/preview-parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileRef: asset.fileRef,
        nodeId,
      }),
    });

    const payload = (await response.json()) as StartPreviewResponse & {
      error?: string;
    };

    if (!response.ok) {
      await fetch("/api/upload-file/preview-parse", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileRef: asset.fileRef }),
      }).catch(() => undefined);

      throw new Error(payload.error || "Failed to start parsing.");
    }

    setPreviewJobId(payload.jobId);
    setPreviewExecutionId(payload.previewExecutionId);
    setPersistedFile(asset);
    form.setValue("fileName", fileName, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });

    pollPreview(payload.jobId, asset.fileRef, payload.previewExecutionId);
  };

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
    if (
      !file.name.toLowerCase().endsWith(".csv") &&
      !file.name.toLowerCase().endsWith(".txt")
    ) {
      setParseError("Only .csv and .txt files are supported right now.");
      setSelectedFile(null);
      return;
    }

    setParseError(null);
    setSelectedFile(file);
    setPreviewMetadata(undefined);
    setParseProgress(null);

    void (async () => {
      try {
        setParseState("uploading");
        await cancelExistingPreview();

        const asset = await persistSelectedFile(file);
        await startPreviewParse(asset, file.name);
      } catch (error) {
        setParseState("failed");
        setPersistedFile(undefined);
        setParseError(
          error instanceof Error ? error.message : "Failed to prepare file.",
        );
      }
    })();
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

  const isSaveDisabled =
    parseState === "uploading" ||
    parseState === "queued" ||
    parseState === "running" ||
    parseState === "canceling" ||
    parseState !== "completed" ||
    !previewMetadata;

  const handleCancelPreview = async () => {
    setParseState("canceling");

    try {
      await fetch("/api/upload-file/preview-parse", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: previewJobId || undefined,
          fileRef: persistedFile?.fileRef || undefined,
          previewExecutionId: previewExecutionId || undefined,
        }),
      });

      setSelectedFile(null);
      setPersistedFile(undefined);
      setPreviewMetadata(undefined);
      setPreviewJobId(null);
      setPreviewExecutionId(null);
      setParseProgress(null);
      setParseError(null);
      setParseState("idle");
      form.setValue("fileName", "", {
        shouldDirty: true,
        shouldTouch: true,
      });
    } catch (error) {
      setParseState("failed");
      setParseError(
        error instanceof Error ? error.message : "Failed to cancel parsing.",
      );
    }
  };

  const handleSubmit = async (values: UploadFileFormValues) => {
    if (!persistedFile?.fileRef) {
      form.setError("fileName", {
        message: "Please upload and parse a file first.",
      });
      return;
    }

    if (!previewMetadata) {
      form.setError("fileName", {
        message: "File analysis is required before saving.",
      });
      return;
    }

    const allowedTypes = values.allowedTypes
      ?.split(",")
      .map((type) => type.trim())
      .filter(Boolean)
      .join(",");

    onSubmit({
      ...values,
      allowedTypes,
      file: persistedFile,
      previewMetadata,
      previewJobId: previewJobId || undefined,
      previewExecutionId: previewExecutionId || undefined,
      previewState: "ready",
    });

    onOpenChange(false);
  };

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
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                className="hidden"
                onChange={handleFileInputChange}
              />

              <button
                type="button"
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
                <div className="text-center w-full">
                  <Upload className="size-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="font-medium text-sm">
                    {selectedFile?.name ||
                      persistedFile?.name ||
                      "Drag file here or click to select"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {selectedFile
                      ? `${(selectedFile.size / 1024).toFixed(2)} KB`
                      : persistedFile
                        ? `${(persistedFile.size / 1024).toFixed(2)} KB${
                            previewMetadata
                              ? ` • ${previewMetadata.rowCount.toLocaleString()} rows • ${previewMetadata.columnCount.toLocaleString()} columns`
                              : ""
                          } (saved)`
                        : "Supports .csv and .txt"}
                  </p>

                  {(parseState === "uploading" ||
                    parseState === "queued" ||
                    parseState === "running" ||
                    parseState === "canceling" ||
                    parseState === "completed") && (
                    <div className="mt-4 space-y-2 text-left">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {(parseState === "uploading" ||
                          parseState === "queued" ||
                          parseState === "running" ||
                          parseState === "canceling") && (
                          <LoaderCircle className="size-3 animate-spin" />
                        )}
                        <span>{animatedLabel}</span>
                      </div>
                      <Progress value={progressValue} />
                      {previewSummary ? (
                        <p className="text-xs text-muted-foreground">
                          {previewSummary}
                        </p>
                      ) : null}
                    </div>
                  )}

                  {parseError ? (
                    <p className="text-xs text-destructive mt-2">
                      {parseError}
                    </p>
                  ) : null}
                </div>
              </button>

              {(parseState === "uploading" ||
                parseState === "queued" ||
                parseState === "running" ||
                parseState === "canceling" ||
                parseState === "completed") && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  onClick={handleCancelPreview}
                  disabled={parseState === "canceling"}
                >
                  <X className="size-4" />
                  {parseState === "canceling" ? "Canceling" : "Cancel File"}
                </Button>
              )}

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
                      <Input placeholder="text/csv, .txt, .csv" {...field} />
                    </FormControl>
                    <FormDescription>
                      Comma-separated MIME types or extensions
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
                <Button type="submit" disabled={isSaveDisabled}>
                  Save Configuration
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  );
};
