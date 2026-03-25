"use client";

import { useAtom } from "jotai";
import { useTheme } from "next-themes";
import { useState } from "react";
import { toast } from "sonner";
import { localeAtom, type Locale } from "@/features/settings/store/language-atom";
import { useTranslations } from "@/features/settings/hooks/use-translations";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

// Language options shown in the selector
const LANGUAGES: { value: Locale; label: string; nativeLabel: string; flag: string }[] = [
  { value: "en", label: "English",  nativeLabel: "English", flag: "🇺🇸" },
  { value: "fr", label: "French",   nativeLabel: "Français", flag: "🇫🇷" },
  { value: "ar", label: "Arabic",   nativeLabel: "العربية",  flag: "🇸🇦" },
];

const THEMES = ["light", "dark", "system"] as const;

export default function SettingsPage() {
  const { t } = useTranslations();
  const { theme, setTheme } = useTheme();
  const [locale, setLocale] = useAtom(localeAtom);
  const [activeTab, setActiveTab] = useState<"account" | "general">("account");

  // Read session for account info
  const session = authClient.useSession();
  const user = session?.data?.user;

  function handleSave() {
    toast.success(t("settings.saved"));
  }

  return (
    <div className="max-w-2xl mx-auto py-10 px-6">
      <h1 className="text-2xl font-semibold mb-6">{t("settings.title")}</h1>

      {/* Tab bar */}
      <div className="flex gap-1 border-b mb-8">
        {(["account", "general"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={[
              "px-4 py-2 text-sm font-medium transition-colors",
              "border-b-2 -mb-px",
              activeTab === tab
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {t(`settings.${tab}`)}
          </button>
        ))}
      </div>

      {/* ── Account tab ─────────────────────────────────────────────── */}
      {activeTab === "account" && (
        <div className="flex flex-col gap-6">
          {/* Display name */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">{t("settings.displayName")}</label>
            <input
              type="text"
              defaultValue={user?.name ?? ""}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Email — read-only */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">{t("settings.email")}</label>
            <input
              type="email"
              value={user?.email ?? ""}
              readOnly
              className="w-full rounded-md border bg-muted px-3 py-2 text-sm
                         text-muted-foreground cursor-not-allowed"
            />
            <p className="text-xs text-muted-foreground">{t("settings.emailReadOnly")}</p>
          </div>

          <Button onClick={handleSave} className="self-start">
            {t("settings.saveChanges")}
          </Button>
        </div>
      )}

      {/* ── General tab ─────────────────────────────────────────────── */}
      {activeTab === "general" && (
        <div className="flex flex-col gap-8">

          {/* Language selector */}
          <div className="flex flex-col gap-3">
            <label className="text-sm font-medium">{t("settings.language")}</label>
            <div className="flex flex-col gap-2">
              {LANGUAGES.map((lang) => (
                <button
                  key={lang.value}
                  type="button"
                  onClick={() => setLocale(lang.value)}
                  className={[
                    "flex items-center gap-3 px-4 py-3 rounded-lg border text-sm",
                    "transition-colors text-left",
                    locale === lang.value
                      ? "border-primary bg-primary/5 text-foreground font-medium"
                      : "border-border bg-background text-muted-foreground hover:bg-muted",
                  ].join(" ")}
                >
                  <span className="text-lg leading-none">{lang.flag}</span>
                  <span>{lang.nativeLabel}</span>
                  {locale === lang.value && (
                    <span
                      className="ml-auto w-2 h-2 rounded-full bg-primary"
                      aria-hidden
                    />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Theme selector */}
          <div className="flex flex-col gap-3">
            <label className="text-sm font-medium">{t("settings.theme")}</label>
            <div className="flex gap-2">
              {THEMES.map((themeOption) => (
                <button
                  key={themeOption}
                  type="button"
                  onClick={() => setTheme(themeOption)}
                  className={[
                    "flex-1 px-3 py-2 rounded-lg border text-sm capitalize transition-colors",
                    theme === themeOption
                      ? "border-primary bg-primary/5 font-medium text-foreground"
                      : "border-border bg-background text-muted-foreground hover:bg-muted",
                  ].join(" ")}
                >
                  {t(`settings.theme${themeOption.charAt(0).toUpperCase() + themeOption.slice(1)}`)}
                </button>
              ))}
            </div>
          </div>

          <Button onClick={handleSave} className="self-start">
            {t("settings.saveChanges")}
          </Button>
        </div>
      )}
    </div>
  );
}