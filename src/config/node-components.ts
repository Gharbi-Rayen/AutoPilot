import type { NodeTypes } from "@xyflow/react";

import { InitialNode } from "@/components/initial-node";
import { AnthropicNode } from "@/features/executions/components/anthropic/node";
import { CodeNode } from "@/features/executions/components/code/node";
import { CsvAggregateNode } from "@/features/executions/components/csv-aggregate/node";
import { CsvColumnStatsNode } from "@/features/executions/components/csv-column-stats/node";
import { CsvCompareNode } from "@/features/executions/components/csv-compare/node";
import { CsvDeduplicateNode } from "@/features/executions/components/csv-deduplicate/node";
import { CsvFilterNode } from "@/features/executions/components/csv-filter/node";
import { CsvGenerateNode } from "@/features/executions/components/csv-generate/node";
import { CsvJoinNode } from "@/features/executions/components/csv-join/node";
import { CsvParseNode } from "@/features/executions/components/csv-parse/node";
import { CsvSortNode } from "@/features/executions/components/csv-sort/node";
import { DiscordNode } from "@/features/executions/components/discord/node";
import { DownloadFileNode } from "@/features/executions/components/download-file/node";
import { EmailNode } from "@/features/executions/components/email/node";
import { FilterNode } from "@/features/executions/components/filter/node";
import { GeminiNode } from "@/features/executions/components/gemini/node";
import { HttpRequestNode } from "@/features/executions/components/http-request/node";
import { MergeNode } from "@/features/executions/components/merge/node";
import { OpenAINode } from "@/features/executions/components/openai/node";
import { PdfExtractTablesNode } from "@/features/executions/components/pdf-extract-tables/node";
import { PdfExtractTextNode } from "@/features/executions/components/pdf-extract-text/node";
import { PdfFillFormNode } from "@/features/executions/components/pdf-fill-form/node";
import { PdfGenerateNode } from "@/features/executions/components/pdf-generate/node";
import { PdfMergeNode } from "@/features/executions/components/pdf-merge/node";
import { PdfSignNode } from "@/features/executions/components/pdf-sign/node";
import { PdfSplitNode } from "@/features/executions/components/pdf-split/node";
import { ReadFileNode } from "@/features/executions/components/read-file/node";
import { SlackNode } from "@/features/executions/components/slack/node";
import { SplitNode } from "@/features/executions/components/split/node";
import {
  AddSlideNode,
  AppendRowNode,
  ConditionNode,
  ConvertFileNode,
  ConvertImageNode,
  CreatePresentationNode,
  CropImageNode,
  DelayNode,
  DropboxNode,
  FillTemplateNode,
  GoogleDriveNode,
  JsonTransformNode,
  LocalStorageNode,
  LoopNode,
  OcrImageNode,
  ReadExcelNode,
  ResizeImageNode,
  S3DownloadNode,
  S3UploadNode,
  SheetTransformNode,
  WriteExcelNode,
  WriteFileNode,
} from "@/features/executions/components/stubs/pending-node";
import { TelegramNode } from "@/features/executions/components/telegram/node";
import { UploadFileNode } from "@/features/executions/components/upload-file/node";
import { WhatsAppNode } from "@/features/executions/components/whatsapp/node";
import { GoogleFormTrigger } from "@/features/triggers/components/googleForm-trigger/node";
import { ManualTriggerNode } from "@/features/triggers/components/manual-trigger/node";
import { StripeTriggerNode } from "@/features/triggers/components/stripe-trigger/node";
import { NodeType } from "@/generated/prisma";

export const nodeComponents: NodeTypes = {
  [NodeType.INITIAL]: InitialNode,
  [NodeType.MANUAL_TRIGGER]: ManualTriggerNode,
  [NodeType.HTTP_REQUEST]: HttpRequestNode,
  [NodeType.GOOGLE_FORM_TRIGGER]: GoogleFormTrigger,
  [NodeType.STRIPE_TRIGGER]: StripeTriggerNode,
  [NodeType.GEMINI]: GeminiNode,
  [NodeType.OPENAI]: OpenAINode,
  [NodeType.ANTHROPIC]: AnthropicNode,
  [NodeType.DISCORD]: DiscordNode,
  [NodeType.SLACK]: SlackNode,
  [NodeType.TELEGRAM]: TelegramNode,
  [NodeType.EMAIL_SMTP]: EmailNode,
  [NodeType.WHATSAPP]: WhatsAppNode,
  [NodeType.CODE]: CodeNode,
  [NodeType.DOWNLOAD_FILE]: DownloadFileNode,
  [NodeType.READ_FILE]: ReadFileNode,
  [NodeType.PDF_EXTRACT_TEXT]: PdfExtractTextNode,
  [NodeType.CSV_PARSE]: CsvParseNode,
  [NodeType.UPLOAD_FILE]: UploadFileNode,
  [NodeType.WRITE_FILE]: WriteFileNode,
  [NodeType.CONVERT_FILE]: ConvertFileNode,
  [NodeType.PDF_EXTRACT_TABLES]: PdfExtractTablesNode,
  [NodeType.PDF_SPLIT]: PdfSplitNode,
  [NodeType.PDF_MERGE]: PdfMergeNode,
  [NodeType.PDF_FILL_FORM]: PdfFillFormNode,
  [NodeType.PDF_GENERATE]: PdfGenerateNode,
  [NodeType.PDF_SIGN]: PdfSignNode,
  [NodeType.CSV_GENERATE]: CsvGenerateNode,
  [NodeType.CSV_FILTER]: CsvFilterNode,
  [NodeType.CSV_AGGREGATE]: CsvAggregateNode,
  [NodeType.CSV_JOIN]: CsvJoinNode,
  [NodeType.CSV_SORT]: CsvSortNode,
  [NodeType.CSV_DEDUPLICATE]: CsvDeduplicateNode,
  [NodeType.CSV_COLUMN_STATS]: CsvColumnStatsNode,
  [NodeType.CSV_COMPARE]: CsvCompareNode,
  [NodeType.READ_EXCEL]: ReadExcelNode,
  [NodeType.WRITE_EXCEL]: WriteExcelNode,
  [NodeType.APPEND_ROW]: AppendRowNode,
  [NodeType.SHEET_TRANSFORM]: SheetTransformNode,
  [NodeType.CREATE_PRESENTATION]: CreatePresentationNode,
  [NodeType.ADD_SLIDE]: AddSlideNode,
  [NodeType.FILL_TEMPLATE]: FillTemplateNode,
  [NodeType.RESIZE_IMAGE]: ResizeImageNode,
  [NodeType.CROP_IMAGE]: CropImageNode,
  [NodeType.CONVERT_IMAGE]: ConvertImageNode,
  [NodeType.OCR_IMAGE]: OcrImageNode,
  [NodeType.JSON_TRANSFORM]: JsonTransformNode,
  [NodeType.FILTER]: FilterNode,
  [NodeType.LOOP]: LoopNode,
  [NodeType.CONDITION]: ConditionNode,
  [NodeType.DELAY]: DelayNode,
  [NodeType.MERGE]: MergeNode,
  [NodeType.SPLIT]: SplitNode,
  [NodeType.S3_UPLOAD]: S3UploadNode,
  [NodeType.S3_DOWNLOAD]: S3DownloadNode,
  [NodeType.GOOGLE_DRIVE]: GoogleDriveNode,
  [NodeType.DROPBOX]: DropboxNode,
  [NodeType.LOCAL_STORAGE]: LocalStorageNode,
} as const satisfies NodeTypes;

export type RegisteredNodeType = keyof typeof nodeComponents;
