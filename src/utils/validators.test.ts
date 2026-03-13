import { describe, it, expect } from "vitest";
import {
  isValidSamAccountName,
  isValidDistinguishedName,
  isRequired,
  isMinLength,
  isMaxLength,
} from "./validators";

describe("isValidSamAccountName", () => {
  it("should accept valid names", () => {
    expect(isValidSamAccountName("john.doe")).toBe(true);
    expect(isValidSamAccountName("user_1")).toBe(true);
    expect(isValidSamAccountName("admin-01")).toBe(true);
  });

  it("should reject empty string", () => {
    expect(isValidSamAccountName("")).toBe(false);
  });

  it("should reject names longer than 20 characters", () => {
    expect(isValidSamAccountName("a".repeat(21))).toBe(false);
  });

  it("should accept names of exactly 20 characters", () => {
    expect(isValidSamAccountName("a".repeat(20))).toBe(true);
  });

  it("should reject names with spaces", () => {
    expect(isValidSamAccountName("john doe")).toBe(false);
  });

  it("should reject names with special characters", () => {
    expect(isValidSamAccountName("user@domain")).toBe(false);
    expect(isValidSamAccountName("user!name")).toBe(false);
  });
});

describe("isValidDistinguishedName", () => {
  it("should accept valid DNs starting with CN=", () => {
    expect(
      isValidDistinguishedName("CN=John Doe,OU=Users,DC=corp,DC=local"),
    ).toBe(true);
  });

  it("should accept valid DNs starting with OU=", () => {
    expect(isValidDistinguishedName("OU=Users,DC=corp,DC=local")).toBe(true);
  });

  it("should accept valid DNs starting with DC=", () => {
    expect(isValidDistinguishedName("DC=corp,DC=local")).toBe(true);
  });

  it("should reject empty string", () => {
    expect(isValidDistinguishedName("")).toBe(false);
  });

  it("should reject invalid DNs", () => {
    expect(isValidDistinguishedName("john.doe")).toBe(false);
    expect(isValidDistinguishedName("=value")).toBe(false);
  });
});

describe("isRequired", () => {
  it("should return true for non-empty string", () => {
    expect(isRequired("hello")).toBe(true);
  });

  it("should return false for empty string", () => {
    expect(isRequired("")).toBe(false);
  });

  it("should return false for whitespace-only string", () => {
    expect(isRequired("   ")).toBe(false);
  });

  it("should return false for null", () => {
    expect(isRequired(null)).toBe(false);
  });

  it("should return false for undefined", () => {
    expect(isRequired(undefined)).toBe(false);
  });

  it("should return true for number", () => {
    expect(isRequired(0)).toBe(true);
  });

  it("should return true for boolean", () => {
    expect(isRequired(false)).toBe(true);
  });
});

describe("isMinLength", () => {
  it("should return true when string meets minimum", () => {
    expect(isMinLength(3)("abc")).toBe(true);
  });

  it("should return false when string is too short", () => {
    expect(isMinLength(3)("ab")).toBe(false);
  });

  it("should return false for non-string", () => {
    expect(isMinLength(1)(42)).toBe(false);
  });
});

describe("isMaxLength", () => {
  it("should return true when string is within maximum", () => {
    expect(isMaxLength(5)("abc")).toBe(true);
  });

  it("should return false when string is too long", () => {
    expect(isMaxLength(2)("abc")).toBe(false);
  });

  it("should return false for non-string", () => {
    expect(isMaxLength(10)(42)).toBe(false);
  });
});
