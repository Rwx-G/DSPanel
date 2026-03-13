import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DataTable, type Column } from "./DataTable";

interface TestRow {
  id: string;
  name: string;
  email: string;
}

const columns: Column<TestRow>[] = [
  { key: "name", header: "Name", sortable: true },
  { key: "email", header: "Email", sortable: true },
];

const testData: TestRow[] = [
  { id: "1", name: "Alice", email: "alice@test.com" },
  { id: "2", name: "Bob", email: "bob@test.com" },
  { id: "3", name: "Charlie", email: "charlie@test.com" },
];

describe("DataTable", () => {
  it("should render the table with data", () => {
    render(
      <DataTable columns={columns} data={testData} rowKey={(r) => r.id} />,
    );
    expect(screen.getByTestId("data-table")).toBeInTheDocument();
  });

  it("should render column headers", () => {
    render(
      <DataTable columns={columns} data={testData} rowKey={(r) => r.id} />,
    );
    expect(screen.getByTestId("column-header-name")).toHaveTextContent("Name");
    expect(screen.getByTestId("column-header-email")).toHaveTextContent(
      "Email",
    );
  });

  it("should render data rows", () => {
    render(
      <DataTable columns={columns} data={testData} rowKey={(r) => r.id} />,
    );
    const rows = screen.getAllByTestId("data-table-row");
    expect(rows).toHaveLength(3);
  });

  it("should render cell values", () => {
    render(
      <DataTable columns={columns} data={testData} rowKey={(r) => r.id} />,
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("bob@test.com")).toBeInTheDocument();
  });

  it("should show loading state", () => {
    render(
      <DataTable
        columns={columns}
        data={[]}
        loading={true}
        rowKey={(r) => r.id}
      />,
    );
    expect(screen.getByTestId("data-table-loading")).toBeInTheDocument();
  });

  it("should show empty state when no data", () => {
    render(<DataTable columns={columns} data={[]} rowKey={(r) => r.id} />);
    expect(screen.getByTestId("data-table-empty")).toBeInTheDocument();
  });

  it("should show custom empty message", () => {
    render(
      <DataTable
        columns={columns}
        data={[]}
        emptyMessage="No users found"
        rowKey={(r) => r.id}
      />,
    );
    expect(screen.getByText("No users found")).toBeInTheDocument();
  });

  it("should call onSort when sortable header is clicked", () => {
    const onSort = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={testData}
        onSort={onSort}
        rowKey={(r) => r.id}
      />,
    );
    fireEvent.click(screen.getByTestId("column-header-name"));
    expect(onSort).toHaveBeenCalledWith("name", "asc");
  });

  it("should toggle sort direction on second click", () => {
    const onSort = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={testData}
        sortState={{ key: "name", direction: "asc" }}
        onSort={onSort}
        rowKey={(r) => r.id}
      />,
    );
    fireEvent.click(screen.getByTestId("column-header-name"));
    expect(onSort).toHaveBeenCalledWith("name", "desc");
  });

  it("should show sort indicator for active sort column", () => {
    render(
      <DataTable
        columns={columns}
        data={testData}
        sortState={{ key: "name", direction: "asc" }}
        rowKey={(r) => r.id}
      />,
    );
    expect(screen.getByTestId("sort-icon-name")).toBeInTheDocument();
  });

  it("should call onRowClick when a row is clicked", () => {
    const onRowClick = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={testData}
        onRowClick={onRowClick}
        rowKey={(r) => r.id}
      />,
    );
    fireEvent.click(screen.getAllByTestId("data-table-row")[0]);
    expect(onRowClick).toHaveBeenCalledWith(testData[0]);
  });

  it("should support custom render function", () => {
    const customColumns: Column<TestRow>[] = [
      {
        key: "name",
        header: "Name",
        render: (value) => (
          <strong data-testid="custom-render">{String(value)}</strong>
        ),
      },
    ];
    render(
      <DataTable
        columns={customColumns}
        data={testData}
        rowKey={(r) => r.id}
      />,
    );
    expect(screen.getAllByTestId("custom-render")).toHaveLength(3);
  });

  it("should render resize handles on columns", () => {
    render(
      <DataTable columns={columns} data={testData} rowKey={(r) => r.id} />,
    );
    expect(screen.getByTestId("resize-handle-name")).toBeInTheDocument();
    expect(screen.getByTestId("resize-handle-email")).toBeInTheDocument();
  });

  it("should not render resize handle when resizable is false", () => {
    const nonResizableColumns: Column<TestRow>[] = [
      { key: "name", header: "Name", resizable: false },
      { key: "email", header: "Email" },
    ];
    render(
      <DataTable
        columns={nonResizableColumns}
        data={testData}
        rowKey={(r) => r.id}
      />,
    );
    expect(screen.queryByTestId("resize-handle-name")).not.toBeInTheDocument();
    expect(screen.getByTestId("resize-handle-email")).toBeInTheDocument();
  });

  it("should have col-resize cursor on resize handle", () => {
    render(
      <DataTable columns={columns} data={testData} rowKey={(r) => r.id} />,
    );
    const handle = screen.getByTestId("resize-handle-name");
    expect(handle).toHaveClass("cursor-col-resize");
  });

  it("should have separator role on resize handle", () => {
    render(
      <DataTable columns={columns} data={testData} rowKey={(r) => r.id} />,
    );
    const handle = screen.getByTestId("resize-handle-name");
    expect(handle).toHaveAttribute("role", "separator");
    expect(handle).toHaveAttribute("aria-orientation", "vertical");
  });

  it("should not trigger sort when clicking resize handle", () => {
    const onSort = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={testData}
        onSort={onSort}
        rowKey={(r) => r.id}
      />,
    );
    fireEvent.mouseDown(screen.getByTestId("resize-handle-name"), {
      clientX: 100,
    });
    expect(onSort).not.toHaveBeenCalled();
  });

  it("should resize column on mousedown + mousemove + mouseup", () => {
    const columnsWithWidth: Column<TestRow>[] = [
      { key: "name", header: "Name", sortable: true, width: 100 },
      { key: "email", header: "Email", sortable: true },
    ];
    render(
      <DataTable
        columns={columnsWithWidth}
        data={testData}
        rowKey={(r) => r.id}
      />,
    );
    const handle = screen.getByTestId("resize-handle-name");
    fireEvent.mouseDown(handle, { clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 150 });
    fireEvent.mouseUp(document);
    const th = screen.getByTestId("column-header-name");
    expect(th.style.width).toBe("150px");
  });

  it("should respect minWidth during resize", () => {
    const columnsWithMinWidth: Column<TestRow>[] = [
      {
        key: "name",
        header: "Name",
        sortable: true,
        width: 100,
        minWidth: 80,
      },
      { key: "email", header: "Email", sortable: true },
    ];
    render(
      <DataTable
        columns={columnsWithMinWidth}
        data={testData}
        rowKey={(r) => r.id}
      />,
    );
    const handle = screen.getByTestId("resize-handle-name");
    fireEvent.mouseDown(handle, { clientX: 100 });
    // Move left by 50px: 100 - 50 = 50, but minWidth is 80
    fireEvent.mouseMove(document, { clientX: 50 });
    fireEvent.mouseUp(document);
    const th = screen.getByTestId("column-header-name");
    expect(th.style.width).toBe("80px");
  });

  it("should set cursor to col-resize during resize", () => {
    const columnsWithWidth: Column<TestRow>[] = [
      { key: "name", header: "Name", sortable: true, width: 100 },
      { key: "email", header: "Email", sortable: true },
    ];
    render(
      <DataTable
        columns={columnsWithWidth}
        data={testData}
        rowKey={(r) => r.id}
      />,
    );
    const handle = screen.getByTestId("resize-handle-name");
    fireEvent.mouseDown(handle, { clientX: 100 });
    expect(document.body.style.cursor).toBe("col-resize");
    fireEvent.mouseUp(document);
    expect(document.body.style.cursor).toBe("");
  });

  it("should trigger sort on Enter key on sortable header", () => {
    const onSort = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={testData}
        onSort={onSort}
        rowKey={(r) => r.id}
      />,
    );
    fireEvent.keyDown(screen.getByTestId("column-header-name"), {
      key: "Enter",
    });
    expect(onSort).toHaveBeenCalledWith("name", "asc");
  });

  it("should trigger sort on Space key on sortable header", () => {
    const onSort = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={testData}
        onSort={onSort}
        rowKey={(r) => r.id}
      />,
    );
    fireEvent.keyDown(screen.getByTestId("column-header-name"), { key: " " });
    expect(onSort).toHaveBeenCalledWith("name", "asc");
  });

  it("should render frozen column with sticky class", () => {
    const frozenColumns: Column<TestRow>[] = [
      { key: "name", header: "Name", frozen: true },
      { key: "email", header: "Email" },
    ];
    render(
      <DataTable
        columns={frozenColumns}
        data={testData}
        rowKey={(r) => r.id}
      />,
    );
    const th = screen.getByTestId("column-header-name");
    expect(th).toHaveClass("sticky");
  });

  it("should render column with initial width", () => {
    const columnsWithWidth: Column<TestRow>[] = [
      { key: "name", header: "Name", width: 200 },
      { key: "email", header: "Email" },
    ];
    render(
      <DataTable
        columns={columnsWithWidth}
        data={testData}
        rowKey={(r) => r.id}
      />,
    );
    const th = screen.getByTestId("column-header-name");
    expect(th.style.width).toBe("200px");
  });

  it("should handle null values in cells", () => {
    interface NullableRow {
      id: string;
      name: string | null;
      email: string;
    }
    const nullColumns: Column<NullableRow>[] = [
      { key: "name", header: "Name" },
      { key: "email", header: "Email" },
    ];
    const nullData: NullableRow[] = [
      { id: "1", name: null, email: "test@test.com" },
    ];
    render(
      <DataTable
        columns={nullColumns}
        data={nullData}
        rowKey={(r) => r.id}
      />,
    );
    const rows = screen.getAllByTestId("data-table-row");
    expect(rows).toHaveLength(1);
    // The null value should render as empty string, not "null"
    expect(screen.queryByText("null")).not.toBeInTheDocument();
    expect(screen.getByText("test@test.com")).toBeInTheDocument();
  });
});
