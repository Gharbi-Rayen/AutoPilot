"use client";

import { useAtomValue } from "jotai";
import ar from "@/messages/ar.json";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";
import { localeAtom } from "../store/language-atom";

// All message files indexed by locale
const messages = { en, fr, ar };

// Dot-notation key lookup, e.g. t("nav.workflows") → "Workflows"
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
  const locale = useAtomValue(localeAtom);
  const msgs = messages[locale] as Record<string, unknown>;

  return {
    t: (key: string) => getNestedValue(msgs, key),
    locale,
  };
}
