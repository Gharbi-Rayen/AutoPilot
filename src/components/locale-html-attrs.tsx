"use client";

// This component sets the lang and dir attributes on <html>
// whenever the user changes language. It renders nothing visible.

import { useEffect } from "react";
import { useAtomValue } from "jotai";
import { localeAtom } from "@/features/settings/store/language-atom";

const RTL_LOCALES = new Set(["ar"]);

export function LocaleHtmlAttrs() {
  const locale = useAtomValue(localeAtom);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = RTL_LOCALES.has(locale) ? "rtl" : "ltr";
  }, [locale]);

  return null; // renders nothing
}