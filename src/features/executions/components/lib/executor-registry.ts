import { manualTriggerExecutor } from "@/features/triggers/components/manual-trigger/executor";
import { NodeType } from "@/generated/prisma";
import { CsvAggregateExecutor } from "../csv-aggregate/executor";
import { CsvColumnStatsExecutor } from "../csv-column-stats/executor";
import { CsvCompareExecutor } from "../csv-compare/executor";
import { CsvConsecutiveSequenceExecutor } from "../csv-consecutive-sequence/executor";
import { CsvDeduplicateExecutor } from "../csv-deduplicate/executor";
import { CsvTransformExecutor } from "../csv-transform/executor";

import { CsvFilterExecutor } from "../csv-filter/executor";
import { CsvJoinExecutor } from "../csv-join/executor";
import { CsvParseExecutor } from "../csv-parse/executor";
import { CsvSortExecutor } from "../csv-sort/executor";
import type { NodeExecutor, NodeExecutorParams } from "../types";
import { UploadFileExecutor } from "../upload-file/executor";
import { WhatsAppExecutor } from "../whatsapp/executor";

export const stubExecutor: NodeExecutor<unknown> = async (
  params: NodeExecutorParams<unknown>,
) => {
  return params.context;
};

export const executorRegistry: Partial<Record<NodeType, NodeExecutor>> = {
  [NodeType.MANUAL_TRIGGER]: manualTriggerExecutor,
  [NodeType.INITIAL]: manualTriggerExecutor,
  [NodeType.WHATSAPP]: WhatsAppExecutor,
  [NodeType.UPLOAD_FILE]: UploadFileExecutor,
  [NodeType.CSV_PARSE]: CsvParseExecutor,
  [NodeType.CSV_FILTER]: CsvFilterExecutor,
  [NodeType.CSV_AGGREGATE]: CsvAggregateExecutor,
  [NodeType.CSV_JOIN]: CsvJoinExecutor,
  [NodeType.CSV_SORT]: CsvSortExecutor,
  [NodeType.CSV_COLUMN_STATS]: CsvColumnStatsExecutor,
  [NodeType.CSV_COMPARE]: CsvCompareExecutor,
  [NodeType.CSV_CONSECUTIVE_SEQUENCE_ANALYZER]: CsvConsecutiveSequenceExecutor,

  [NodeType.CSV_GENERATE]: stubExecutor,
  [NodeType.CSV_DEDUPLICATE]: CsvDeduplicateExecutor,
  [NodeType.CSV_TRANSFORM]: CsvTransformExecutor,
  [NodeType.PDF_EXTRACT_TEXT]: stubExecutor,
  [NodeType.PDF_EXTRACT_TABLES]: stubExecutor,
  [NodeType.PDF_SPLIT]: stubExecutor,
  [NodeType.PDF_MERGE]: stubExecutor,
  [NodeType.PDF_FILL_FORM]: stubExecutor,
  [NodeType.PDF_GENERATE]: stubExecutor,
  [NodeType.PDF_SIGN]: stubExecutor,
};

export const getExecutor = (type: NodeType): NodeExecutor => {
  const executor = executorRegistry[type] || stubExecutor;
  return executor;
};

const fusionCompatibleNodeTypes = new Set<NodeType>([
  NodeType.CSV_PARSE,
  NodeType.CSV_FILTER,
  NodeType.CSV_AGGREGATE,
]);

export const isFusionCompatibleNodeType = (type: NodeType): boolean => {
  return fusionCompatibleNodeTypes.has(type);
};
