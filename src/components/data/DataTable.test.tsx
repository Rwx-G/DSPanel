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
});
