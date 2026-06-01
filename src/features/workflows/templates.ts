import { NodeType } from "@/types/node-type";

export interface TemplateNodeDef {
  type: NodeType;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface TemplateEdgeDef {
  sourceIdx: number;
  targetIdx: number;
  fromOutput: string;
  toInput: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  nodeTypes: NodeType[];
  nodes: TemplateNodeDef[];
  edges: TemplateEdgeDef[];
}

export const NODE_TYPE_LABELS: Partial<Record<NodeType, string>> = {
  [NodeType.INITIAL]: "Start",
  [NodeType.MANUAL_TRIGGER]: "Trigger",
  [NodeType.UPLOAD_FILE]: "Upload",
  [NodeType.CSV_PARSE]: "CSV Parse",
  [NodeType.CSV_FILTER]: "Filter",
  [NodeType.CSV_SORT]: "Sort",
  [NodeType.CSV_JOIN]: "Join",
  [NodeType.CSV_AGGREGATE]: "Aggregate",
  [NodeType.CSV_DEDUPLICATE]: "Deduplicate",
  [NodeType.CSV_COMPARE]: "Compare",
  [NodeType.CSV_TRANSFORM]: "Transform",
  [NodeType.CSV_COLUMN_TRANSFORM]: "Col. Transform",
  [NodeType.CSV_RESTRUCTURE]: "Restructure",
  [NodeType.CSV_GENERATE]: "Generate",
  [NodeType.FILE_EXPORT]: "Export",
  [NodeType.PDF_EXTRACT_TEXT]: "PDF Text",
  [NodeType.PDF_EXTRACT_TABLES]: "PDF Tables",
  [NodeType.PDF_SPLIT]: "PDF Split",
  [NodeType.PDF_MERGE]: "PDF Merge",
  [NodeType.PDF_FILL_FORM]: "PDF Form",
  [NodeType.PDF_GENERATE]: "PDF Gen.",
  [NodeType.PDF_SIGN]: "PDF Sign",
};

const X = 260;

export const workflowTemplates: WorkflowTemplate[] = [
  {
    id: "quick-preview",
    name: "Quick Preview",
    description: "Load and parse a CSV file to instantly inspect its contents.",
    icon: "👁️",
    nodeTypes: [NodeType.MANUAL_TRIGGER, NodeType.UPLOAD_FILE, NodeType.CSV_PARSE],
    nodes: [
      { type: NodeType.MANUAL_TRIGGER, position: { x: 0, y: 0 }, data: {} },
      { type: NodeType.UPLOAD_FILE, position: { x: X, y: 0 }, data: {} },
      { type: NodeType.CSV_PARSE, position: { x: X * 2, y: 0 }, data: {} },
    ],
    edges: [
      { sourceIdx: 0, targetIdx: 1, fromOutput: "main", toInput: "main" },
      { sourceIdx: 1, targetIdx: 2, fromOutput: "main", toInput: "main" },
    ],
  },
  {
    id: "csv-clean-restructure",
    name: "CSV Clean & Restructure",
    description: "Parse a CSV, filter unwanted rows, and reshape the column layout.",
    icon: "🧹",
    nodeTypes: [
      NodeType.MANUAL_TRIGGER,
      NodeType.UPLOAD_FILE,
      NodeType.CSV_PARSE,
      NodeType.CSV_FILTER,
      NodeType.CSV_RESTRUCTURE,
    ],
    nodes: [
      { type: NodeType.MANUAL_TRIGGER, position: { x: 0, y: 0 }, data: {} },
      { type: NodeType.UPLOAD_FILE, position: { x: X, y: 0 }, data: {} },
      { type: NodeType.CSV_PARSE, position: { x: X * 2, y: 0 }, data: {} },
      { type: NodeType.CSV_FILTER, position: { x: X * 3, y: 0 }, data: {} },
      { type: NodeType.CSV_RESTRUCTURE, position: { x: X * 4, y: 0 }, data: {} },
    ],
    edges: [
      { sourceIdx: 0, targetIdx: 1, fromOutput: "main", toInput: "main" },
      { sourceIdx: 1, targetIdx: 2, fromOutput: "main", toInput: "main" },
      { sourceIdx: 2, targetIdx: 3, fromOutput: "main", toInput: "main" },
      { sourceIdx: 3, targetIdx: 4, fromOutput: "main", toInput: "main" },
    ],
  },
  {
    id: "csv-transform-pipeline",
    name: "CSV Transform Pipeline",
    description: "Apply column-level transforms and restructure the output schema.",
    icon: "🔄",
    nodeTypes: [
      NodeType.MANUAL_TRIGGER,
      NodeType.UPLOAD_FILE,
      NodeType.CSV_PARSE,
      NodeType.CSV_COLUMN_TRANSFORM,
      NodeType.CSV_RESTRUCTURE,
    ],
    nodes: [
      { type: NodeType.MANUAL_TRIGGER, position: { x: 0, y: 0 }, data: {} },
      { type: NodeType.UPLOAD_FILE, position: { x: X, y: 0 }, data: {} },
      { type: NodeType.CSV_PARSE, position: { x: X * 2, y: 0 }, data: {} },
      { type: NodeType.CSV_COLUMN_TRANSFORM, position: { x: X * 3, y: 0 }, data: {} },
      { type: NodeType.CSV_RESTRUCTURE, position: { x: X * 4, y: 0 }, data: {} },
    ],
    edges: [
      { sourceIdx: 0, targetIdx: 1, fromOutput: "main", toInput: "main" },
      { sourceIdx: 1, targetIdx: 2, fromOutput: "main", toInput: "main" },
      { sourceIdx: 2, targetIdx: 3, fromOutput: "main", toInput: "main" },
      { sourceIdx: 3, targetIdx: 4, fromOutput: "main", toInput: "main" },
    ],
  },
  {
    id: "csv-aggregate-report",
    name: "Aggregate Report",
    description: "Group and summarize your data, then export the result as CSV.",
    icon: "📊",
    nodeTypes: [
      NodeType.MANUAL_TRIGGER,
      NodeType.UPLOAD_FILE,
      NodeType.CSV_PARSE,
      NodeType.CSV_AGGREGATE,
      NodeType.FILE_EXPORT,
    ],
    nodes: [
      { type: NodeType.MANUAL_TRIGGER, position: { x: 0, y: 0 }, data: {} },
      { type: NodeType.UPLOAD_FILE, position: { x: X, y: 0 }, data: {} },
      { type: NodeType.CSV_PARSE, position: { x: X * 2, y: 0 }, data: {} },
      { type: NodeType.CSV_AGGREGATE, position: { x: X * 3, y: 0 }, data: {} },
      { type: NodeType.FILE_EXPORT, position: { x: X * 4, y: 0 }, data: {} },
    ],
    edges: [
      { sourceIdx: 0, targetIdx: 1, fromOutput: "main", toInput: "main" },
      { sourceIdx: 1, targetIdx: 2, fromOutput: "main", toInput: "main" },
      { sourceIdx: 2, targetIdx: 3, fromOutput: "main", toInput: "main" },
      { sourceIdx: 3, targetIdx: 4, fromOutput: "main", toInput: "main" },
    ],
  },
];
