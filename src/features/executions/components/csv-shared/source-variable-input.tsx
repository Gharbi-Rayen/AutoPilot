"use client";

import { useMemo } from "react";
import { FieldSuggestionInput } from "./field-suggestion-input";
import { useUpstreamVariableMetadata } from "./use-upstream-variable-metadata";

interface SourceVariableInputProps {
  nodeId: string;
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  mode?: "single" | "multi";
  disabled?: boolean;
}

export const SourceVariableInput = ({
  nodeId,
  value,
  onValueChange,
  placeholder,
  mode = "single",
  disabled,
}: SourceVariableInputProps) => {
  const { catalog, getRowCount } = useUpstreamVariableMetadata(nodeId);

  const suggestions = useMemo(
    () =>
      Array.from(catalog.keys()).map((name) => {
        const rowCount = getRowCount(name);
        return {
          name,
          type:
            rowCount != null
              ? `${rowCount.toLocaleString()} rows`
              : undefined,
        };
      }),
    [catalog, getRowCount],
  );

  return (
    <FieldSuggestionInput
      value={value}
      onValueChange={onValueChange}
      suggestions={suggestions}
      mode={mode}
      placeholder={placeholder}
      disabled={disabled}
      emptyText="No upstream variables found. Connect a node first."
    />
  );
};
