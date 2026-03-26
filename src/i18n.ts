import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import * as en from "./locales/en";

export const supportedLanguages = [
  { code: "en", label: "English" },
  { code: "fr", label: "Fran\u00e7ais" },
  { code: "de", label: "Deutsch" },
  { code: "it", label: "Italiano" },
  { code: "es", label: "Espa\u00f1ol" },
] as const;

export type LanguageCode = (typeof supportedLanguages)[number]["code"];

export const namespaces = Object.keys(en) as (keyof typeof en)[];

i18n.use(initReactI18next).init({
  resources: {
    en,
  },
  lng: "en",
  fallbackLng: "en",
  defaultNS: "common",
  ns: namespaces,
  interpolation: {
    escapeValue: false,
  },
});

/** Load the persisted language from AppSettings and apply it. */
export async function loadPersistedLanguage(): Promise<void> {
  try {
    const settings = await invoke<{ appearance?: { language?: string } }>(
      "get_settings",
    );
    const lang = settings?.appearance?.language;
    if (lang && lang !== i18n.language) {
      await i18n.changeLanguage(lang);
    }
  } catch {
    // Settings not available yet (e.g. not connected) - keep default
  }
}

/** Change language at runtime and persist the choice to AppSettings. */
export async function changeLanguage(lang: LanguageCode): Promise<void> {
  await i18n.changeLanguage(lang);
  try {
    const settings = await invoke<Record<string, unknown>>("get_settings");
    const appearance = (settings?.appearance as Record<string, unknown>) ?? {};
    await invoke("update_settings", {
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
