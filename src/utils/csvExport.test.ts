import { describe, it, expect, vi, afterEach } from "vitest";
import { escapeCsvField, formatCsv, downloadCsv } from "./csvExport";

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
  const mockLink = {
    href: "",
    download: "",
    click: vi.fn(),
  };

  let createObjectURLSpy: ReturnType<typeof vi.spyOn>;
  let revokeObjectURLSpy: ReturnType<typeof vi.spyOn>;
  let createElementSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function setupMocks() {
    createObjectURLSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:test");
    revokeObjectURLSpy = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    createElementSpy = vi
      .spyOn(document, "createElement")
      .mockReturnValue(mockLink as unknown as HTMLAnchorElement);
    mockLink.href = "";
    mockLink.download = "";
    mockLink.click.mockClear();
  }

  it("should create a Blob with CSV content", () => {
    setupMocks();
    downloadCsv("test.csv", "Name,Age\nAlice,30");

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    const blob = createObjectURLSpy.mock.calls[0][0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("text/csv;charset=utf-8;");
  });

  it("should set correct filename on link", () => {
    setupMocks();
    downloadCsv("export-data.csv", "a,b");

    expect(createElementSpy).toHaveBeenCalledWith("a");
    expect(mockLink.download).toBe("export-data.csv");
    expect(mockLink.href).toBe("blob:test");
  });

  it("should click the link to trigger download", () => {
    setupMocks();
    downloadCsv("test.csv", "x");

    expect(mockLink.click).toHaveBeenCalledTimes(1);
  });

  it("should revoke the object URL after download", () => {
    setupMocks();
    downloadCsv("test.csv", "x");

    expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:test");
  });
});
