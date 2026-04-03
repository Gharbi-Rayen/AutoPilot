import { atomWithStorage } from "jotai/utils";

// Supported locales
export type Locale = "en" | "fr" | "ar";

// Persisted in localStorage under the key "autopilot-locale"
// Defaults to "en" on first load
export const localeAtom = atomWithStorage<Locale>("autopilot-locale", "en");
