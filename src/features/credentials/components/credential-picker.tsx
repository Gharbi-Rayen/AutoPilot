"use client";

import { AlertCircleIcon, KeyIcon, Loader2Icon, PlusIcon } from "lucide-react";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CredentialType } from "@/generated/prisma";
import { cn } from "@/lib/utils";
import { useCredentialsByType } from "../hooks/use-credentials";

const credentialConfig: Record<
  string,
  { label: string; logo: string; color: string }
> = {
  [CredentialType.OPENAI]: {
    label: "OpenAI",
    logo: "/logos/openai.svg",
    color: "emerald",
  },
  [CredentialType.ANTHROPIC]: {
    label: "Anthropic",
    logo: "/logos/anthropic.svg",
    color: "amber",
  },
  [CredentialType.GEMINI]: {
    label: "Gemini",
    logo: "/logos/gemini.svg",
    color: "blue",
  },
};

interface CredentialPickerProps {
  type: CredentialType;
  value?: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export const CredentialPicker = ({
  type,
  value,
  onChange,
  disabled,
}: CredentialPickerProps) => {
  const {
    data: credentials,
    isLoading,
    isError,
    refetch,
  } = useCredentialsByType(type);
  const config = credentialConfig[type];
  const pathname = usePathname();
  const router = useRouter();
  const [isNavigating, startNavigation] = useTransition();

  const hasCredentials = credentials && credentials.length > 0;
  const selectedCredential = hasCredentials
    ? credentials.find((c) => c.id === value)
    : null;

  // Build the "Add API Key" link with redirect back to current page
  const addKeyHref = `/credentials/new?redirect=${encodeURIComponent(pathname)}`;

  const handleAddKeyClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    startNavigation(() => {
      router.push(addKeyHref);
    });
  };

  return (
    <Select
      value={value || ""}
      onValueChange={onChange}
      disabled={disabled || isLoading}
    >
      <SelectTrigger
        className={cn(
          "w-full h-10 transition-all duration-150",
          "hover:border-foreground/20 hover:bg-accent/50",
          "focus:ring-1 focus:ring-ring",
          value && "border-foreground/15",
        )}
      >
        <SelectValue placeholder="Select an API key">
          {isLoading ? (
            <div className="flex items-center gap-2">
              <Loader2Icon className="size-3.5 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Loading...</span>
            </div>
          ) : value && selectedCredential ? (
            <div className="flex items-center gap-2.5">
              <Image
                src={config.logo}
                alt={config.label}
                width={16}
                height={16}
                className="rounded-sm shrink-0"
              />
              <span className="text-sm truncate">
                {selectedCredential.name}
              </span>
            </div>
          ) : (
            <span className="text-muted-foreground">Select an API key</span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {/* Loading state inside dropdown */}
        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground">
            <Loader2Icon className="size-3 animate-spin" />
            Loading API keys...
          </div>
        )}

        {/* Error state inside dropdown */}
        {isError && (
          <div className="flex flex-col items-center gap-2 py-3 px-2">
            <AlertCircleIcon className="size-4 text-destructive" />
            <span className="text-xs text-destructive">
              Failed to load keys
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={(e) => {
                e.stopPropagation();
                refetch();
              }}
            >
              Retry
            </Button>
          </div>
        )}

        {/* Empty state inside dropdown */}
        {!isLoading && !isError && !hasCredentials && (
          <div className="flex flex-col items-center gap-1.5 py-3 px-2 text-center">
            <KeyIcon className="size-4 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              No {config.label} API keys
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs mt-1"
              disabled={isNavigating}
              onClick={handleAddKeyClick}
            >
              {isNavigating ? (
                <Loader2Icon className="size-3 animate-spin" />
              ) : (
                <PlusIcon className="size-3" />
              )}
              {isNavigating ? "Redirecting..." : "Add API Key"}
            </Button>
          </div>
        )}

        {/* Credential items */}
        {hasCredentials &&
          credentials.map((credential) => (
            <SelectItem
              key={credential.id}
              value={credential.id}
              className="cursor-pointer transition-colors duration-100"
            >
              <div className="flex items-center gap-2.5 py-0.5">
                <Image
                  src={config.logo}
                  alt={config.label}
                  width={16}
                  height={16}
                  className="rounded-sm shrink-0"
                />
                <span className="text-sm font-medium truncate">
                  {credential.name}
                </span>
              </div>
            </SelectItem>
          ))}

        {/* Add new key link at bottom when credentials exist */}
        {hasCredentials && (
          <div className="border-t border-border/40 mt-1 pt-1 px-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full h-8 justify-start gap-2 text-xs text-muted-foreground hover:text-foreground"
              disabled={isNavigating}
              onClick={handleAddKeyClick}
            >
              {isNavigating ? (
                <Loader2Icon className="size-3 animate-spin" />
              ) : (
                <PlusIcon className="size-3" />
              )}
              {isNavigating ? "Redirecting..." : "Add new API key"}
            </Button>
          </div>
        )}
      </SelectContent>
    </Select>
  );
};
