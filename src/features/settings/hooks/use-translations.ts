"use client";

import ar from "@/messages/ar.json";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

// Offline PWA — default to English (language switching removed)
const messages = { en, fr, ar } as const;
type Locale = keyof typeof messages;

function getNestedValue(obj: Record<string, unknown>, path: string): string {
  const keys = path.split(".");
  let current: unknown = obj;
  for (const key of keys) {
    if (current == null || typeof current !== "object") return path;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" ? current : path;
}

export function useTranslations() {
  const locale: Locale = "en";
  const msgs = messages[locale] as Record<string, unknown>;
  return {
    t: (key: string) => getNestedValue(msgs, key),
    locale,
  };
}
