import { type ReactNode, useState, useCallback, useRef } from "react";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { EmptyState } from "@/components/common/EmptyState";

export interface Column<T> {
  key: keyof T & string;
  header: string;
  sortable?: boolean;
  frozen?: boolean;
  width?: number;
  minWidth?: number;
  resizable?: boolean;
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
  onRowContextMenu?: (row: T, event: React.MouseEvent) => void;
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
  onRowContextMenu,
  loading = false,
  emptyMessage = "No data available",
  rowKey,
}: DataTableProps<T>) {
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      columns.filter((c) => c.width).map((c) => [c.key, c.width!]),
    ),
  );
  const resizingRef = useRef<{
    key: string;
    startX: number;
    startWidth: number;
    minWidth: number;
  } | null>(null);

  const handleSort = (col: Column<T>) => {
    if (!col.sortable || !onSort) return;
    const newDirection: SortDirection =
      sortState?.key === col.key && sortState.direction === "asc"
        ? "desc"
        : "asc";
    onSort(col.key, newDirection);
  };

  const handleResizeStart = useCallback(
    (e: React.MouseEvent, col: Column<T>) => {
      e.preventDefault();
      e.stopPropagation();
      const th = (e.target as HTMLElement).closest("th");
      const startWidth = columnWidths[col.key] ?? th?.offsetWidth ?? 100;
      resizingRef.current = {
        key: col.key,
        startX: e.clientX,
        startWidth,
        minWidth: col.minWidth ?? 50,
      };

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!resizingRef.current) return;
        const delta = moveEvent.clientX - resizingRef.current.startX;
        const newWidth = Math.max(
          resizingRef.current.minWidth,
          resizingRef.current.startWidth + delta,
        );
        setColumnWidths((prev) => ({
          ...prev,
          [resizingRef.current!.key]: newWidth,
        }));
      };

      const handleMouseUp = () => {
        resizingRef.current = null;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [columnWidths],
  );

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
            {columns.map((col) => {
              const isResizable = col.resizable !== false;
              const widthStyle = columnWidths[col.key]
                ? {
                    width: columnWidths[col.key],
                    minWidth: columnWidths[col.key],
                  }
                : col.width
                  ? { width: col.width }
                  : undefined;

              return (
                <th
                  key={col.key}
                  className={`relative border-b border-[var(--color-border-default)] px-3 py-2 font-medium text-[var(--color-text-secondary)] ${
                    col.sortable
                      ? "cursor-pointer select-none hover:text-[var(--color-text-primary)]"
                      : ""
                  } ${col.frozen ? "sticky left-0 z-10 bg-[var(--color-surface-card)]" : ""}`}
                  style={widthStyle}
                  onClick={() => handleSort(col)}
                  tabIndex={col.sortable ? 0 : undefined}
                  onKeyDown={
                    col.sortable
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleSort(col);
                          }
                        }
                      : undefined
                  }
                  aria-sort={
                    sortState?.key === col.key
                      ? sortState.direction === "asc"
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
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
                  {isResizable && (
                    <div
                      className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-[var(--color-primary)] opacity-0 hover:opacity-50 transition-opacity"
                      onMouseDown={(e) => handleResizeStart(e, col)}
                      data-testid={`resize-handle-${col.key}`}
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`Resize ${col.header} column`}
                    />
                  )}
                </th>
              );
            })}
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
              onContextMenu={
                onRowContextMenu
                  ? (e) => {
                      e.preventDefault();
                      onRowContextMenu(row, e);
                    }
                  : undefined
              }
              data-testid="data-table-row"
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={`px-3 py-2 text-[var(--color-text-primary)] ${
                    col.frozen ? "sticky left-0 z-10 bg-inherit" : ""
                  }`}
                  style={
                    columnWidths[col.key]
                      ? {
                          width: columnWidths[col.key],
                          minWidth: columnWidths[col.key],
                        }
                      : undefined
                  }
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
