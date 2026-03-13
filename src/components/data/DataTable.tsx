import { type ReactNode } from "react";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { EmptyState } from "@/components/common/EmptyState";

export interface Column<T> {
  key: keyof T & string;
  header: string;
  sortable?: boolean;
  frozen?: boolean;
  width?: number;
  render?: (value: T[keyof T], row: T) => ReactNode;
}

export type SortDirection = "asc" | "desc";

export interface SortState<T> {
  key: keyof T & string;
  direction: SortDirection;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  sortState?: SortState<T>;
  onSort?: (key: keyof T & string, direction: SortDirection) => void;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  emptyMessage?: string;
  rowKey: (row: T) => string;
}

export function DataTable<T>({
  columns,
  data,
  sortState,
  onSort,
  onRowClick,
  loading = false,
  emptyMessage = "No data available",
  rowKey,
}: DataTableProps<T>) {
  const handleSort = (col: Column<T>) => {
    if (!col.sortable || !onSort) return;
    const newDirection: SortDirection =
      sortState?.key === col.key && sortState.direction === "asc"
        ? "desc"
        : "asc";
    onSort(col.key, newDirection);
  };

  if (loading) {
    return (
      <div
        className="flex justify-center py-8"
        data-testid="data-table-loading"
      >
        <LoadingSpinner message="Loading..." />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div data-testid="data-table-empty">
        <EmptyState title={emptyMessage} />
      </div>
    );
  }

  return (
    <div
      className="overflow-auto rounded-lg border border-[var(--color-border-default)]"
      data-testid="data-table"
    >
      <table className="w-full border-collapse text-body">
        <thead>
          <tr className="bg-[var(--color-surface-card)] text-left">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`border-b border-[var(--color-border-default)] px-3 py-2 font-medium text-[var(--color-text-secondary)] ${
                  col.sortable
                    ? "cursor-pointer select-none hover:text-[var(--color-text-primary)]"
                    : ""
                } ${col.frozen ? "sticky left-0 z-10 bg-[var(--color-surface-card)]" : ""}`}
                style={col.width ? { width: col.width } : undefined}
                onClick={() => handleSort(col)}
                data-testid={`column-header-${col.key}`}
              >
                <span className="flex items-center gap-1">
                  {col.header}
                  {col.sortable && (
                    <span
                      className="inline-flex"
                      data-testid={`sort-icon-${col.key}`}
                    >
                      {sortState?.key === col.key ? (
                        sortState.direction === "asc" ? (
                          <ArrowUp size={14} />
                        ) : (
                          <ArrowDown size={14} />
                        )
                      ) : (
                        <ArrowUpDown size={14} className="opacity-30" />
                      )}
                    </span>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr
              key={rowKey(row)}
              className={`border-b border-[var(--color-border-subtle)] even:bg-[var(--color-surface-bg)] hover:bg-[var(--color-surface-hover)] transition-colors ${
                onRowClick ? "cursor-pointer" : ""
              }`}
              onClick={() => onRowClick?.(row)}
              data-testid="data-table-row"
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={`px-3 py-2 text-[var(--color-text-primary)] ${
                    col.frozen ? "sticky left-0 z-10 bg-inherit" : ""
                  }`}
                >
                  {col.render
                    ? col.render(row[col.key], row)
                    : String(row[col.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
