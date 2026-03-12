"use client";

import {
  AlertCircleIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  KeyIcon,
  Loader2Icon,
  PlusIcon,
} from "lucide-react";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CredentialType } from "@/generated/prisma";
import { cn } from "@/lib/utils";
import { useCredentialsByType } from "../hooks/use-credentials";

const credentialConfig: Record<
  string,
  { label: string; credentialLabel: string; logo: string; color: string }
> = {
  [CredentialType.OPENAI]: {
    label: "OpenAI",
    credentialLabel: "API key",
    logo: "/logos/openai.svg",
    color: "emerald",
  },
  [CredentialType.ANTHROPIC]: {
    label: "Anthropic",
    credentialLabel: "API key",
    logo: "/logos/anthropic.svg",
    color: "amber",
  },
  [CredentialType.GEMINI]: {
    label: "Gemini",
    credentialLabel: "API key",
    logo: "/logos/gemini.svg",
    color: "blue",
  },
  [CredentialType.DISCORD_WEBHOOK]: {
    label: "Discord Webhook",
    credentialLabel: "webhook URL",
    logo: "/logos/discord.svg",
    color: "indigo",
  },
  [CredentialType.SLACK_WEBHOOK]: {
    label: "Slack Webhook",
    credentialLabel: "webhook URL",
    logo: "/logos/slack.svg",
    color: "purple",
  },
  [CredentialType.TELEGRAM_BOT]: {
    label: "Telegram Bot",
    credentialLabel: "bot token",
    logo: "/logos/telegram.svg",
    color: "sky",
  },
  [CredentialType.EMAIL_SMTP]: {
    label: "Email (SMTP)",
    credentialLabel: "app password",
    logo: "/logos/gmail.svg",
    color: "red",
  },
  [CredentialType.WHATSAPP_TOKEN]: {
    label: "WhatsApp",
    credentialLabel: "access token",
    logo: "/logos/whatsapp.svg",
    color: "green",
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
  const [open, setOpen] = useState(false);

  const hasCredentials = credentials && credentials.length > 0;
  const selectedCredential = hasCredentials
    ? credentials.find((c) => c.id === value)
    : null;

  // Build the "Add credential" link with redirect back to current page
  const addKeyHref = `/credentials/new?redirect=${encodeURIComponent(pathname)}&type=${type}`;

  const handleAddKeyClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    startNavigation(() => {
      router.push(addKeyHref);
    });
  };

  const handleSelect = (credentialId: string) => {
    onChange(credentialId);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || isLoading}
          className={cn(
            "w-full h-10 justify-between font-normal transition-all duration-150",
            "hover:border-foreground/20 hover:bg-accent/50",
            value && "border-foreground/15",
            !value && "text-muted-foreground",
          )}
        >
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
              <span className="text-sm truncate text-foreground">
                {selectedCredential.name}
              </span>
            </div>
          ) : (
            <span className="text-sm">Select {config.credentialLabel}</span>
          )}
          <ChevronsUpDownIcon className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0"
        align="start"
        style={{ width: "var(--radix-popover-trigger-width)" }}
      >
        <div className="max-h-[240px] overflow-y-auto">
          {/* Loading state */}
          {isLoading && (
            <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
              <Loader2Icon className="size-3 animate-spin" />
              Loading credentials...
            </div>
          )}

          {/* Error state */}
          {isError && (
            <div className="flex flex-col items-center gap-2 py-4 px-3">
              <AlertCircleIcon className="size-4 text-destructive" />
              <span className="text-xs text-destructive">
                Failed to load credentials
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

          {/* Empty state */}
          {!isLoading && !isError && !hasCredentials && (
            <div className="flex flex-col items-center gap-2 py-5 px-4 text-center">
              <div className="flex items-center justify-center size-10 rounded-full bg-muted/60">
                <KeyIcon className="size-5 text-muted-foreground" />
              </div>
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-foreground">
                  No {config.credentialLabel} saved
                </p>
                <p className="text-xs text-muted-foreground">
                  Add a {config.credentialLabel} to get started
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs mt-1"
                disabled={isNavigating}
                onClick={handleAddKeyClick}
              >
                {isNavigating ? (
                  <Loader2Icon className="size-3 animate-spin" />
                ) : (
                  <PlusIcon className="size-3" />
                )}
                {isNavigating
                  ? "Redirecting..."
                  : `Add ${config.credentialLabel}`}
              </Button>
            </div>
          )}

          {/* Credential items */}
          {hasCredentials && (
            <div className="p-1">
              {credentials.map((credential) => (
                <button
                  type="button"
                  key={credential.id}
                  className={cn(
                    "flex items-center gap-2.5 w-full rounded-sm px-2 py-1.5 text-sm outline-none cursor-pointer",
                    "transition-colors hover:bg-accent hover:text-accent-foreground",
                    value === credential.id && "bg-accent",
                  )}
                  onClick={() => handleSelect(credential.id)}
                >
                  <Image
                    src={config.logo}
                    alt={config.label}
                    width={16}
                    height={16}
                    className="rounded-sm shrink-0"
                  />
                  <span className="text-sm font-medium truncate flex-1 text-left">
                    {credential.name}
                  </span>
                  {value === credential.id && (
                    <CheckIcon className="size-4 shrink-0 text-foreground" />
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Add new credential link at bottom when credentials exist */}
          {hasCredentials && (
            <div className="border-t border-border/40 p-1">
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
                {isNavigating
                  ? "Redirecting..."
                  : `Add new ${config.credentialLabel}`}
              </Button>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
