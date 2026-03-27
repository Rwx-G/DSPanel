import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import * as en from "./locales/en";
import * as fr from "./locales/fr";
import * as de from "./locales/de";
import * as it from "./locales/it";
import * as es from "./locales/es";

export const supportedLanguages = [
  { code: "en", label: "English" },
  { code: "fr", label: "Fran\u00e7ais" },
  { code: "de", label: "Deutsch" },
  { code: "it", label: "Italiano" },
  { code: "es", label: "Espa\u00f1ol" },
] as const;

export type LanguageCode = (typeof supportedLanguages)[number]["code"];

export const namespaces = Object.keys(en) as (keyof typeof en)[];

// Use localStorage as fast cache for language preference (survives Vite hot reload)
const LANG_STORAGE_KEY = "dspanel-language";
function getLangCache(): string {
  try { return localStorage.getItem(LANG_STORAGE_KEY) || "en"; } catch { return "en"; }
}
function setLangCache(lang: string): void {
  try { localStorage.setItem(LANG_STORAGE_KEY, lang); } catch { /* noop */ }
}
const cachedLang = getLangCache();

if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    resources: {
      en,
      fr,
      de,
      it,
      es,
    },
    lng: cachedLang,
    fallbackLng: "en",
    defaultNS: "common",
    ns: namespaces,
    interpolation: {
      escapeValue: false,
    },
  });
}

/** Load the persisted language from AppSettings and apply it. */
export async function loadPersistedLanguage(): Promise<void> {
  try {
    const settings = await invoke<{ appearance?: { language?: string } }>(
      "get_app_settings",
    );
    const lang = settings?.appearance?.language;
    if (lang && lang !== i18n.language) {
      await i18n.changeLanguage(lang);
      setLangCache(lang);
    }
  } catch {
    // Settings not available yet (e.g. not connected) - keep default
  }
}

/** Change language at runtime and persist the choice to AppSettings. */
export async function changeLanguage(lang: LanguageCode): Promise<void> {
  await i18n.changeLanguage(lang);
  localStorage.setItem(LANG_STORAGE_KEY, lang);
  try {
    const settings = await invoke<Record<string, unknown>>("get_app_settings");
    const appearance = (settings?.appearance as Record<string, unknown>) ?? {};
    await invoke("set_app_settings", {
      settings: {
        ...settings,
        appearance: { ...appearance, language: lang },
      },
    });
  } catch {
    // Persist failed - language is still changed in-memory
  }
}

export { i18n };
