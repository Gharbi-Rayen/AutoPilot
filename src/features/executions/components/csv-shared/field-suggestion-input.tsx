"use client";

import { X } from "lucide-react";
import type * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type SuggestionMode = "single" | "multi";

type SuggestionValue =
  | string
  | {
      name?: string;
      column?: string;
      field?: string;
      key?: string;
      label?: string;
      type?: string;
    };

type NormalizedSuggestion = {
  value: string;
  type?: string;
};

interface FieldSuggestionInputProps
  extends Omit<React.ComponentProps<typeof Input>, "value" | "onChange"> {
  value: string;
  onValueChange: (value: string) => void;
  suggestions: SuggestionValue[];
  mode?: SuggestionMode;
  emptyText?: string;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
}

const normalizeSuggestion = (suggestion: SuggestionValue) => {
  if (typeof suggestion === "string") {
    const trimmed = suggestion.trim();
    return trimmed ? { value: trimmed } : null;
  }

  const rawValue =
    suggestion.name ||
    suggestion.column ||
    suggestion.field ||
    suggestion.key ||
    suggestion.label ||
    "";

  if (typeof rawValue !== "string") {
    return null;
  }

  const value = rawValue.trim();
  if (!value) {
    return null;
  }

  const type =
    typeof suggestion.type === "string" && suggestion.type.trim().length > 0
      ? suggestion.type.trim()
      : undefined;

  return {
    value,
    type,
  } satisfies NormalizedSuggestion;
};

const normalizeSuggestions = (suggestions: SuggestionValue[]) => {
  const seen = new Set<string>();
  const normalized: NormalizedSuggestion[] = [];

  for (const suggestion of suggestions) {
    const normalizedSuggestion = normalizeSuggestion(suggestion);
    if (!normalizedSuggestion || seen.has(normalizedSuggestion.value)) {
      continue;
    }

    seen.add(normalizedSuggestion.value);
    normalized.push(normalizedSuggestion);
  }

  return normalized;
};

const getActiveQuery = (value: string, mode: SuggestionMode) => {
  if (mode === "single") {
    return value.trim();
  }

  const parts = value.split(",");
  return (parts[parts.length - 1] || "").trim();
};

const applySuggestion = (
  currentValue: string,
  selectedValue: string,
  mode: SuggestionMode,
) => {
  if (mode === "single") {
    return selectedValue;
  }

  const rawParts = currentValue.split(",");
  if (rawParts.length === 0) {
    return selectedValue;
  }

  rawParts[rawParts.length - 1] = selectedValue;

  return rawParts
    .map((part) => part.trim())
    .filter((part, index) => part.length > 0 || index === rawParts.length - 1)
    .join(", ");
};

const parseMultiValue = (value: string): string[] => {
  if (!value) {
    return [];
  }

  const seen = new Set<string>();
  const parsed: string[] = [];

  for (const part of value.split(",")) {
    const normalized = part.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    parsed.push(normalized);
  }

  return parsed;
};

const serializeMultiValue = (values: string[]) => values.join(", ");

export const FieldSuggestionInput = ({
  value,
  onValueChange,
  suggestions,
  mode = "single",
  emptyText = "No matching columns.",
  className,
  disabled,
  placeholder,
  readOnly,
  id,
  name,
  autoComplete,
  autoFocus,
  onPaste,
  onFocus,
  onKeyDown,
  onChange,
  ...props
}: FieldSuggestionInputProps) => {
  const [isFocused, setIsFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [multiDraft, setMultiDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const normalizedSuggestions = useMemo(
    () => normalizeSuggestions(suggestions),
    [suggestions],
  );

  const selectedTags = useMemo(() => parseMultiValue(value), [value]);
  const selectedTagSet = useMemo(() => new Set(selectedTags), [selectedTags]);

  const query =
    mode === "multi"
      ? multiDraft.trim().toLowerCase()
      : getActiveQuery(value, mode).toLowerCase();

  const filteredSuggestions = normalizedSuggestions.filter((candidate) => {
    if (mode === "multi" && selectedTagSet.has(candidate.value)) {
      return false;
    }

    if (!query) {
      return true;
    }

    return candidate.value.toLowerCase().includes(query);
  });

  const shouldShowSuggestions =
    isFocused && (filteredSuggestions.length > 0 || query.length > 0);

  const clearBlurTimer = () => {
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
  };

  const applySelectedSuggestion = (selectedValue: string) => {
    if (mode === "single") {
      onValueChange(applySuggestion(value, selectedValue, mode));
    } else {
      const tags = parseMultiValue(value);
      if (!tags.includes(selectedValue)) {
        onValueChange(serializeMultiValue([...tags, selectedValue]));
      }
      setMultiDraft("");
    }

    clearBlurTimer();
    setActiveIndex(-1);

    if (mode === "single") {
      setIsFocused(false);
      window.setTimeout(() => {
        inputRef.current?.blur();
      }, 0);
    } else {
      window.setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
    }
  };

  const addMultiTag = (candidate: string) => {
    const normalized = candidate.trim();
    if (!normalized) {
      return;
    }

    if (selectedTagSet.has(normalized)) {
      setMultiDraft("");
      return;
    }

    onValueChange(serializeMultiValue([...selectedTags, normalized]));
    setMultiDraft("");
    setActiveIndex(-1);
  };

  const removeMultiTag = (index: number) => {
    const next = selectedTags.filter(
      (_, currentIndex) => currentIndex !== index,
    );
    onValueChange(serializeMultiValue(next));
    window.setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
  };

  useEffect(() => {
    setActiveIndex((current) => {
      if (!shouldShowSuggestions) {
        return -1;
      }

      if (current < 0 || current >= filteredSuggestions.length) {
        return filteredSuggestions.length > 0 ? 0 : -1;
      }

      return current;
    });
  }, [filteredSuggestions.length, shouldShowSuggestions]);

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
        blurTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (mode !== "multi") {
      return;
    }

    if (!isFocused) {
      setMultiDraft("");
    }
  }, [isFocused, mode]);

  if (mode === "single") {
    return (
      <div className="relative w-full">
        <Input
          {...props}
          id={id}
          name={name}
          className={className}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          disabled={disabled}
          placeholder={placeholder}
          readOnly={readOnly}
          ref={inputRef}
          value={value}
          onFocus={(event) => {
            clearBlurTimer();
            setIsFocused(true);
            onFocus?.(event);
          }}
          onBlur={() => {
            clearBlurTimer();
            blurTimeoutRef.current = setTimeout(() => {
              setIsFocused(false);
              setActiveIndex(-1);
            }, 120);
          }}
          onKeyDown={(event) => {
            if (shouldShowSuggestions && filteredSuggestions.length > 0) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((current) => {
                  if (current < 0) {
                    return 0;
                  }
                  return Math.min(current + 1, filteredSuggestions.length - 1);
                });
                return;
              }

              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((current) => {
                  if (current <= 0) {
                    return 0;
                  }
                  return current - 1;
                });
                return;
              }

              if (event.key === "Enter" && activeIndex >= 0) {
                event.preventDefault();
                const selected = filteredSuggestions[activeIndex];
                if (selected) {
                  applySelectedSuggestion(selected.value);
                }
                return;
              }

              if (event.key === "Escape") {
                event.preventDefault();
                setIsFocused(false);
                setActiveIndex(-1);
                return;
              }
            }

            onKeyDown?.(event);
          }}
          onChange={(event) => {
            onValueChange(event.target.value);
            setActiveIndex(-1);
            onChange?.(event);
          }}
        />

        {shouldShowSuggestions ? (
          <div className="absolute left-0 top-full z-50 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-md">
            <div className="max-h-[108px] overflow-y-auto py-1">
              {filteredSuggestions.map((suggestion, index) => (
                <button
                  key={suggestion.value}
                  type="button"
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground ${
                    index === activeIndex
                      ? "bg-accent text-accent-foreground"
                      : ""
                  }`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    applySelectedSuggestion(suggestion.value);
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                  title={suggestion.value}
                >
                  <span className="truncate">{suggestion.value}</span>
                  {suggestion.type ? (
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {suggestion.type}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="relative w-full">
      <div
        className={cn(
          "w-full rounded-md border border-input bg-background px-2 py-1 text-sm",
          "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
          disabled && "cursor-not-allowed opacity-50",
          className,
        )}
      >
        <div className="max-h-[116px] overflow-y-auto">
          <div className="flex flex-wrap items-center gap-1">
            {selectedTags.map((tag, index) => (
              <span
                key={tag}
                className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs"
                title={tag}
              >
                <span className="truncate">{tag}</span>
                {!disabled && !readOnly ? (
                  <button
                    type="button"
                    className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      removeMultiTag(index);
                    }}
                  >
                    <X className="size-3" />
                    <span className="sr-only">Remove {tag}</span>
                  </button>
                ) : null}
              </span>
            ))}

            <input
              {...props}
              id={id}
              name={name}
              ref={inputRef}
              autoComplete={autoComplete}
              disabled={disabled}
              readOnly={readOnly}
              value={multiDraft}
              className="h-7 min-w-[120px] flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
              placeholder={
                selectedTags.length === 0 ? placeholder : "Add field"
              }
              onFocus={(event) => {
                clearBlurTimer();
                setIsFocused(true);
                onFocus?.(
                  event as unknown as React.FocusEvent<HTMLInputElement>,
                );
              }}
              onBlur={() => {
                clearBlurTimer();
                blurTimeoutRef.current = setTimeout(() => {
                  setIsFocused(false);
                  setActiveIndex(-1);
                }, 120);
              }}
              onPaste={(event) => {
                onPaste?.(
                  event as unknown as React.ClipboardEvent<HTMLInputElement>,
                );
                if (disabled || readOnly) {
                  return;
                }

                const pastedText = event.clipboardData.getData("text");
                if (!pastedText.includes(",")) {
                  return;
                }

                event.preventDefault();
                const candidates = pastedText
                  .split(",")
                  .map((entry) => entry.trim())
                  .filter((entry) => entry.length > 0);

                if (candidates.length === 0) {
                  return;
                }

                const nextValues = [...selectedTags];
                const seen = new Set(nextValues);
                for (const candidate of candidates) {
                  if (!seen.has(candidate)) {
                    seen.add(candidate);
                    nextValues.push(candidate);
                  }
                }

                onValueChange(serializeMultiValue(nextValues));
                setMultiDraft("");
                setActiveIndex(-1);
              }}
              onKeyDown={(event) => {
                if (shouldShowSuggestions && filteredSuggestions.length > 0) {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setActiveIndex((current) => {
                      if (current < 0) {
                        return 0;
                      }
                      return Math.min(
                        current + 1,
                        filteredSuggestions.length - 1,
                      );
                    });
                    return;
                  }

                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setActiveIndex((current) => {
                      if (current <= 0) {
                        return 0;
                      }
                      return current - 1;
                    });
                    return;
                  }
                }

                if (
                  event.key === "Enter" ||
                  event.key === "Tab" ||
                  event.key === ","
                ) {
                  const selected =
                    activeIndex >= 0 && filteredSuggestions.length > 0
                      ? filteredSuggestions[activeIndex]
                      : undefined;

                  const candidate = selected?.value ?? multiDraft;
                  if (candidate.trim().length > 0) {
                    event.preventDefault();
                    addMultiTag(candidate);
                    return;
                  }
                }

                if (event.key === "Backspace" && multiDraft.length === 0) {
                  if (selectedTags.length > 0) {
                    event.preventDefault();
                    removeMultiTag(selectedTags.length - 1);
                    return;
                  }
                }

                if (event.key === "Escape") {
                  event.preventDefault();
                  setActiveIndex(-1);
                  setIsFocused(false);
                  return;
                }

                onKeyDown?.(
                  event as unknown as React.KeyboardEvent<HTMLInputElement>,
                );
              }}
              onChange={(event) => {
                setMultiDraft(event.target.value);
                setActiveIndex(-1);
                onChange?.(
                  event as unknown as React.ChangeEvent<HTMLInputElement>,
                );
              }}
            />
          </div>
        </div>
      </div>

      {shouldShowSuggestions ? (
        <div className="absolute left-0 top-full z-50 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-md">
          <div className="max-h-[180px] overflow-y-auto py-1">
            {filteredSuggestions.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                {emptyText}
              </div>
            ) : (
              filteredSuggestions.map((suggestion, index) => (
                <button
                  key={suggestion.value}
                  type="button"
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground ${
                    index === activeIndex
                      ? "bg-accent text-accent-foreground"
                      : ""
                  }`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    applySelectedSuggestion(suggestion.value);
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                  title={suggestion.value}
                >
                  <span className="truncate">{suggestion.value}</span>
                  {suggestion.type ? (
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {suggestion.type}
                    </span>
                  ) : null}
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};
