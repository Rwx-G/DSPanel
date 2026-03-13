import { describe, it, expect } from "vitest";
import { escapeCsvField, formatCsv } from "./csvExport";

describe("escapeCsvField", () => {
  it("should return plain text unchanged", () => {
    expect(escapeCsvField("hello")).toBe("hello");
  });

  it("should wrap fields with commas in quotes", () => {
    expect(escapeCsvField("hello,world")).toBe('"hello,world"');
  });

  it("should wrap fields with quotes and escape them", () => {
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
  });

  it("should wrap fields with newlines in quotes", () => {
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
  });

  it("should wrap fields with carriage returns in quotes", () => {
    expect(escapeCsvField("line1\rline2")).toBe('"line1\rline2"');
  });

  it("should handle empty string", () => {
    expect(escapeCsvField("")).toBe("");
  });
});

describe("formatCsv", () => {
  it("should format headers and rows", () => {
    const result = formatCsv(
      ["Name", "Age"],
      [
        ["Alice", "30"],
        ["Bob", "25"],
      ],
    );
    expect(result).toBe("Name,Age\nAlice,30\nBob,25");
  });

  it("should escape fields in rows", () => {
    const result = formatCsv(["Name"], [['O"Brien']]);
    expect(result).toBe('Name\n"O""Brien"');
  });

  it("should handle empty rows", () => {
    const result = formatCsv(["Name", "Age"], []);
    expect(result).toBe("Name,Age");
  });

  it("should handle single row", () => {
    const result = formatCsv(["X"], [["1"]]);
    expect(result).toBe("X\n1");
  });
});
