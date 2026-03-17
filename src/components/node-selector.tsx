"use client";

import { createId } from "@paralleldrive/cuid2";
import { useReactFlow } from "@xyflow/react";
import { Download, FileText, GlobeIcon, MousePointerIcon, SearchIcon, File, Table2, Upload } from "lucide-react";
import Image from "next/image";
import type { ComponentType, ReactNode } from "react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { NodeType } from "@/generated/prisma";

export type NodeTypeOption = {
  type: NodeType;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }> | string;
};

const triggerNodes: NodeTypeOption[] = [
  {
    type: NodeType.MANUAL_TRIGGER,
    label: "Manual Trigger",
    description: "Start the workflow manually.",
    icon: MousePointerIcon,
  },
  {
    type: NodeType.GOOGLE_FORM_TRIGGER,
    label: "Google Form Trigger",
    description: "Runs when a form is submitted.",
    icon: "/logos/googleform.svg",
  },
  {
    type: NodeType.STRIPE_TRIGGER,
    label: "Stripe Trigger",
    description: "Runs when a Stripe event occurs.",
    icon: "/logos/stripe.svg",
  },
];

const executionNodes: NodeTypeOption[] = [
  {
    type: NodeType.HTTP_REQUEST,
    label: "HTTP Request",
    description: "Make an HTTP request to an external API.",
    icon: GlobeIcon,
  },
  {
    type: NodeType.GEMINI,
    label: "Gemini",
    description: "Generate text with Google Gemini.",
    icon: "/logos/gemini.svg",
  },
  {
    type: NodeType.OPENAI,
    label: "OpenAI",
    description: "Generate text with OpenAI GPT models.",
    icon: "/logos/openai.svg",
  },
  {
    type: NodeType.ANTHROPIC,
    label: "Anthropic",
    description: "Generate text with Anthropic Claude.",
    icon: "/logos/anthropic.svg",
  },
  {
    type: NodeType.DISCORD,
    label: "Discord",
    description: "Send messages via webhook.",
    icon: "/logos/discord.svg",
  },
  {
    type: NodeType.SLACK,
    label: "Slack",
    description: "Send messages via incoming webhook.",
    icon: "/logos/slack.svg",
  },
  {
    type: NodeType.TELEGRAM,
    label: "Telegram",
    description: "Send messages via Telegram Bot.",
    icon: "/logos/telegram.svg",
  },
  {
    type: NodeType.EMAIL_SMTP,
    label: "Email (SMTP)",
    description: "Send emails via SMTP (Gmail, Outlook, etc).",
    icon: "/logos/gmail.svg",
  },
  {
    type: NodeType.WHATSAPP,
    label: "WhatsApp",
    description: "Send messages via WhatsApp Cloud API.",
    icon: "/logos/whatsapp.svg",
  },
  {
    type: NodeType.CODE,
    label: "Code",
    description: "Run custom JavaScript code.",
    icon: "/logos/code.svg",
  },
  {
    type: NodeType.DOWNLOAD_FILE,
    label: "Download File",
    description: "Download file from URL",
    icon: Download,
  },
  {
    type: NodeType.UPLOAD_FILE,
    label: "Upload File",
    description: "Upload file manually to workflow",
    icon: Upload,
  },
  {
    type: NodeType.READ_FILE,
    label: "Read File",
    description: "Read file content and parse it",
    icon: FileText,
  },
  {
    type: NodeType.PDF_EXTRACT_TEXT,
    label: "PDF Extract Text",
    description: "Extract text from PDF files",
    icon: File,
  },
  {
    type: NodeType.CSV_PARSE,
    label: "CSV Parse",
    description: "Parse CSV data into records",
    icon: Table2,
  },
  {
    type: NodeType.WRITE_FILE,
    label: "Write File",
    description: "Write text or binary data to a file",
    icon: "/logos/write-file.svg",
  },
  {
    type: NodeType.CONVERT_FILE,
    label: "Convert File",
    description: "Convert files between formats",
    icon: "/logos/convert-file.svg",
  },
  {
    type: NodeType.PDF_EXTRACT_TABLES,
    label: "PDF Extract Tables",
    description: "Extract tabular data from PDFs",
    icon: "/logos/pdf-extract-tables.svg",
  },
  {
    type: NodeType.PDF_SPLIT,
    label: "PDF Split",
    description: "Split a PDF into multiple documents",
    icon: "/logos/pdf-split.svg",
  },
  {
    type: NodeType.PDF_MERGE,
    label: "PDF Merge",
    description: "Merge multiple PDFs into one",
    icon: "/logos/pdf-merge.svg",
  },
  {
    type: NodeType.PDF_FILL_FORM,
    label: "PDF Fill Form",
    description: "Fill PDF form fields with variables",
    icon: "/logos/pdf-fill-form.svg",
  },
  {
    type: NodeType.PDF_GENERATE,
    label: "PDF Generate",
    description: "Generate a PDF from workflow data",
    icon: "/logos/pdf-generate.svg",
  },
  {
    type: NodeType.PDF_SIGN,
    label: "PDF Sign",
    description: "Apply signatures to PDF files",
    icon: "/logos/pdf-sign.svg",
  },
  {
    type: NodeType.CSV_GENERATE,
    label: "CSV Generate",
    description: "Create CSV output from data",
    icon: "/logos/csv-generate.svg",
  },
  {
    type: NodeType.CSV_FILTER,
    label: "CSV Filter",
    description: "Filter rows in CSV data",
    icon: "/logos/csv-filter.svg",
  },
  {
    type: NodeType.CSV_AGGREGATE,
    label: "CSV Aggregate",
    description: "Aggregate grouped CSV rows",
    icon: "/logos/csv-aggregate.svg",
  },
  {
    type: NodeType.CSV_JOIN,
    label: "CSV Join",
    description: "Join two CSV datasets",
    icon: "/logos/csv-join.svg",
  },
  {
    type: NodeType.READ_EXCEL,
    label: "Read Excel",
    description: "Read worksheets from Excel files",
    icon: "/logos/read-excel.svg",
  },
  {
    type: NodeType.WRITE_EXCEL,
    label: "Write Excel",
    description: "Write data into Excel workbooks",
    icon: "/logos/write-excel.svg",
  },
  {
    type: NodeType.APPEND_ROW,
    label: "Append Row",
    description: "Append rows to spreadsheet tables",
    icon: "/logos/append-row.svg",
  },
  {
    type: NodeType.SHEET_TRANSFORM,
    label: "Sheet Transform",
    description: "Transform spreadsheet data",
    icon: "/logos/sheet-transform.svg",
  },
  {
    type: NodeType.CREATE_PRESENTATION,
    label: "Create Presentation",
    description: "Create a PowerPoint presentation",
    icon: "/logos/create-presentation.svg",
  },
  {
    type: NodeType.ADD_SLIDE,
    label: "Add Slide",
    description: "Add slides to a presentation",
    icon: "/logos/add-slide.svg",
  },
  {
    type: NodeType.FILL_TEMPLATE,
    label: "Fill Template",
    description: "Fill presentation templates",
    icon: "/logos/fill-template.svg",
  },
  {
    type: NodeType.RESIZE_IMAGE,
    label: "Resize Image",
    description: "Resize image dimensions",
    icon: "/logos/resize-image.svg",
  },
  {
    type: NodeType.CROP_IMAGE,
    label: "Crop Image",
    description: "Crop image areas",
    icon: "/logos/crop-image.svg",
  },
  {
    type: NodeType.CONVERT_IMAGE,
    label: "Convert Image",
    description: "Convert image formats",
    icon: "/logos/convert-image.svg",
  },
  {
    type: NodeType.OCR_IMAGE,
    label: "OCR Image",
    description: "Extract text from images",
    icon: "/logos/ocr-image.svg",
  },
  {
    type: NodeType.JSON_TRANSFORM,
    label: "JSON Transform",
    description: "Transform JSON structures",
    icon: "/logos/json-transform.svg",
  },
  {
    type: NodeType.FILTER,
    label: "Filter",
    description: "Filter arrays and records",
    icon: "/logos/filter.svg",
  },
  {
    type: NodeType.LOOP,
    label: "Loop",
    description: "Loop through items",
    icon: "/logos/loop.svg",
  },
  {
    type: NodeType.CONDITION,
    label: "Condition",
    description: "Branch workflow paths",
    icon: "/logos/condition.svg",
  },
  {
    type: NodeType.DELAY,
    label: "Delay",
    description: "Pause workflow execution",
    icon: "/logos/delay.svg",
  },
  {
    type: NodeType.MERGE,
    label: "Merge",
    description: "Merge data streams",
    icon: "/logos/merge.svg",
  },
  {
    type: NodeType.SPLIT,
    label: "Split",
    description: "Split data into branches",
    icon: "/logos/split.svg",
  },
  {
    type: NodeType.S3_UPLOAD,
    label: "S3 Upload",
    description: "Upload to Amazon S3",
    icon: "/logos/s3-upload.svg",
  },
  {
    type: NodeType.S3_DOWNLOAD,
    label: "S3 Download",
    description: "Download from Amazon S3",
    icon: "/logos/s3-download.svg",
  },
  {
    type: NodeType.GOOGLE_DRIVE,
    label: "Google Drive",
    description: "Read and write files in Google Drive",
    icon: "/logos/google-drive.svg",
  },
  {
    type: NodeType.DROPBOX,
    label: "Dropbox",
    description: "Read and write files in Dropbox",
    icon: "/logos/dropbox.svg",
  },
  {
    type: NodeType.LOCAL_STORAGE,
    label: "Local Storage",
    description: "Store files locally",
    icon: "/logos/local-storage.svg",
  },
];

interface NodeSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children?: ReactNode;
}

export function NodeSelector({
  open,
  onOpenChange,
  children,
}: NodeSelectorProps) {
  const { setNodes, getNodes, screenToFlowPosition } = useReactFlow();
  const [search, setSearch] = useState("");

  const filteredTriggerNodes = useMemo(() => {
    if (!search.trim()) return triggerNodes;
    const q = search.toLowerCase();
    return triggerNodes.filter(
      (n) =>
        n.label.toLowerCase().includes(q) ||
        n.description.toLowerCase().includes(q),
    );
  }, [search]);

  const filteredExecutionNodes = useMemo(() => {
    if (!search.trim()) return executionNodes;
    const q = search.toLowerCase();
    return executionNodes.filter(
      (n) =>
        n.label.toLowerCase().includes(q) ||
        n.description.toLowerCase().includes(q),
    );
  }, [search]);

  const handleNodeSelect = useCallback(
    (selection: NodeTypeOption) => {
      if (selection.type === NodeType.MANUAL_TRIGGER) {
        const nodes = getNodes();
        const hasManualTrigger = nodes.some(
          (node) => node.type === NodeType.MANUAL_TRIGGER,
        );

        if (hasManualTrigger) {
          toast.error("Only one manual trigger is allowed per workflow.");
          return;
        }
      }
      setNodes((nodes) => {
        const centerX = window.innerWidth / 2;
        const centerY = window.innerHeight / 2;
        const flowPosition = screenToFlowPosition({
          x: centerX + (Math.random() - 0.5) * 200,
          y: centerY + (Math.random() - 0.5) * 200,
        });
        const newNode = {
          id: createId(),
          data: {},
          position: flowPosition,
          type: selection.type,
        };

        const hasInitialTrigger = nodes.some(
          (node) => node.type === NodeType.INITIAL,
        );
        if (hasInitialTrigger) {
          // Replace only the INITIAL node(s) while preserving other nodes
          const remainingNodes = nodes.filter(
            (node) => node.type !== NodeType.INITIAL,
          );
          return [...remainingNodes, newNode];
        }

        return [...nodes, newNode];
      });

      onOpenChange(false);
    },
    [onOpenChange, setNodes, getNodes, screenToFlowPosition],
  );

  return (
    <Sheet
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) setSearch("");
        onOpenChange(isOpen);
      }}
    >
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>What triggers this workflow?</SheetTitle>
          <SheetDescription>
            A trigger is a step that starts your workflow.
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-3">
          <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Search nodes..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
        </div>

        {filteredTriggerNodes.length > 0 && (
          <div>
            {filteredTriggerNodes.map((nodeType) => {
              const Icon = nodeType.icon;
              return (
                <button
                  type="button"
                  key={nodeType.type}
                  className="w-full justify-start h-auto py-5 px-4 rounded-none cursor-pointer
                                    border-l-2 border-transparent hover:border-l-primary text-left bg-transparent"
                  onClick={() => handleNodeSelect(nodeType)}
                >
                  <div className="flex items-center gap-6 w-full overflow-hidden">
                    {typeof nodeType.icon === "string" ? (
                      <Image
                        src={nodeType.icon}
                        alt={nodeType.label}
                        className="size-5 object-contain rounded-sm"
                        width={20}
                        height={20}
                      />
                    ) : (
                      <Icon className="size-5 text-muted-foreground" />
                    )}
                    <div className="flex flex-col overflow-hidden">
                      <span className="font-medium text-sm text-foreground leading-tight">
                        {nodeType.label}
                      </span>
                      <span className="text-xs text-muted-foreground leading-tight overflow-hidden text-ellipsis">
                        {nodeType.description}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
        {filteredExecutionNodes.length > 0 && (
          <div>
            {filteredExecutionNodes.map((nodeType) => {
              const Icon = nodeType.icon;
              return (
                <button
                  type="button"
                  key={nodeType.type}
                  className="w-full justify-start h-auto py-5 px-4 rounded-none cursor-pointer
                                    border-l-2 border-transparent hover:border-l-primary text-left bg-transparent"
                  onClick={() => handleNodeSelect(nodeType)}
                >
                  <div className="flex items-center gap-6 w-full overflow-hidden">
                    {typeof nodeType.icon === "string" ? (
                      <Image
                        src={nodeType.icon}
                        alt={nodeType.label}
                        className="size-5 object-contain rounded-sm"
                        width={20}
                        height={20}
                      />
                    ) : (
                      <Icon className="size-5 text-muted-foreground" />
                    )}
                    <div className="flex flex-col overflow-hidden">
                      <span className="font-medium text-sm text-foreground leading-tight">
                        {nodeType.label}
                      </span>
                      <span className="text-xs text-muted-foreground leading-tight overflow-hidden text-ellipsis">
                        {nodeType.description}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
        {filteredTriggerNodes.length === 0 &&
          filteredExecutionNodes.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <SearchIcon className="size-8 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">
                No nodes matching &quot;{search}&quot;
              </p>
            </div>
          )}
      </SheetContent>
    </Sheet>
  );
}
