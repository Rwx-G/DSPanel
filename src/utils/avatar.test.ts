import { describe, it, expect } from "vitest";
import { getInitials, getAvatarColor } from "./avatar";

describe("getInitials", () => {
  it("should return ? for undefined", () => {
    expect(getInitials(undefined)).toBe("?");
  });

  it("should return ? for empty string", () => {
    expect(getInitials("")).toBe("?");
  });

  it("should return ? for whitespace-only string", () => {
    expect(getInitials("   ")).toBe("?");
  });

  it("should return single letter for single-word name", () => {
    expect(getInitials("Alice")).toBe("A");
  });

  it("should return first and last initials for two-word name", () => {
    expect(getInitials("John Doe")).toBe("JD");
  });

  it("should return first and last initials for multi-word name", () => {
    expect(getInitials("Jean-Pierre De La Fontaine")).toBe("JF");
  });

  it("should uppercase initials", () => {
    expect(getInitials("alice bob")).toBe("AB");
  });

  it("should handle extra whitespace", () => {
    expect(getInitials("  Alice   Bob  ")).toBe("AB");
  });
});

describe("getAvatarColor", () => {
  it("should return an hsl color string", () => {
    const color = getAvatarColor("Alice");
    expect(color).toMatch(/^hsl\(\d+, 55%, 45%\)$/);
  });

  it("should be deterministic for the same name", () => {
    expect(getAvatarColor("Alice")).toBe(getAvatarColor("Alice"));
  });

  it("should produce different colors for different names", () => {
    expect(getAvatarColor("Alice")).not.toBe(getAvatarColor("Bob"));
  });
});
