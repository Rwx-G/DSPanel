import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { EmptyState } from "@/components/common/EmptyState";
import {
  RefreshCw,
  ShieldCheck,
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  type AttackDetectionReport,
  type AttackAlert,
  type AttackType,
  type AlertSeverity,
} from "@/types/security";
import { extractErrorMessage } from "@/utils/errorMapping";

const TIME_WINDOWS = [
  { label: "1h", value: 1 },
  { label: "6h", value: 6 },
  { label: "12h", value: 12 },
  { label: "24h", value: 24 },
  { label: "48h", value: 48 },
  { label: "72h", value: 72 },
];

function severityColor(severity: AlertSeverity): string {
  switch (severity) {
    case "Critical":
      return "var(--color-error)";
    case "High":
      return "var(--color-warning)";
    case "Medium":
      return "var(--color-caution, var(--color-warning))";
    case "Info":
      return "var(--color-info, var(--color-text-secondary))";
  }
}

function attackTypeLabel(type: AttackType): string {
  switch (type) {
    case "GoldenTicket":
      return "Golden Ticket";
    case "DCSync":
      return "DCSync";
    case "DCShadow":
      return "DCShadow";
    case "AbnormalKerberos":
      return "Abnormal Kerberos";
  }
}

function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium"
      style={{
        color: severityColor(severity),
        backgroundColor: `color-mix(in srgb, ${severityColor(severity)} 12%, transparent)`,
      }}
      data-testid={`severity-badge-${severity.toLowerCase()}`}
    >
      {severity === "Critical" && <AlertCircle size={10} />}
      {(severity === "High" || severity === "Medium") && <AlertTriangle size={10} />}
      {severity}
    </span>
  );
}

function AttackTypeBadge({ type }: { type: AttackType }) {
  return (
    <span
      className="inline-flex items-center rounded bg-[var(--color-surface-hover)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-text-primary)]"
      data-testid={`attack-type-badge-${type}`}
    >
      {attackTypeLabel(type)}
    </span>
  );
}

function AlertCard({
  alert,
  isExpanded,
  onToggle,
}: {
  alert: AttackAlert;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const borderColor = severityColor(alert.severity);

  return (
    <div
      className="rounded-lg border bg-[var(--color-surface-card)] transition-shadow hover:shadow-md"
      style={{ borderColor, borderWidth: "2px" }}
      data-testid={`alert-card-${alert.attackType}-${alert.timestamp}`}
    >
      <button
        className="flex w-full items-center gap-3 p-3 text-left"
        onClick={onToggle}
        data-testid="alert-card-toggle"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <AttackTypeBadge type={alert.attackType} />
            <SeverityBadge severity={alert.severity} />
            {alert.eventId != null && (
              <span className="text-[10px] font-mono text-[var(--color-text-secondary)]">
                Event {alert.eventId}
              </span>
            )}
          </div>
          <div className="mt-1 text-caption text-[var(--color-text-primary)]">
            {alert.description}
          </div>
          <div className="mt-0.5 flex items-center gap-3 text-[10px] text-[var(--color-text-secondary)]">
            <span>Source: {alert.source}</span>
            <span>{new Date(alert.timestamp).toLocaleString()}</span>
          </div>
        </div>

        {isExpanded ? (
          <ChevronDown size={16} className="shrink-0 text-[var(--color-text-secondary)]" />
        ) : (
          <ChevronRight size={16} className="shrink-0 text-[var(--color-text-secondary)]" />
        )}
      </button>

      {isExpanded && (
        <div
          className="border-t border-[var(--color-border-default)] px-4 py-3"
          data-testid="alert-card-detail"
        >
          <div className="text-caption font-medium text-[var(--color-text-primary)]">
            Recommendation
          </div>
          <p className="mt-1 text-caption text-[var(--color-text-secondary)]">
            {alert.recommendation}
          </p>
        </div>
      )}
    </div>
  );
}

export function AttackDetection() {
  const [report, setReport] = useState<AttackDetectionReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeWindowHours, setTimeWindowHours] = useState(24);
  const [expandedAlerts, setExpandedAlerts] = useState<Set<string>>(new Set());

  const fetchReport = useCallback(
    async (hours: number) => {
      try {
        setError(null);
        const data = await invoke<AttackDetectionReport>("detect_ad_attacks", {
          timeWindowHours: hours,
        });
        setReport(data);
      } catch (e: unknown) {
        setError(extractErrorMessage(e));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    fetchReport(timeWindowHours);
  }, [fetchReport, timeWindowHours]);

  const handleScan = () => {
    setLoading(true);
    fetchReport(timeWindowHours);
  };

  const handleTimeWindowChange = (hours: number) => {
    setTimeWindowHours(hours);
    setLoading(true);
  };

  const handleToggleAlert = (key: string) => {
    setExpandedAlerts((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const alertKey = (alert: AttackAlert, index: number) =>
    `${alert.attackType}-${alert.timestamp}-${index}`;

  // Severity counts
  const criticalCount = report?.alerts.filter((a) => a.severity === "Critical").length ?? 0;
  const highCount = report?.alerts.filter((a) => a.severity === "High").length ?? 0;
  const mediumCount = report?.alerts.filter((a) => a.severity === "Medium").length ?? 0;

  return (
    <div className="flex h-full flex-col" data-testid="attack-detection">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-[var(--color-border-default)] px-4 py-2">
        <h2 className="text-body font-semibold text-[var(--color-text-primary)]">
          Attack Detection
        </h2>
        <div className="flex items-center gap-3">
          {/* Summary badges */}
          {report && report.alerts.length > 0 && (
            <div className="flex items-center gap-2 text-caption" data-testid="alert-summary">
              {criticalCount > 0 && (
                <span className="flex items-center gap-1" style={{ color: "var(--color-error)" }}>
                  <AlertCircle size={12} /> {criticalCount} Critical
                </span>
              )}
              {highCount > 0 && (
                <span className="flex items-center gap-1" style={{ color: "var(--color-warning)" }}>
                  <AlertTriangle size={12} /> {highCount} High
                </span>
              )}
              {mediumCount > 0 && (
                <span className="flex items-center gap-1" style={{ color: "var(--color-text-secondary)" }}>
                  <AlertTriangle size={12} /> {mediumCount} Medium
                </span>
              )}
            </div>
          )}

          {/* Time window selector */}
          <select
            className="rounded border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-2 py-1 text-caption text-[var(--color-text-primary)]"
            value={timeWindowHours}
            onChange={(e) => handleTimeWindowChange(Number(e.target.value))}
            data-testid="time-window-select"
          >
            {TIME_WINDOWS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          {/* Scan button */}
          <button
            className="btn btn-sm rounded border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-2.5 py-1 text-caption font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors flex items-center gap-1"
            onClick={handleScan}
            disabled={loading}
            data-testid="scan-button"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Scan
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && !report ? (
          <LoadingSpinner message="Scanning event logs..." />
        ) : error ? (
          <EmptyState
            icon={<AlertCircle size={40} />}
            title="Detection Failed"
            description={error}
          />
        ) : !report || report.alerts.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck size={40} />}
            title="No Attack Indicators Found"
            description={`No suspicious activity detected in the last ${timeWindowHours} hours.`}
          />
        ) : (
          <div className="flex flex-col gap-3">
            {report.alerts.map((alert, index) => {
              const key = alertKey(alert, index);
              return (
                <AlertCard
                  key={key}
                  alert={alert}
                  isExpanded={expandedAlerts.has(key)}
                  onToggle={() => handleToggleAlert(key)}
                />
              );
            })}
            <div className="text-[10px] text-[var(--color-text-secondary)]">
              Last scanned: {new Date(report.scannedAt).toLocaleString()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
