import { describe, it, expect, vi, beforeEach } from "vitest";
import { escapeCsvField, formatCsv, downloadCsv } from "./csvExport";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

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

describe("downloadCsv", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should invoke save_file_dialog with correct params", async () => {
    mockInvoke.mockResolvedValueOnce("/path/to/file.csv");

    await downloadCsv("export.csv", "Name,Age\nAlice,30");

    expect(mockInvoke).toHaveBeenCalledWith("save_file_dialog", {
      content: "Name,Age\nAlice,30",
      defaultName: "export.csv",
      filterName: "CSV files",
      filterExtensions: ["csv"],
    });
  });

  it("should return the saved path", async () => {
    mockInvoke.mockResolvedValueOnce("/downloads/data.csv");

    const result = await downloadCsv("data.csv", "a,b");
    expect(result).toBe("/downloads/data.csv");
  });

  it("should return null when user cancels", async () => {
    mockInvoke.mockResolvedValueOnce(null);

    const result = await downloadCsv("data.csv", "a,b");
    expect(result).toBeNull();
  });

  it("should propagate error when invoke rejects", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("Write failed"));

    await expect(downloadCsv("data.csv", "a,b")).rejects.toThrow(
      "Write failed",
    );
  });
});

describe("exportTableToCsv", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should format columns and data into CSV and call downloadCsv", async () => {
    mockInvoke.mockResolvedValueOnce("/path/to/file.csv");

    const { exportTableToCsv } = await import("./csvExport");

    const columns = [
      { key: "name" as const, header: "Name" },
      { key: "age" as const, header: "Age" },
    ];
    const data = [
      { name: "Alice", age: "30" },
      { name: "Bob", age: "25" },
    ];

    const result = await exportTableToCsv(columns, data, "test.csv");

    expect(mockInvoke).toHaveBeenCalledWith("save_file_dialog", {
      content: "Name,Age\nAlice,30\nBob,25",
      defaultName: "test.csv",
      filterName: "CSV files",
      filterExtensions: ["csv"],
    });
    expect(result).toBe("/path/to/file.csv");
  });

  it("should handle empty data array", async () => {
    mockInvoke.mockResolvedValueOnce("/path/to/file.csv");

    const { exportTableToCsv } = await import("./csvExport");

    const columns = [{ key: "name" as const, header: "Name" }];
    const result = await exportTableToCsv(columns, [], "test.csv");

    expect(mockInvoke).toHaveBeenCalledWith("save_file_dialog", {
      content: "Name",
      defaultName: "test.csv",
      filterName: "CSV files",
      filterExtensions: ["csv"],
    });
    expect(result).toBe("/path/to/file.csv");
  });

  it("should convert null/undefined values to empty string", async () => {
    mockInvoke.mockResolvedValueOnce("/path/to/file.csv");

    const { exportTableToCsv } = await import("./csvExport");

    const columns = [
      { key: "name" as const, header: "Name" },
      { key: "value" as const, header: "Value" },
    ];
    const data = [{ name: "Test", value: undefined as unknown as string }];

    await exportTableToCsv(columns, data, "test.csv");

    expect(mockInvoke).toHaveBeenCalledWith("save_file_dialog", {
      content: "Name,Value\nTest,",
      defaultName: "test.csv",
      filterName: "CSV files",
      filterExtensions: ["csv"],
    });
  });
});
