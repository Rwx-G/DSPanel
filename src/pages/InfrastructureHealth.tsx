import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { EmptyState } from "@/components/common/EmptyState";
import {
  RefreshCw,
  Server,
  Shield,
  Globe,
  Activity,
  FolderSync,
  Clock,
  ChevronRight,
  ChevronDown,
  AlertCircle,
  CheckCircle,
  AlertTriangle,
  HelpCircle,
} from "lucide-react";
import {
  type DcHealthResult,
  type DcHealthCheck,
  type DcHealthLevel,
} from "@/types/dc-health";
import { extractErrorMessage } from "@/utils/errorMapping";

const REFRESH_INTERVALS = [
  { label: "1 min", value: 60 },
  { label: "5 min", value: 300 },
  { label: "15 min", value: 900 },
  { label: "Off", value: 0 },
];

function statusColor(level: DcHealthLevel): string {
  switch (level) {
    case "Healthy":
      return "var(--color-success)";
    case "Warning":
      return "var(--color-warning)";
    case "Critical":
      return "var(--color-error)";
    default:
      return "var(--color-text-secondary)";
  }
}

function StatusIcon({
  level,
  size = 16,
}: {
  level: DcHealthLevel;
  size?: number;
}) {
  switch (level) {
    case "Healthy":
      return <CheckCircle size={size} style={{ color: statusColor(level) }} />;
    case "Warning":
      return (
        <AlertTriangle size={size} style={{ color: statusColor(level) }} />
      );
    case "Critical":
      return <AlertCircle size={size} style={{ color: statusColor(level) }} />;
    default:
      return <HelpCircle size={size} style={{ color: statusColor(level) }} />;
  }
}

function checkIcon(name: string, size = 14) {
  switch (name) {
    case "DNS":
      return <Globe size={size} className="shrink-0" />;
    case "LDAP":
      return <Activity size={size} className="shrink-0" />;
    case "Services":
      return <Server size={size} className="shrink-0" />;
    case "Replication":
      return <RefreshCw size={size} className="shrink-0" />;
    case "SYSVOL":
      return <FolderSync size={size} className="shrink-0" />;
    case "Clock":
      return <Clock size={size} className="shrink-0" />;
    case "Account":
      return <Shield size={size} className="shrink-0" />;
    default:
      return <Shield size={size} className="shrink-0" />;
  }
}

function DcHealthCard({
  result,
  isExpanded,
  onToggle,
}: {
  result: DcHealthResult;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const borderColor = statusColor(result.overallStatus);

  return (
    <div
      className="rounded-lg border bg-[var(--color-surface-card)] transition-shadow hover:shadow-md"
      style={{ borderColor, borderWidth: "2px" }}
      data-testid={`dc-card-${result.dc.hostname}`}
    >
      {/* Card header */}
      <button
        className="flex w-full items-center gap-3 p-3 text-left"
        onClick={onToggle}
        data-testid={`dc-card-toggle-${result.dc.hostname}`}
      >
        <StatusIcon level={result.overallStatus} size={20} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-body font-semibold text-[var(--color-text-primary)]">
              {result.dc.hostname}
            </span>
            {result.dc.isGlobalCatalog && (
              <span className="rounded bg-[var(--color-primary)] px-1.5 py-0.5 text-[10px] font-medium text-white">
                GC
              </span>
            )}
            {result.dc.fsmoRoles.map((role) => (
              <span
                key={role}
                className="rounded bg-[var(--color-text-secondary)] px-1.5 py-0.5 text-[10px] font-medium text-white"
              >
                {role}
              </span>
            ))}
          </div>
          <span className="text-caption text-[var(--color-text-secondary)]">
            Site: {result.dc.siteName}
            {result.dc.functionalLevel && (
              <> - {result.dc.functionalLevel}</>
            )}
          </span>
        </div>

        {/* Summary badges */}
        <div className="flex items-center gap-1">
          {result.checks.map((check) => (
            <span
              key={check.name}
              className="flex h-5 w-5 items-center justify-center rounded-full"
              style={{ color: statusColor(check.status) }}
              title={`${check.name}: ${check.message}`}
            >
              {checkIcon(check.name, 12)}
            </span>
          ))}
        </div>

        {isExpanded ? (
          <ChevronDown size={16} className="shrink-0 text-[var(--color-text-secondary)]" />
        ) : (
          <ChevronRight size={16} className="shrink-0 text-[var(--color-text-secondary)]" />
        )}
      </button>

      {/* Expanded detail panel */}
      {isExpanded && (
        <div
          className="border-t border-[var(--color-border-default)] px-4 py-3"
          data-testid={`dc-detail-${result.dc.hostname}`}
        >
          <table className="w-full text-caption">
            <thead>
              <tr className="text-left text-[var(--color-text-secondary)]">
                <th className="pb-2 pr-6 font-medium">Check</th>
                <th className="pb-2 pr-6 font-medium">Status</th>
                <th className="pb-2 pr-6 font-medium">Details</th>
                <th className="pb-2 font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
              {result.checks.map((check) => (
                <CheckRow key={check.name} check={check} />
              ))}
            </tbody>
          </table>
          <div className="mt-2 text-[10px] text-[var(--color-text-secondary)]">
            Last checked: {new Date(result.checkedAt).toLocaleTimeString()}
          </div>
        </div>
      )}
    </div>
  );
}

function CheckRow({ check }: { check: DcHealthCheck }) {
  return (
    <tr className="border-t border-[var(--color-border-subtle)]">
      <td className="py-2 pr-6">
        <div className="flex items-center gap-2 text-[var(--color-text-primary)]">
          {checkIcon(check.name)}
          {check.name}
        </div>
      </td>
      <td className="py-2 pr-6">
        <StatusIcon level={check.status} size={14} />
      </td>
      <td className="py-2 pr-6 text-[var(--color-text-secondary)]">
        {check.message}
      </td>
      <td className="py-2 font-mono text-[var(--color-text-secondary)]">
        {check.value ?? "-"}
      </td>
    </tr>
  );
}

export function InfrastructureHealth() {
  const [results, setResults] = useState<DcHealthResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshInterval, setRefreshInterval] = useState(300);
  const [collapsedDcs, setCollapsedDcs] = useState<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchHealth = useCallback(async () => {
    try {
      setError(null);
      const data = await invoke<DcHealthResult[]>("get_dc_health");
      setResults(data);
    } catch (e: unknown) {
      setError(extractErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  // Auto-refresh
  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (refreshInterval > 0) {
      timerRef.current = setInterval(fetchHealth, refreshInterval * 1000);
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [refreshInterval, fetchHealth]);

  const handleToggleDc = (hostname: string) => {
    setCollapsedDcs((prev) => {
      const next = new Set(prev);
      if (next.has(hostname)) {
        next.delete(hostname);
      } else {
        next.add(hostname);
      }
      return next;
    });
  };

  const healthySummary = results.filter(
    (r) => r.overallStatus === "Healthy",
  ).length;
  const warningSummary = results.filter(
    (r) => r.overallStatus === "Warning",
  ).length;
  const criticalSummary = results.filter(
    (r) => r.overallStatus === "Critical",
  ).length;

  return (
    <div className="flex h-full flex-col" data-testid="infrastructure-health">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-[var(--color-border-default)] px-4 py-2">
        <h2 className="text-body font-semibold text-[var(--color-text-primary)]">
          Infrastructure Health
        </h2>
        <div className="flex items-center gap-3">
          {/* Summary badges */}
          {results.length > 0 && (
            <div className="flex items-center gap-2 text-caption">
              <span className="flex items-center gap-1" style={{ color: "var(--color-success)" }}>
                <CheckCircle size={12} /> {healthySummary}
              </span>
              {warningSummary > 0 && (
                <span className="flex items-center gap-1" style={{ color: "var(--color-warning)" }}>
                  <AlertTriangle size={12} /> {warningSummary}
                </span>
              )}
              {criticalSummary > 0 && (
                <span className="flex items-center gap-1" style={{ color: "var(--color-error)" }}>
                  <AlertCircle size={12} /> {criticalSummary}
                </span>
              )}
            </div>
          )}

          {/* Refresh interval selector */}
          <select
            className="rounded border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-2 py-1 text-caption text-[var(--color-text-primary)]"
            value={refreshInterval}
            onChange={(e) => setRefreshInterval(Number(e.target.value))}
            data-testid="refresh-interval"
          >
            {REFRESH_INTERVALS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          {/* Manual refresh */}
          <button
            className="btn btn-sm flex items-center gap-1"
            onClick={() => {
              setLoading(true);
              fetchHealth();
            }}
            disabled={loading}
            data-testid="refresh-button"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && results.length === 0 ? (
          <LoadingSpinner message="Checking domain controllers..." />
        ) : error ? (
          <EmptyState
            icon={<AlertCircle size={40} />}
            title="Health Check Failed"
            description={error}
          />
        ) : results.length === 0 ? (
          <EmptyState
            icon={<Server size={40} />}
            title="No Domain Controllers Found"
            description="No domain controllers were discovered in the AD configuration."
          />
        ) : (
          <div className="flex flex-col gap-4">
            {results.map((result) => (
              <DcHealthCard
                key={result.dc.hostname}
                result={result}
                isExpanded={!collapsedDcs.has(result.dc.hostname)}
                onToggle={() => handleToggleDc(result.dc.hostname)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
