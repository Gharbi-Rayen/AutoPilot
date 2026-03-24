"use client";

import { type NodeProps, useReactFlow } from "@xyflow/react";
import { memo } from "react";

import { BaseExecutionNode } from "@/features/executions/components/base-execution-node";

interface PendingNodeMeta {
  name: string;
  description: string;
  icon: string;
}

function createPendingNode(meta: PendingNodeMeta) {
  return memo((props: NodeProps) => {
    const { setNodes } = useReactFlow();

    const data = (props.data ?? {}) as Record<string, unknown>;

    const persistDefaults = () => {
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === props.id
            ? {
                ...node,
                data: {
                  ...node.data,
                  __pending: true,
                  __note:
                    "Ready in builder. Execution implementation in progress.",
                },
              }
            : node,
        ),
      );
    };

    return (
      <BaseExecutionNode
        {...props}
        id={props.id}
        name={meta.name}
        description={
          typeof data.__note === "string" ? data.__note : meta.description
        }
        icon={meta.icon}
        onSettings={persistDefaults}
        onDoubleClick={persistDefaults}
      />
    );
  });
}

export const WriteFileNode = createPendingNode({
  name: "Write File",
  description: "Write text or binary data to a file",
  icon: "/logos/write-file.svg",
});

export const ConvertFileNode = createPendingNode({
  name: "Convert File",
  description: "Convert a file between supported formats",
  icon: "/logos/convert-file.svg",
});

export const PdfExtractTablesNode = createPendingNode({
  name: "PDF Extract Tables",
  description: "Extract table structures from PDF pages",
  icon: "/logos/pdf-extract-tables.svg",
});

export const PdfSplitNode = createPendingNode({
  name: "PDF Split",
  description: "Split a PDF into multiple files",
  icon: "/logos/pdf-split.svg",
});

export const PdfMergeNode = createPendingNode({
  name: "PDF Merge",
  description: "Merge many PDF files into one",
  icon: "/logos/pdf-merge.svg",
});

export const PdfFillFormNode = createPendingNode({
  name: "PDF Fill Form",
  description: "Fill a PDF form with workflow variables",
  icon: "/logos/pdf-fill-form.svg",
});

export const PdfGenerateNode = createPendingNode({
  name: "PDF Generate",
  description: "Generate a PDF document from workflow data",
  icon: "/logos/pdf-generate.svg",
});

export const PdfSignNode = createPendingNode({
  name: "PDF Sign",
  description: "Apply a digital signature to a PDF",
  icon: "/logos/pdf-sign.svg",
});

export const CsvGenerateNode = createPendingNode({
  name: "CSV Generate",
  description: "Create CSV text from data rows",
  icon: "/logos/csv-generate.svg",
});

export const CsvFilterNode = createPendingNode({
  name: "CSV Filter",
  description: "Filter rows in CSV data",
  icon: "/logos/csv-filter.svg",
});

export const CsvAggregateNode = createPendingNode({
  name: "CSV Aggregate",
  description: "Aggregate grouped rows in CSV data",
  icon: "/logos/csv-aggregate.svg",
});

export const CsvJoinNode = createPendingNode({
  name: "CSV Join",
  description: "Join two CSV datasets by key",
  icon: "/logos/csv-join.svg",
});

export const ReadExcelNode = createPendingNode({
  name: "Read Excel",
  description: "Read sheets from Excel workbooks",
  icon: "/logos/read-excel.svg",
});

export const WriteExcelNode = createPendingNode({
  name: "Write Excel",
  description: "Write data into an Excel workbook",
  icon: "/logos/write-excel.svg",
});

export const AppendRowNode = createPendingNode({
  name: "Append Row",
  description: "Append rows to an Excel worksheet",
  icon: "/logos/append-row.svg",
});

export const SheetTransformNode = createPendingNode({
  name: "Sheet Transform",
  description: "Transform spreadsheet data and structure",
  icon: "/logos/sheet-transform.svg",
});

export const CreatePresentationNode = createPendingNode({
  name: "Create Presentation",
  description: "Create a new presentation",
  icon: "/logos/create-presentation.svg",
});

export const AddSlideNode = createPendingNode({
  name: "Add Slide",
  description: "Add slides to an existing presentation",
  icon: "/logos/add-slide.svg",
});

export const FillTemplateNode = createPendingNode({
  name: "Fill Template",
  description: "Populate a template presentation",
  icon: "/logos/fill-template.svg",
});

export const ResizeImageNode = createPendingNode({
  name: "Resize Image",
  description: "Resize image dimensions",
  icon: "/logos/resize-image.svg",
});

export const CropImageNode = createPendingNode({
  name: "Crop Image",
  description: "Crop an image region",
  icon: "/logos/crop-image.svg",
});

export const ConvertImageNode = createPendingNode({
  name: "Convert Image",
  description: "Convert image format",
  icon: "/logos/convert-image.svg",
});

export const OcrImageNode = createPendingNode({
  name: "OCR Image",
  description: "Extract text from an image",
  icon: "/logos/ocr-image.svg",
});

export const JsonTransformNode = createPendingNode({
  name: "JSON Transform",
  description: "Transform JSON data structures",
  icon: "/logos/json-transform.svg",
});

export const FilterNode = createPendingNode({
  name: "Filter",
  description: "Filter items by condition",
  icon: "/logos/filter.svg",
});

export const LoopNode = createPendingNode({
  name: "Loop",
  description: "Iterate through list items",
  icon: "/logos/loop.svg",
});

export const ConditionNode = createPendingNode({
  name: "Condition",
  description: "Branch workflow paths using conditions",
  icon: "/logos/condition.svg",
});

export const DelayNode = createPendingNode({
  name: "Delay",
  description: "Pause workflow for a configured duration",
  icon: "/logos/delay.svg",
});

export const MergeNode = createPendingNode({
  name: "Merge",
  description: "Merge multiple data streams",
  icon: "/logos/merge.svg",
});

export const SplitNode = createPendingNode({
  name: "Split",
  description: "Split data into multiple branches",
  icon: "/logos/split.svg",
});

export const S3UploadNode = createPendingNode({
  name: "S3 Upload",
  description: "Upload files to Amazon S3",
  icon: "/logos/s3-upload.svg",
});

export const S3DownloadNode = createPendingNode({
  name: "S3 Download",
  description: "Download files from Amazon S3",
  icon: "/logos/s3-download.svg",
});

export const GoogleDriveNode = createPendingNode({
  name: "Google Drive",
  description: "Read and write files in Google Drive",
  icon: "/logos/google-drive.svg",
});

export const DropboxNode = createPendingNode({
  name: "Dropbox",
  description: "Read and write files in Dropbox",
  icon: "/logos/dropbox.svg",
});

export const LocalStorageNode = createPendingNode({
  name: "Local Storage",
  description: "Store and retrieve files from local storage",
  icon: "/logos/local-storage.svg",
});
