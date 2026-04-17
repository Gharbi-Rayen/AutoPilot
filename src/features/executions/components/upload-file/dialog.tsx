"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { createId } from "@paralleldrive/cuid2";
import { LoaderCircle, Upload, X } from "lucide-react";
import Papa from "papaparse";
import { useCallback, useEffect, useRef, useState } from "react";
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

// ─── Types ────────────────────────────────────────────────────────────────────

type ParseState = "idle" | "storing" | "parsing" | "completed" | "failed";

export interface UploadPreviewMetadata {
  rowCount: number;
  columnCount: number;
  columns: string[];
  delimiter: string;
}

const formSchema = z.object({
  variableName: z
    .string()
    .min(1, { message: "Variable name is required" })
    .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, {
      message:
        "Must start with a letter or underscore and contain only alphanumeric characters",
    }),
});

export type UploadFileFormValues = z.infer<typeof formSchema>;

export interface UploadFileNodeSubmitValues extends UploadFileFormValues {
  fileId: string;
  fileName: string;
  previewMetadata: UploadPreviewMetadata;
}

interface UploadFileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: UploadFileNodeSubmitValues) => void;
  defaultValues?: Partial<UploadFileNodeSubmitValues>;
  nodeId: string;
}

// ─── OPFS helpers ─────────────────────────────────────────────────────────────

async function getUploadsDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  const autopilot = await root.getDirectoryHandle("autopilot", {
    create: true,
  });
  return autopilot.getDirectoryHandle("uploads", { create: true });
}

async function saveToOpfs(fileId: string, file: File): Promise<void> {
  const dir = await getUploadsDir();
  const fh = await dir.getFileHandle(fileId, { create: true });
  const writable = await fh.createWritable();
  await writable.write(file);
  await writable.close();
}

async function deleteFromOpfs(fileId: string): Promise<void> {
  try {
    const dir = await getUploadsDir();
    await dir.removeEntry(fileId);
  } catch {
    // ignore — file may not exist
  }
}

// ─── CSV preview (browser-side) ───────────────────────────────────────────────

function parsePreview(
  file: File,
): Promise<{ columns: string[]; rowCount: number; delimiter: string }> {
  return new Promise((resolve, reject) => {
    let headers: string[] = [];
    let rowCount = 0;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      step(result) {
        if (rowCount === 0 && result.meta?.fields) {
          headers = result.meta.fields as string[];
        }
        rowCount += 1;
      },
      complete(results) {
        if (headers.length === 0 && results.meta?.fields) {
          headers = results.meta.fields as string[];
        }
        resolve({
          columns: headers,
          rowCount,
          delimiter: (results.meta?.delimiter as string) ?? ",",
        });
      },
      error(err) {
        reject(new Error(err.message));
      },
    });
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

const dotFrames = ["", ".", "..", "..."];

export const UploadFileDialog = ({
  open,
  onOpenChange,
  onSubmit,
  defaultValues = {},
  nodeId: _nodeId,
}: UploadFileDialogProps) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [parseState, setParseState] = useState<ParseState>("idle");
  const [parseError, setParseError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [previewMetadata, setPreviewMetadata] = useState<
    UploadPreviewMetadata | undefined
  >(defaultValues.previewMetadata);
  const [stagedFileId, setStagedFileId] = useState<string | null>(
    defaultValues.fileId ?? null,
  );
  const [dotFrame, setDotFrame] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);
  const defaultValuesRef = useRef(defaultValues);
  defaultValuesRef.current = defaultValues;

  const form = useForm<UploadFileFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      variableName: defaultValues.variableName ?? "",
    },
  });

  const watchVariableName = form.watch("variableName") || "uploadedFile";

  // Dot animation while active
  useEffect(() => {
    if (parseState === "storing" || parseState === "parsing") {
      const t = setInterval(
        () => setDotFrame((f) => (f + 1) % dotFrames.length),
        350,
      );
      return () => clearInterval(t);
    }
    setDotFrame(0);
  }, [parseState]);

  // Reset when dialog opens — read defaults from ref to avoid stale closure
  // without adding the whole defaultValues object to deps (it's a new object each render)
  useEffect(() => {
    if (!open) return;
    const dv = defaultValuesRef.current;
    cancelRef.current = false;
    form.reset({ variableName: dv.variableName ?? "" });
    setSelectedFile(null);
    setParseError(null);
    setProgress(0);
    setProgressLabel("");
    setStagedFileId(dv.fileId ?? null);
    setPreviewMetadata(dv.previewMetadata);
    setParseState(dv.previewMetadata ? "completed" : "idle");
  }, [open, form]);

  const handleFileSelect = useCallback(
    (file: File) => {
      const ext = file.name.toLowerCase();
      if (!ext.endsWith(".csv") && !ext.endsWith(".txt")) {
        setParseError("Only .csv and .txt files are supported.");
        return;
      }

      setParseError(null);
      setSelectedFile(file);
      setPreviewMetadata(undefined);
      cancelRef.current = false;

      void (async () => {
        // Clean up previous staged file
        if (stagedFileId) {
          await deleteFromOpfs(stagedFileId);
          setStagedFileId(null);
        }

        const newFileId = createId();

        try {
          // Step 1 — write to OPFS
          setParseState("storing");
          setProgress(15);
          setProgressLabel("Saving file to local storage");
          await saveToOpfs(newFileId, file);

          if (cancelRef.current) return;

          // Step 2 — parse preview in browser
          setParseState("parsing");
          setProgress(40);
          setProgressLabel("Analyzing file");

          const { columns, rowCount, delimiter } = await parsePreview(file);

          if (cancelRef.current) {
            await deleteFromOpfs(newFileId);
            return;
          }

          setStagedFileId(newFileId);
          setPreviewMetadata({ columns, rowCount, columnCount: columns.length, delimiter });
          setProgress(100);
          setProgressLabel("Done");
          setParseState("completed");
        } catch (err) {
          await deleteFromOpfs(newFileId).catch(() => undefined);
          if (cancelRef.current) return;
          setParseState("failed");
          setParseError(
            err instanceof Error ? err.message : "Failed to process file.",
          );
        }
      })();
    },
    [stagedFileId],
  );

  const handleCancel = useCallback(async () => {
    cancelRef.current = true;
    if (stagedFileId) {
      await deleteFromOpfs(stagedFileId);
      setStagedFileId(null);
    }
    setSelectedFile(null);
    setParseError(null);
    setPreviewMetadata(undefined);
    setProgress(0);
    setProgressLabel("");
    setParseState("idle");
    form.setValue("variableName", "", { shouldDirty: true });
  }, [stagedFileId, form]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) handleFileSelect(e.dataTransfer.files[0]);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileSelect(e.target.files[0]);
    }
  };

  const handleSubmit = (values: UploadFileFormValues) => {
    if (!stagedFileId || !previewMetadata) {
      form.setError("variableName", {
        message: "Upload and process a file first.",
      });
      return;
    }

    onSubmit({
      ...values,
      fileId: stagedFileId,
      fileName: selectedFile?.name ?? defaultValues.fileName ?? "",
      previewMetadata,
    });
    onOpenChange(false);
  };

  const isBusy = parseState === "storing" || parseState === "parsing";
  const isSaveDisabled = isBusy || parseState !== "completed" || !previewMetadata;

  const label = isBusy
    ? `${parseState === "storing" ? "Saving to local storage" : "Analyzing file"}${dotFrames[dotFrame]}`
    : parseState === "completed"
      ? "Ready"
      : parseState === "failed"
        ? "Failed"
        : progressLabel;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload File</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-5">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                className="hidden"
                onChange={handleFileInputChange}
              />

              {/* Drop zone */}
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
                  if (e.key === "Enter" || e.key === " ")
                    fileInputRef.current?.click();
                }}
              >
                <div className="text-center w-full">
                  <Upload className="size-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="font-medium text-sm">
                    {selectedFile?.name ??
                      (defaultValues.fileName
                        ? `${defaultValues.fileName} (saved)`
                        : "Drag file here or click to select")}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {selectedFile
                      ? `${(selectedFile.size / 1024).toFixed(1)} KB`
                      : previewMetadata
                        ? `${previewMetadata.rowCount.toLocaleString()} rows • ${previewMetadata.columnCount.toLocaleString()} columns`
                        : "Supports .csv and .txt"}
                  </p>

                  {(isBusy || parseState === "completed") && (
                    <div className="mt-4 space-y-2 text-left">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {isBusy && <LoaderCircle className="size-3 animate-spin" />}
                        <span>{label}</span>
                      </div>
                      <Progress value={progress} />
                      {previewMetadata && (
                        <p className="text-xs text-muted-foreground">
                          {previewMetadata.rowCount.toLocaleString()} rows •{" "}
                          {previewMetadata.columnCount.toLocaleString()} columns
                        </p>
                      )}
                    </div>
                  )}

                  {parseError && (
                    <p className="text-xs text-destructive mt-2">{parseError}</p>
                  )}
                </div>
              </button>

              {/* Cancel button */}
              {(isBusy || parseState === "completed") && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  onClick={handleCancel}
                  disabled={false}
                >
                  <X className="size-4" />
                  Cancel File
                </Button>
              )}

              {/* Variable name */}
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
                      Access this file as {`{{${watchVariableName}}}`} in
                      downstream nodes
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
