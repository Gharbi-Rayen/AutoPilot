"use client";

import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";

interface VariableNameInputProps {
  value: string;
  onChange: (value: string) => void;
  suggestion: string;
  open: boolean;
  placeholder?: string;
  disabled?: boolean;
}

export function VariableNameInput({
  value,
  onChange,
  suggestion,
  open,
  placeholder,
  disabled,
}: VariableNameInputProps) {
  const [isAuto, setIsAuto] = useState(true);
  const prevSuggestionRef = useRef<string>("");
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const valueRef = useRef(value);
  valueRef.current = value;
  const isAutoRef = useRef(true);

  useEffect(() => {
    if (!open) {
      isAutoRef.current = true;
      setIsAuto(true);
      return;
    }
    const currentValue = valueRef.current;
    if (isAutoRef.current || currentValue === "" || currentValue === prevSuggestionRef.current) {
      isAutoRef.current = true;
      prevSuggestionRef.current = suggestion;
      if (suggestion) {
        onChangeRef.current(suggestion);
        setIsAuto(true);
      }
    } else {
      setIsAuto(false);
    }
  }, [open, suggestion]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    isAutoRef.current = false;
    setIsAuto(false);
    onChange(e.target.value);
  };

  const showAutoHint = isAuto && !!suggestion && value === suggestion;

  return (
    <div className="relative">
      <Input
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
        className={showAutoHint ? "pr-14" : undefined}
      />
      {showAutoHint && (
        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-muted-foreground">
          auto
        </span>
      )}
    </div>
  );
}
