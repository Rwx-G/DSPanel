import { describe, it, expect, beforeEach } from "vitest";
import { i18n, namespaces, supportedLanguages } from "./i18n";
import * as en from "./locales/en";

describe("i18n", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("initializes with English as default language", () => {
    expect(i18n.language).toBe("en");
  });

  it("has English as fallback language", () => {
    expect(i18n.options.fallbackLng).toEqual(["en"]);
  });

  it("uses common as default namespace", () => {
    expect(i18n.options.defaultNS).toBe("common");
  });

  it("loads all namespaces", () => {
    const loadedNs = i18n.options.ns;
    expect(loadedNs).toBeDefined();
    expect(Array.isArray(loadedNs) ? loadedNs.length : 0).toBeGreaterThan(0);
    for (const ns of namespaces) {
      expect(loadedNs).toContain(ns);
    }
  });

  it("resolves common namespace keys", () => {
    expect(i18n.t("common:save")).toBe("Save");
    expect(i18n.t("common:cancel")).toBe("Cancel");
    expect(i18n.t("common:delete")).toBe("Delete");
    expect(i18n.t("common:loading")).toBe("Loading...");
  });

  it("resolves sidebar namespace keys", () => {
    expect(i18n.t("sidebar:directory")).toBe("Directory");
    expect(i18n.t("sidebar:userLookup")).toBe("User Lookup");
    expect(i18n.t("sidebar:settings")).toBe("Settings");
  });

  it("resolves page namespace keys", () => {
    expect(i18n.t("userLookup:searchPlaceholder")).toBe(
      "Search by name, username, or email...",
    );
    expect(i18n.t("settings:pageTitle")).toBe("Settings");
    expect(i18n.t("about:heading")).toBe("DSPanel");
  });

  it("resolves nested keys in components namespace", () => {
    expect(i18n.t("components:errorBoundary.title")).toBe(
      "Something went wrong",
    );
    expect(i18n.t("components:searchBar.placeholder")).toBe("Search...");
  });

  it("resolves nested keys in dialogs namespace", () => {
    expect(i18n.t("dialogs:passwordReset.title")).toBe("Reset Password");
    expect(i18n.t("dialogs:mfa.verificationRequired")).toBe(
      "MFA Verification Required",
    );
  });

  it("handles interpolation", () => {
    expect(
      i18n.t("userDetail:deleteConfirmation", { name: "John Doe" }),
    ).toBe("Are you sure you want to delete John Doe?");
  });

  it("handles pluralization", () => {
    expect(i18n.t("common:member", { count: 1 })).toBe("1 member");
    expect(i18n.t("common:member", { count: 5 })).toBe("5 members");
  });

  it("switches language at runtime", async () => {
    expect(i18n.language).toBe("en");
    await i18n.changeLanguage("fr");
    expect(i18n.language).toBe("fr");
    // French translations are now loaded
    expect(i18n.t("common:save")).toBe("Enregistrer");
    // Switch back
    await i18n.changeLanguage("en");
    expect(i18n.language).toBe("en");
    expect(i18n.t("common:save")).toBe("Save");
  });

  it("falls back to English for missing keys", () => {
    // Non-existent key returns the key itself
    const result = i18n.t("common:nonExistentKey");
    expect(result).toBe("nonExistentKey");
  });
});

describe("English translation completeness", () => {
  it("every namespace in the index is registered", () => {
    const indexKeys = Object.keys(en);
    for (const key of indexKeys) {
      expect(namespaces).toContain(key);
    }
  });

  it("common namespace has essential keys", () => {
    const essentialKeys = [
      "save",
      "cancel",
      "delete",
      "close",
      "apply",
      "retry",
      "refresh",
      "search",
      "loading",
      "error",
      "yes",
      "no",
      "enabled",
      "disabled",
      "status",
      "name",
      "type",
      "description",
    ];
    for (const key of essentialKeys) {
      const value = i18n.t(`common:${key}`);
      expect(value).not.toBe(key);
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it("sidebar namespace has all navigation items", () => {
    const navKeys = [
      "directory",
      "infrastructure",
      "security",
      "tools",
      "workflows",
      "userLookup",
      "groupManagement",
      "computerLookup",
      "settings",
      "about",
    ];
    for (const key of navKeys) {
      const value = i18n.t(`sidebar:${key}`);
      expect(value).not.toBe(key);
    }
  });

  it("no namespace has empty string values", () => {
    for (const ns of namespaces) {
      const bundle = i18n.getResourceBundle("en", ns);
      if (!bundle) continue;
      const checkValues = (obj: Record<string, unknown>, prefix: string) => {
        for (const [key, value] of Object.entries(obj)) {
          const fullKey = `${prefix}.${key}`;
          if (typeof value === "string") {
            expect(value.length, `Empty value at ${fullKey}`).toBeGreaterThan(
              0,
            );
          } else if (
            typeof value === "object" &&
            value !== null &&
            !Array.isArray(value)
          ) {
            checkValues(value as Record<string, unknown>, fullKey);
          }
        }
      };
      checkValues(bundle, ns);
    }
  });
});

describe("supportedLanguages", () => {
  it("includes all 5 languages", () => {
    expect(supportedLanguages).toHaveLength(5);
    const codes = supportedLanguages.map((l) => l.code);
    expect(codes).toContain("en");
    expect(codes).toContain("fr");
    expect(codes).toContain("de");
    expect(codes).toContain("it");
    expect(codes).toContain("es");
  });

  it("each language has a non-empty label", () => {
    for (const lang of supportedLanguages) {
      expect(lang.label.length).toBeGreaterThan(0);
    }
  });
});
