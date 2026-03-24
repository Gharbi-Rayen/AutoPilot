import { GoogleFormExecutor } from "@/features/triggers/components/googleForm-trigger/executor";
import { manualTriggerExecutor } from "@/features/triggers/components/manual-trigger/executor";
import { StripeExecutor } from "@/features/triggers/components/stripe-trigger/executor";
import { NodeType } from "@/generated/prisma";
import { AnthropicExecutor } from "../anthropic/executor";
import { CodeExecutor } from "../code/executor";
import { DiscordExecutor } from "../discord/executor";
import { DownloadFileExecutor } from "../download-file/executor";
import { EmailExecutor } from "../email/executor";
import { GeminiExecutor } from "../gemini/executor";
import { HttpRequestExecutor } from "../http-request/executor";
import { OpenAIExecutor } from "../openai/executor";
import { SlackExecutor } from "../slack/executor";
import {
  addSlideExecutor,
  appendRowExecutor,
  conditionExecutor,
  convertFileExecutor,
  convertImageExecutor,
  createPresentationExecutor,
  cropImageExecutor,
  csvAggregateExecutor,
  csvFilterExecutor,
  csvGenerateExecutor,
  csvJoinExecutor,
  csvParseExecutor,
  delayExecutor,
  dropboxExecutor,
  fillTemplateExecutor,
  filterExecutor,
  googleDriveExecutor,
  jsonTransformExecutor,
  localStorageExecutor,
  loopExecutor,
  mergeExecutor,
  ocrImageExecutor,
  pdfExtractTablesExecutor,
  pdfExtractTextExecutor,
  pdfFillFormExecutor,
  pdfGenerateExecutor,
  pdfMergeExecutor,
  pdfSignExecutor,
  pdfSplitExecutor,
  readExcelExecutor,
  readFileExecutor,
  resizeImageExecutor,
  s3DownloadExecutor,
  s3UploadExecutor,
  sheetTransformExecutor,
  splitExecutor,
  writeExcelExecutor,
  writeFileExecutor,
} from "../stubs/executors";
import { TelegramExecutor } from "../telegram/executor";
import type { NodeExecutor } from "../types";
import { UploadFileExecutor } from "../upload-file/executor";
import { WhatsAppExecutor } from "../whatsapp/executor";

export const executorRegistry: Record<NodeType, NodeExecutor> = {
  [NodeType.MANUAL_TRIGGER]: manualTriggerExecutor,
  [NodeType.HTTP_REQUEST]: HttpRequestExecutor,
  [NodeType.INITIAL]: manualTriggerExecutor,
  [NodeType.GOOGLE_FORM_TRIGGER]: GoogleFormExecutor,
  [NodeType.STRIPE_TRIGGER]: StripeExecutor,
  [NodeType.GEMINI]: GeminiExecutor,
  [NodeType.OPENAI]: OpenAIExecutor,
  [NodeType.ANTHROPIC]: AnthropicExecutor,
  [NodeType.DISCORD]: DiscordExecutor,
  [NodeType.SLACK]: SlackExecutor,
  [NodeType.TELEGRAM]: TelegramExecutor,
  [NodeType.EMAIL_SMTP]: EmailExecutor,
  [NodeType.WHATSAPP]: WhatsAppExecutor,
  [NodeType.CODE]: CodeExecutor,
  [NodeType.DOWNLOAD_FILE]: DownloadFileExecutor,
  // File Processing Nodes
  [NodeType.UPLOAD_FILE]: UploadFileExecutor,
  [NodeType.READ_FILE]: readFileExecutor,
  [NodeType.WRITE_FILE]: writeFileExecutor,
  [NodeType.CONVERT_FILE]: convertFileExecutor,
  // PDF Processing Nodes
  [NodeType.PDF_EXTRACT_TEXT]: pdfExtractTextExecutor,
  [NodeType.PDF_EXTRACT_TABLES]: pdfExtractTablesExecutor,
  [NodeType.PDF_SPLIT]: pdfSplitExecutor,
  [NodeType.PDF_MERGE]: pdfMergeExecutor,
  [NodeType.PDF_FILL_FORM]: pdfFillFormExecutor,
  [NodeType.PDF_GENERATE]: pdfGenerateExecutor,
  [NodeType.PDF_SIGN]: pdfSignExecutor,
  // CSV Processing Nodes
  [NodeType.CSV_PARSE]: csvParseExecutor,
  [NodeType.CSV_GENERATE]: csvGenerateExecutor,
  [NodeType.CSV_FILTER]: csvFilterExecutor,
  [NodeType.CSV_AGGREGATE]: csvAggregateExecutor,
  [NodeType.CSV_JOIN]: csvJoinExecutor,
  // Spreadsheet Nodes
  [NodeType.READ_EXCEL]: readExcelExecutor,
  [NodeType.WRITE_EXCEL]: writeExcelExecutor,
  [NodeType.APPEND_ROW]: appendRowExecutor,
  [NodeType.SHEET_TRANSFORM]: sheetTransformExecutor,
  // PowerPoint Nodes
  [NodeType.CREATE_PRESENTATION]: createPresentationExecutor,
  [NodeType.ADD_SLIDE]: addSlideExecutor,
  [NodeType.FILL_TEMPLATE]: fillTemplateExecutor,
  // Image Processing Nodes
  [NodeType.RESIZE_IMAGE]: resizeImageExecutor,
  [NodeType.CROP_IMAGE]: cropImageExecutor,
  [NodeType.CONVERT_IMAGE]: convertImageExecutor,
  [NodeType.OCR_IMAGE]: ocrImageExecutor,
  // Data Transformation Nodes
  [NodeType.JSON_TRANSFORM]: jsonTransformExecutor,
  [NodeType.FILTER]: filterExecutor,
  [NodeType.LOOP]: loopExecutor,
  [NodeType.CONDITION]: conditionExecutor,
  [NodeType.DELAY]: delayExecutor,
  [NodeType.MERGE]: mergeExecutor,
  [NodeType.SPLIT]: splitExecutor,
  // Storage Nodes
  [NodeType.S3_UPLOAD]: s3UploadExecutor,
  [NodeType.S3_DOWNLOAD]: s3DownloadExecutor,
  [NodeType.GOOGLE_DRIVE]: googleDriveExecutor,
  [NodeType.DROPBOX]: dropboxExecutor,
  [NodeType.LOCAL_STORAGE]: localStorageExecutor,
};

export const getExecutor = (type: NodeType): NodeExecutor => {
  const executor = executorRegistry[type];
  if (!executor) {
    throw new Error(`No executor found for node type: ${type}`);
  }

  return executor;
};
