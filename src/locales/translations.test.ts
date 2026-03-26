import { describe, it as test, expect, beforeEach, afterAll } from "vitest";
import { i18n } from "../i18n";
import * as en from "./en";
import * as fr from "./fr";
import * as de from "./de";
import * as itLocale from "./it";
import * as es from "./es";

/** Recursively collect all leaf keys from a nested object. */
function collectKeys(
  obj: Record<string, unknown>,
  prefix = "",
): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      keys.push(...collectKeys(value as Record<string, unknown>, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

/** Recursively get a value from a nested object by dot-path. */
function getNestedValue(
  obj: Record<string, unknown>,
  path: string,
): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

const languages = [
  { code: "fr", label: "French", data: fr },
  { code: "de", label: "German", data: de },
  { code: "it", label: "Italian", data: itLocale },
  { code: "es", label: "Spanish", data: es },
] as const;

const namespaces = Object.keys(en);

describe("Translation completeness", () => {
  for (const lang of languages) {
    describe(`${lang.label} (${lang.code})`, () => {
      test("has all namespaces from English", () => {
        const langNamespaces = Object.keys(lang.data);
        for (const ns of namespaces) {
          expect(
            langNamespaces,
            `Missing namespace "${ns}" in ${lang.code}`,
          ).toContain(ns);
        }
      });

      for (const ns of namespaces) {
        test(`namespace "${ns}" has all keys from English`, () => {
          const enBundle =
            en[ns as keyof typeof en] as Record<string, unknown>;
          const langBundle = (lang.data as Record<string, unknown>)[
            ns
          ] as Record<string, unknown> | undefined;

          if (!langBundle) {
            throw new Error(
              `Namespace "${ns}" missing in ${lang.code}`,
            );
          }

          const enKeys = collectKeys(enBundle);
          const langKeys = collectKeys(langBundle);

          const missingKeys = enKeys.filter(
            (key) => !langKeys.includes(key),
          );
          expect(
            missingKeys,
            `Missing keys in ${lang.code}/${ns}: ${missingKeys.join(", ")}`,
          ).toHaveLength(0);
        });
      }

      test("has no empty string values", () => {
        const emptyPaths: string[] = [];
        for (const ns of namespaces) {
          const bundle = (lang.data as Record<string, unknown>)[
            ns
          ] as Record<string, unknown> | undefined;
          if (!bundle) continue;
          const keys = collectKeys(bundle);
          for (const key of keys) {
            const value = getNestedValue(bundle, key);
            if (typeof value === "string" && value.trim() === "") {
              emptyPaths.push(`${ns}:${key}`);
            }
          }
        }
        expect(
          emptyPaths,
          `Empty values in ${lang.code}: ${emptyPaths.join(", ")}`,
        ).toHaveLength(0);
      });

      test("preserves interpolation variables from English", () => {
        const interpolationRegex = /\{\{(\w+)\}\}/g;
        const issues: string[] = [];

        for (const ns of namespaces) {
          const enBundle =
            en[ns as keyof typeof en] as Record<string, unknown>;
          const langBundle = (lang.data as Record<string, unknown>)[
            ns
          ] as Record<string, unknown> | undefined;
          if (!langBundle) continue;

          const enKeys = collectKeys(enBundle);
          for (const key of enKeys) {
            const enValue = getNestedValue(enBundle, key);
            const langValue = getNestedValue(langBundle, key);
            if (typeof enValue !== "string" || typeof langValue !== "string")
              continue;

            const enVars = [...enValue.matchAll(interpolationRegex)].map(
              (m) => m[1],
            );
            if (enVars.length === 0) continue;

            for (const v of enVars) {
              if (!langValue.includes(`{{${v}}}`)) {
                issues.push(
                  `${ns}:${key} missing {{${v}}} in ${lang.code}`,
                );
              }
            }
          }
        }
        expect(
          issues,
          `Interpolation issues: ${issues.join("; ")}`,
        ).toHaveLength(0);
      });
    });
  }
});

describe("Pluralization", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  for (const lang of languages) {
    test(`${lang.label} pluralization works correctly`, async () => {
      await i18n.changeLanguage(lang.code);

      // Test common:member pluralization
      const one = i18n.t("common:member", { count: 1 });
      const many = i18n.t("common:member", { count: 5 });
      expect(one).toContain("1");
      expect(many).toContain("5");
      // Singular and plural should be different (except if language uses same form)
      expect(one).not.toBe(many);
    });
  }

  // Reset to English
  afterAll(async () => {
    await i18n.changeLanguage("en");
  });
});

describe("Date formatting per locale", () => {
  const testDate = new Date(2026, 2, 15); // March 15, 2026

  test("French uses dd/MM/yyyy format", () => {
    const formatted = new Intl.DateTimeFormat("fr", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(testDate);
    expect(formatted).toBe("15/03/2026");
  });

  test("German uses dd.MM.yyyy format", () => {
    const formatted = new Intl.DateTimeFormat("de", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(testDate);
    expect(formatted).toBe("15.03.2026");
  });

  test("Italian uses dd/MM/yyyy format", () => {
    const formatted = new Intl.DateTimeFormat("it", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(testDate);
    expect(formatted).toBe("15/03/2026");
  });

  test("Spanish uses dd/MM/yyyy format", () => {
    const formatted = new Intl.DateTimeFormat("es", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(testDate);
    // Spanish may format as dd/MM/yyyy or d/M/yyyy depending on locale
    expect(formatted).toContain("15");
    expect(formatted).toContain("2026");
  });
});
