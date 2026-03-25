import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ExportToolbar, type ExportColumn } from "./ExportToolbar";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

interface TestRow {
  name: string;
  email: string;
}

const columns: ExportColumn[] = [
  { key: "name", header: "Name" },
  { key: "email", header: "Email" },
];

const data: TestRow[] = [
  { name: "Alice", email: "alice@test.com" },
  { name: "Bob", email: "bob@test.com" },
];

const rowMapper = (row: TestRow) => [row.name, row.email];

describe("ExportToolbar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue("/tmp/test.csv");
  });

  it("renders export button", () => {
    render(
      <ExportToolbar
        columns={columns}
        data={data}
        rowMapper={rowMapper}
        title="Test Export"
        filenameBase="test"
      />,
    );
    expect(screen.getByTestId("export-button")).toBeInTheDocument();
    expect(screen.getByText("Export")).toBeInTheDocument();
  });

  it("disables button when data is empty", () => {
    render(
      <ExportToolbar
        columns={columns}
        data={[]}
        rowMapper={rowMapper}
        title="Test Export"
        filenameBase="test"
      />,
    );
    expect(screen.getByTestId("export-button")).toBeDisabled();
  });

  it("opens dropdown menu on click", () => {
    render(
      <ExportToolbar
        columns={columns}
        data={data}
        rowMapper={rowMapper}
        title="Test Export"
        filenameBase="test"
      />,
    );
    fireEvent.click(screen.getByTestId("export-button"));
    expect(screen.getByTestId("export-menu")).toBeInTheDocument();
    expect(screen.getByTestId("export-csv")).toBeInTheDocument();
    expect(screen.getByTestId("export-xlsx")).toBeInTheDocument();
    expect(screen.getByTestId("export-pdf")).toBeInTheDocument();
    expect(screen.getByTestId("export-html")).toBeInTheDocument();
  });

  it("calls export_table with csv format", async () => {
    render(
      <ExportToolbar
        columns={columns}
        data={data}
        rowMapper={rowMapper}
        title="Test Export"
        filenameBase="test"
      />,
    );
    fireEvent.click(screen.getByTestId("export-button"));
    fireEvent.click(screen.getByTestId("export-csv"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("export_table", expect.objectContaining({
        format: "csv",
        title: "Test Export",
        rows: [["Alice", "alice@test.com"], ["Bob", "bob@test.com"]],
      }));
    });
  });

  it("calls export_table with xlsx format", async () => {
    render(
      <ExportToolbar
        columns={columns}
        data={data}
        rowMapper={rowMapper}
        title="Test Export"
        filenameBase="test"
      />,
    );
    fireEvent.click(screen.getByTestId("export-button"));
    fireEvent.click(screen.getByTestId("export-xlsx"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("export_table", expect.objectContaining({
        format: "xlsx",
      }));
    });
  });

  it("calls export_table with pdf format", async () => {
    render(
      <ExportToolbar
        columns={columns}
        data={data}
        rowMapper={rowMapper}
        title="Test Export"
        filenameBase="test"
      />,
    );
    fireEvent.click(screen.getByTestId("export-button"));
    fireEvent.click(screen.getByTestId("export-pdf"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("export_table", expect.objectContaining({
        format: "pdf",
      }));
    });
  });

  it("calls export_table with html format", async () => {
    render(
      <ExportToolbar
        columns={columns}
        data={data}
        rowMapper={rowMapper}
        title="Test Export"
        filenameBase="test"
      />,
    );
    fireEvent.click(screen.getByTestId("export-button"));
    fireEvent.click(screen.getByTestId("export-html"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("export_table", expect.objectContaining({
        format: "html",
      }));
    });
  });

  it("closes menu after export selection", async () => {
    render(
      <ExportToolbar
        columns={columns}
        data={data}
        rowMapper={rowMapper}
        title="Test Export"
        filenameBase="test"
      />,
    );
    fireEvent.click(screen.getByTestId("export-button"));
    expect(screen.getByTestId("export-menu")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("export-csv"));
    await waitFor(() => {
      expect(screen.queryByTestId("export-menu")).not.toBeInTheDocument();
    });
  });

  it("generates correct default filename with date", async () => {
    render(
      <ExportToolbar
        columns={columns}
        data={data}
        rowMapper={rowMapper}
        title="Test Export"
        filenameBase="my-report"
      />,
    );
    fireEvent.click(screen.getByTestId("export-button"));
    fireEvent.click(screen.getByTestId("export-csv"));

    await waitFor(() => {
      const call = mockInvoke.mock.calls[0];
      const args = call[1] as Record<string, unknown>;
      const defaultName = args.defaultName as string;
      expect(defaultName).toMatch(/^my-report_\d{4}-\d{2}-\d{2}\.csv$/);
    });
  });

  it("shows exporting state during export", async () => {
    let resolveExport: (value: unknown) => void;
    mockInvoke.mockReturnValue(new Promise((resolve) => { resolveExport = resolve; }));

    render(
      <ExportToolbar
        columns={columns}
        data={data}
        rowMapper={rowMapper}
        title="Test Export"
        filenameBase="test"
      />,
    );
    fireEvent.click(screen.getByTestId("export-button"));
    fireEvent.click(screen.getByTestId("export-csv"));

    await waitFor(() => {
      expect(screen.getByText("Exporting...")).toBeInTheDocument();
    });
    expect(screen.getByTestId("export-button")).toBeDisabled();

    resolveExport!("/tmp/test.csv");
    await waitFor(() => {
      expect(screen.getByText("Export")).toBeInTheDocument();
    });
  });
});
