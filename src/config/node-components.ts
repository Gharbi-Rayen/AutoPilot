import type { NodeTypes } from "@xyflow/react";

import { InitialNode } from "@/components/initial-node";
import { CsvAggregateNode } from "@/features/executions/components/csv-aggregate/node";
import { CsvColumnStatsNode } from "@/features/executions/components/csv-column-stats/node";
import { CsvCompareNode } from "@/features/executions/components/csv-compare/node";
import { CsvDeduplicateNode } from "@/features/executions/components/csv-deduplicate/node";
import { CsvFilterNode } from "@/features/executions/components/csv-filter/node";
import { CsvGenerateNode } from "@/features/executions/components/csv-generate/node";
import { CsvJoinNode } from "@/features/executions/components/csv-join/node";
import { CsvParseNode } from "@/features/executions/components/csv-parse/node";
import { CsvSortNode } from "@/features/executions/components/csv-sort/node";
import { PdfExtractTablesNode } from "@/features/executions/components/pdf-extract-tables/node";
import { PdfExtractTextNode } from "@/features/executions/components/pdf-extract-text/node";
import { PdfFillFormNode } from "@/features/executions/components/pdf-fill-form/node";
import { PdfGenerateNode } from "@/features/executions/components/pdf-generate/node";
import { PdfMergeNode } from "@/features/executions/components/pdf-merge/node";
import { PdfSignNode } from "@/features/executions/components/pdf-sign/node";
import { PdfSplitNode } from "@/features/executions/components/pdf-split/node";
import { UploadFileNode } from "@/features/executions/components/upload-file/node";
import { WhatsAppNode } from "@/features/executions/components/whatsapp/node";
import { ManualTriggerNode } from "@/features/triggers/components/manual-trigger/node";
import { NodeType } from "@/generated/prisma";

export const nodeComponents: NodeTypes = {
  [NodeType.INITIAL]: InitialNode,
  [NodeType.MANUAL_TRIGGER]: ManualTriggerNode,
  [NodeType.WHATSAPP]: WhatsAppNode,
  [NodeType.PDF_EXTRACT_TEXT]: PdfExtractTextNode,
  [NodeType.CSV_PARSE]: CsvParseNode,
  [NodeType.UPLOAD_FILE]: UploadFileNode,
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
} as const satisfies NodeTypes;

export type RegisteredNodeType = keyof typeof nodeComponents;
