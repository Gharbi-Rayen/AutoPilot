"use client";

import { createId } from "@paralleldrive/cuid2";
import { useReactFlow } from "@xyflow/react";
import {
  ArrowLeftRight,
  ArrowUpDown,
  BarChart3,
  Copy,
  File,
  GitBranch,
  MousePointerIcon,
  SearchIcon,
  Table2,
  Upload,
} from "lucide-react";
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
];

const executionNodes: NodeTypeOption[] = [
  {
    type: NodeType.WHATSAPP,
    label: "WhatsApp",
    description: "Send messages via WhatsApp Cloud API.",
    icon: "/logos/whatsapp.svg",
  },

  {
    type: NodeType.UPLOAD_FILE,
    label: "Upload File",
    description: "Upload file manually to workflow",
    icon: Upload,
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
    type: NodeType.CSV_SORT,
    label: "CSV Sort",
    description: "Sort CSV rows by a field",
    icon: ArrowUpDown,
  },
  {
    type: NodeType.CSV_DEDUPLICATE,
    label: "CSV Deduplicate",
    description: "Remove duplicate CSV rows",
    icon: Copy,
  },
  {
    type: NodeType.CSV_COLUMN_STATS,
    label: "CSV Column Stats",
    description: "Generate per-column statistics",
    icon: BarChart3,
  },
  {
    type: NodeType.CSV_CONSECUTIVE_SEQUENCE_ANALYZER,
    label: "Consecutive Sequence Analyzer",
    description: "Detect consecutive numeric sequences",
    icon: GitBranch,
  },
  {
    type: NodeType.CSV_COMPARE,
    label: "CSV Compare",
    description: "Compare two CSV datasets",
    icon: ArrowLeftRight,
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
