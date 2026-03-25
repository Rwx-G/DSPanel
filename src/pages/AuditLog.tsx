import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { EmptyState } from "@/components/common/EmptyState";
import { ExportToolbar, type ExportColumn } from "@/components/common/ExportToolbar";
import { extractErrorMessage } from "@/utils/errorMapping";
import {
  Search,
  RefreshCw,
  CheckCircle,
  XCircle,
  ClipboardList,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuditEntry {
  timestamp: string;
  operator: string;
  action: string;
  targetDn: string;
  details: string;
  success: boolean;
}

interface AuditFilter {
  dateFrom: string | null;
  dateTo: string | null;
  operator: string | null;
  action: string | null;
  targetDn: string | null;
  success: boolean | null;
  page: number;
  pageSize: number;
}

interface AuditQueryResult {
  entries: AuditEntry[];
  totalCount: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;

const EXPORT_COLUMNS: ExportColumn[] = [
  { key: "timestamp", header: "Timestamp" },
  { key: "operator", header: "Operator" },
  { key: "action", header: "Action" },
  { key: "targetDn", header: "Target" },
  { key: "details", header: "Details" },
  { key: "result", header: "Result" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleString();
  } catch {
    return ts;
  }
}

function formatDn(dn: string): string {
  const cn = dn.split(",")[0];
  return cn?.replace(/^CN=/i, "") ?? dn;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionTypes, setActionTypes] = useState<string[]>([]);

  // Filter state
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [operatorFilter, setOperatorFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [targetFilter, setTargetFilter] = useState("");
  const [resultFilter, setResultFilter] = useState<"" | "success" | "failure">("");

  // Expanded row
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const fetchEntries = useCallback(
    async (pageNum: number) => {
      setLoading(true);
      setError(null);
      try {
        const filter: AuditFilter = {
          dateFrom: dateFrom ? new Date(dateFrom).toISOString() : null,
          dateTo: dateTo
            ? new Date(dateTo + "T23:59:59").toISOString()
            : null,
          operator: operatorFilter || null,
          action: actionFilter || null,
          targetDn: targetFilter || null,
          success:
            resultFilter === "success"
              ? true
              : resultFilter === "failure"
                ? false
                : null,
          page: pageNum,
          pageSize: PAGE_SIZE,
        };
        const result = await invoke<AuditQueryResult>("query_audit_log", {
          filter,
        });
        setEntries(result.entries);
        setTotalCount(result.totalCount);
        setPage(pageNum);
        setExpandedRow(null);
      } catch (err) {
        setError(extractErrorMessage(err));
      } finally {
        setLoading(false);
      }
    },
    [dateFrom, dateTo, operatorFilter, actionFilter, targetFilter, resultFilter],
  );

  // Load action types for the dropdown
  useEffect(() => {
    invoke<string[]>("get_audit_action_types")
      .then(setActionTypes)
      .catch(() => {});
  }, []);

  // Initial load
  useEffect(() => {
    fetchEntries(0);
    // Only run on mount - filters are applied via Search button
  }, [fetchEntries]);

  const handleSearch = () => {
    fetchEntries(0);
  };

  const handleReset = () => {
    setDateFrom("");
    setDateTo("");
    setOperatorFilter("");
    setActionFilter("");
    setTargetFilter("");
    setResultFilter("");
    // Fetch will be triggered by user clicking Search after reset
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
  };

  return (
    <div className="flex h-full flex-col gap-4 p-4" data-testid="audit-log-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-heading font-semibold text-[var(--color-text-primary)]">
            Activity Journal
          </h1>
          <p className="text-caption text-[var(--color-text-secondary)]">
            Local log of all write operations performed through DSPanel on this
            workstation
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportToolbar
            columns={EXPORT_COLUMNS}
            data={entries}
            rowMapper={(e) => [
              formatTimestamp(e.timestamp),
              e.operator,
              e.action,
              e.targetDn,
              e.details,
              e.success ? "Success" : "Failure",
            ]}
            title="DSPanel Activity Journal"
            filenameBase="audit_log"
          />
          <button
            className="btn btn-sm rounded border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-2.5 py-1 text-caption font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors flex items-center gap-1"
            onClick={() => fetchEntries(page)}
            disabled={loading}
            data-testid="refresh-button"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div
        className="flex flex-wrap items-end gap-3 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-3"
        data-testid="audit-filter-bar"
      >
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-[var(--color-text-secondary)]">
            From
          </label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            onKeyDown={handleKeyDown}
            className="h-8 rounded border border-[var(--color-border-default)] bg-[var(--color-surface-default)] px-2 text-caption text-[var(--color-text-primary)]"
            data-testid="filter-date-from"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-[var(--color-text-secondary)]">
            To
          </label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            onKeyDown={handleKeyDown}
            className="h-8 rounded border border-[var(--color-border-default)] bg-[var(--color-surface-default)] px-2 text-caption text-[var(--color-text-primary)]"
            data-testid="filter-date-to"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-[var(--color-text-secondary)]">
            Operator
          </label>
          <input
            type="text"
            value={operatorFilter}
            onChange={(e) => setOperatorFilter(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. admin"
            className="h-8 w-32 rounded border border-[var(--color-border-default)] bg-[var(--color-surface-default)] px-2 text-caption text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)]"
            data-testid="filter-operator"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-[var(--color-text-secondary)]">
            Action
          </label>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="h-8 rounded border border-[var(--color-border-default)] bg-[var(--color-surface-default)] px-2 text-caption text-[var(--color-text-primary)]"
            data-testid="filter-action"
          >
            <option value="">All</option>
            {actionTypes.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-[var(--color-text-secondary)]">
            Target DN
          </label>
          <input
            type="text"
            value={targetFilter}
            onChange={(e) => setTargetFilter(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="partial match"
            className="h-8 w-40 rounded border border-[var(--color-border-default)] bg-[var(--color-surface-default)] px-2 text-caption text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)]"
            data-testid="filter-target"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-[var(--color-text-secondary)]">
            Result
          </label>
          <select
            value={resultFilter}
            onChange={(e) =>
              setResultFilter(e.target.value as "" | "success" | "failure")
            }
            className="h-8 rounded border border-[var(--color-border-default)] bg-[var(--color-surface-default)] px-2 text-caption text-[var(--color-text-primary)]"
            data-testid="filter-result"
          >
            <option value="">All</option>
            <option value="success">Success</option>
            <option value="failure">Failure</option>
          </select>
        </div>
        <div className="flex gap-2">
          <button
            className="btn btn-sm btn-primary flex items-center gap-1"
            onClick={handleSearch}
            disabled={loading}
            data-testid="search-button"
          >
            <Search size={14} />
            Search
          </button>
          <button
            className="btn btn-sm rounded border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-2.5 py-1 text-caption font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
            onClick={handleReset}
            data-testid="reset-button"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Content */}
      {error && (
        <div
          className="rounded-lg border border-[var(--color-error)] bg-[var(--color-error)]/10 px-4 py-3 text-caption text-[var(--color-error)]"
          data-testid="error-message"
        >
          {error}
        </div>
      )}

      {loading && entries.length === 0 ? (
        <LoadingSpinner />
      ) : entries.length === 0 && !loading ? (
        <EmptyState
          icon={<ClipboardList size={40} />}
          title="No audit entries found"
          description="Write operations performed through DSPanel will appear here. Adjust your filters if you expect results."
        />
      ) : (
        <>
          {/* Results count */}
          <div className="text-caption text-[var(--color-text-secondary)]">
            {totalCount} {totalCount === 1 ? "entry" : "entries"} found
            {totalPages > 1 && (
              <span>
                {" "}
                - page {page + 1} of {totalPages}
              </span>
            )}
          </div>

          {/* Table */}
          <div className="flex-1 overflow-auto rounded-lg border border-[var(--color-border-default)]">
            <table className="w-full text-caption" data-testid="audit-table">
              <thead>
                <tr className="bg-[var(--color-surface-card)] text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
                  <th className="px-3 py-2 w-[160px]">Timestamp</th>
                  <th className="px-3 py-2 w-[120px]">Operator</th>
                  <th className="px-3 py-2 w-[160px]">Action</th>
                  <th className="px-3 py-2">Target</th>
                  <th className="px-3 py-2 w-[70px] text-center">Result</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, idx) => (
                  <AuditRow
                    key={`${entry.timestamp}-${idx}`}
                    entry={entry}
                    isExpanded={expandedRow === idx}
                    onToggle={() =>
                      setExpandedRow(expandedRow === idx ? null : idx)
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2" data-testid="pagination">
              <button
                className="btn btn-sm rounded border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-1 hover:bg-[var(--color-surface-hover)] transition-colors disabled:opacity-40"
                onClick={() => fetchEntries(page - 1)}
                disabled={page === 0 || loading}
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-caption text-[var(--color-text-secondary)]">
                {page + 1} / {totalPages}
              </span>
              <button
                className="btn btn-sm rounded border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-1 hover:bg-[var(--color-surface-hover)] transition-colors disabled:opacity-40"
                onClick={() => fetchEntries(page + 1)}
                disabled={page >= totalPages - 1 || loading}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row subcomponent
// ---------------------------------------------------------------------------

function AuditRow({
  entry,
  isExpanded,
  onToggle,
}: {
  entry: AuditEntry;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className="border-t border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-hover)] cursor-pointer transition-colors"
        onClick={onToggle}
        data-testid="audit-row"
      >
        <td className="px-3 py-2 text-[var(--color-text-secondary)] tabular-nums">
          {formatTimestamp(entry.timestamp)}
        </td>
        <td className="px-3 py-2 font-medium text-[var(--color-text-primary)]">
          {entry.operator}
        </td>
        <td className="px-3 py-2 text-[var(--color-text-primary)]">
          {entry.action}
        </td>
        <td className="px-3 py-2 text-[var(--color-text-secondary)] truncate max-w-[300px]" title={entry.targetDn}>
          {formatDn(entry.targetDn)}
        </td>
        <td className="px-3 py-2 text-center">
          {entry.success ? (
            <CheckCircle
              size={16}
              className="inline-block text-[var(--color-success)]"
            />
          ) : (
            <XCircle
              size={16}
              className="inline-block text-[var(--color-error)]"
            />
          )}
        </td>
      </tr>
      {isExpanded && (
        <tr className="bg-[var(--color-surface-card)]">
          <td colSpan={5} className="px-4 py-3">
            <div className="flex flex-col gap-1.5 text-caption">
              <div>
                <span className="font-medium text-[var(--color-text-secondary)]">
                  Full Target DN:{" "}
                </span>
                <span className="text-[var(--color-text-primary)] select-all">
                  {entry.targetDn}
                </span>
              </div>
              <div>
                <span className="font-medium text-[var(--color-text-secondary)]">
                  Details:{" "}
                </span>
                <span className="text-[var(--color-text-primary)]">
                  {entry.details || "(none)"}
                </span>
              </div>
              <div>
                <span className="font-medium text-[var(--color-text-secondary)]">
                  Result:{" "}
                </span>
                <span
                  className={
                    entry.success
                      ? "text-[var(--color-success)]"
                      : "text-[var(--color-error)]"
                  }
                >
                  {entry.success ? "Success" : "Failure"}
                </span>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
