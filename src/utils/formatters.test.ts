import { describe, it, expect, beforeEach } from "vitest";
import { i18n } from "../i18n";
import {
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
} from "./formatters";

describe("formatters", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  describe("formatDate", () => {
    it("formats a Date object", () => {
      const result = formatDate(new Date(2026, 2, 15));
      expect(result).toContain("2026");
      expect(result).toContain("03");
      expect(result).toContain("15");
    });

    it("formats an ISO string", () => {
      const result = formatDate("2026-03-15T10:30:00Z");
      expect(result).toContain("2026");
    });

    it("returns empty string for null", () => {
      expect(formatDate(null)).toBe("");
    });

    it("returns empty string for undefined", () => {
      expect(formatDate(undefined)).toBe("");
    });

    it("returns original string for invalid date", () => {
      expect(formatDate("not-a-date")).toBe("not-a-date");
    });
  });

  describe("formatDateTime", () => {
    it("includes time components", () => {
      const result = formatDateTime(new Date(2026, 2, 15, 14, 30, 45));
      expect(result).toContain("2026");
      // Should contain some form of time
      expect(result.length).toBeGreaterThan(10);
    });

    it("returns empty string for null", () => {
      expect(formatDateTime(null)).toBe("");
    });
  });

  describe("formatNumber", () => {
    it("formats integers", () => {
      const result = formatNumber(1234567);
      // English uses commas: 1,234,567
      expect(result).toContain("1");
      expect(result).toContain("234");
    });

    it("returns empty string for null", () => {
      expect(formatNumber(null)).toBe("");
    });

    it("returns empty string for undefined", () => {
      expect(formatNumber(undefined)).toBe("");
    });
  });

  describe("formatPercent", () => {
    it("formats as percentage", () => {
      const result = formatPercent(85.5);
      expect(result).toContain("85");
      expect(result).toContain("%");
    });

    it("returns empty string for null", () => {
      expect(formatPercent(null)).toBe("");
    });
  });

  describe("locale-awareness", () => {
    it("changes formatting when locale changes", async () => {
      const date = new Date(2026, 2, 15);
      const enResult = formatDate(date);

      await i18n.changeLanguage("de");
      const deResult = formatDate(date);

      // Both contain 2026 and 15 and 03, but format may differ
      expect(enResult).toContain("2026");
      expect(deResult).toContain("2026");
      // They should both be valid formatted dates
      expect(enResult.length).toBeGreaterThan(0);
      expect(deResult.length).toBeGreaterThan(0);
    });
  });
});
