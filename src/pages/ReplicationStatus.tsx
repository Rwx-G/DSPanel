import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { EmptyState } from "@/components/common/EmptyState";
import { extractErrorMessage } from "@/utils/errorMapping";
import { useDialog } from "@/contexts/DialogContext";
import { useNotifications } from "@/contexts/NotificationContext";
import {
  RefreshCw,
  AlertCircle,
  CheckCircle,
  AlertTriangle,
  HelpCircle,
  Play,
  Server,
  Info,
} from "lucide-react";
import { ExportToolbar } from "@/components/common/ExportToolbar";
import {
  type ReplicationPartnership,
  type ReplicationPartnershipStatus,
} from "@/types/replication-status";

const REFRESH_INTERVALS = [
  { label: "60s", value: 60 },
  { label: "120s", value: 120 },
  { label: "300s", value: 300 },
  { label: "Off", value: 0 },
];

function statusColor(status: ReplicationPartnershipStatus): string {
  switch (status) {
    case "Healthy":
      return "var(--color-success)";
    case "Warning":
      return "var(--color-warning)";
    case "Failed":
      return "var(--color-error)";
    default:
      return "var(--color-text-secondary)";
  }
}

function StatusIcon({
  status,
  size = 16,
}: {
  status: ReplicationPartnershipStatus;
  size?: number;
}) {
  switch (status) {
    case "Healthy":
      return <CheckCircle size={size} style={{ color: statusColor(status) }} />;
    case "Warning":
      return (
        <AlertTriangle size={size} style={{ color: statusColor(status) }} />
      );
    case "Failed":
      return <AlertCircle size={size} style={{ color: statusColor(status) }} />;
    default:
      return <HelpCircle size={size} style={{ color: statusColor(status) }} />;
  }
}

/** Parses AD generalized time (20260323120000.0Z) or ISO 8601 to Date. */
function parseAdTime(value: string): Date | null {
  // Try ISO 8601 first
  const d = new Date(value);
  if (!isNaN(d.getTime())) return d;
  // AD generalized time: 20260323120000.0Z
  const clean = value.replace(/\.0Z$/, "");
  if (clean.length >= 14) {
    const iso = `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}T${clean.slice(8, 10)}:${clean.slice(10, 12)}:${clean.slice(12, 14)}Z`;
    const parsed = new Date(iso);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function formatLatency(lastSyncTime: string | null): string {
  if (!lastSyncTime) return "N/A";
  const syncDate = parseAdTime(lastSyncTime);
  if (!syncDate) return "N/A";
  const elapsed = Date.now() - syncDate.getTime();
  if (elapsed < 0) return "just now";
  const seconds = Math.floor(elapsed / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function latencyColor(lastSyncTime: string | null): string {
  if (!lastSyncTime) return "var(--color-text-secondary)";
  const syncDate = parseAdTime(lastSyncTime);
  if (!syncDate) return "var(--color-text-secondary)";
  const elapsed = Date.now() - syncDate.getTime();
  const minutes = elapsed / 60_000;
  if (minutes < 15) return "var(--color-success)";
  if (minutes < 60) return "var(--color-warning)";
  return "var(--color-error)";
}

export function ReplicationStatus() {
  const [partnerships, setPartnerships] = useState<ReplicationPartnership[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshInterval, setRefreshInterval] = useState(120);
  const [forcingReplication, setForcingReplication] = useState<string | null>(
    null,
  );
  const [platform, setPlatform] = useState<string>("unknown");
  const [simpleBind, setSimpleBind] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { showConfirmation } = useDialog();
  const { notify } = useNotifications();

  useEffect(() => {
    invoke<string>("get_platform").then(setPlatform).catch(() => {});
    invoke<boolean>("is_simple_bind").then(setSimpleBind).catch(() => {});
  }, []);

  const fetchPartnerships = useCallback(async () => {
    try {
      setError(null);
      const data =
        await invoke<ReplicationPartnership[]>("get_replication_status");
      setPartnerships(data);
    } catch (e: unknown) {
      setError(extractErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPartnerships();
  }, [fetchPartnerships]);

  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (refreshInterval > 0) {
      timerRef.current = setInterval(fetchPartnerships, refreshInterval * 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [refreshInterval, fetchPartnerships]);

  const handleForceReplication = async (p: ReplicationPartnership) => {
    const confirmed = await showConfirmation(
      "Force Replication",
      `Force replication from ${p.sourceDc} to ${p.targetDc} for ${p.namingContext}?`,
    );
    if (!confirmed) return;

    const key = `${p.sourceDc}->${p.targetDc}`;
    setForcingReplication(key);
    try {
      const result = await invoke<string>("force_replication_cmd", {
        sourceDc: p.sourceDc,
        targetDc: p.targetDc,
        namingContext: p.namingContext,
      });
      notify(result, "success");
      fetchPartnerships();
    } catch (e: unknown) {
      notify(extractErrorMessage(e), "error");
    } finally {
      setForcingReplication(null);
    }
  };

  const failedCount = partnerships.filter((p) => p.status === "Failed").length;
  const warningCount = partnerships.filter(
    (p) => p.status === "Warning",
  ).length;
  const healthyCount = partnerships.filter(
    (p) => p.status === "Healthy",
  ).length;

  return (
    <div
      className="flex h-full flex-col"
      data-testid="replication-status-view"
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-[var(--color-border-default)] px-4 py-2">
        <h2 className="text-body font-semibold text-[var(--color-text-primary)]">
          AD Replication Status
        </h2>
        <div className="flex items-center gap-3">
          {partnerships.length > 0 && (
            <div className="flex items-center gap-2 text-caption">
              <span
                className="flex items-center gap-1"
                style={{ color: "var(--color-success)" }}
              >
                <CheckCircle size={12} /> {healthyCount}
              </span>
              {warningCount > 0 && (
                <span
                  className="flex items-center gap-1"
                  style={{ color: "var(--color-warning)" }}
                >
                  <AlertTriangle size={12} /> {warningCount}
                </span>
              )}
              {failedCount > 0 && (
                <span
                  className="flex items-center gap-1"
                  style={{ color: "var(--color-error)" }}
                >
                  <AlertCircle size={12} /> {failedCount}
                </span>
              )}
            </div>
          )}

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

          <ExportToolbar<ReplicationPartnership>
            columns={[
              { key: "sourceDc", header: "Source DC" },
              { key: "targetDc", header: "Target DC" },
              { key: "namingContext", header: "Naming Context" },
              { key: "status", header: "Status" },
              { key: "lastSyncTime", header: "Last Sync" },
              { key: "consecutiveFailures", header: "Failures" },
            ]}
            data={partnerships}
            rowMapper={(p) => [
              p.sourceDc,
              p.targetDc,
              p.namingContext,
              p.status,
              p.lastSyncTime ?? "Never",
              String(p.consecutiveFailures),
            ]}
            title="AD Replication Status"
            filenameBase="replication-status"
          />

          <button
            className="btn btn-sm flex items-center gap-1"
            onClick={() => {
              setLoading(true);
              fetchPartnerships();
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
        {loading && partnerships.length === 0 ? (
          <LoadingSpinner message="Loading replication partnerships..." />
        ) : error ? (
          <EmptyState
            icon={<AlertCircle size={40} />}
            title="Replication Check Failed"
            description={error}
          />
        ) : partnerships.length === 0 ? (
          <EmptyState
            icon={<Server size={40} />}
            title="No Replication Partnerships Found"
            description="No NTDS Connection objects were found in the AD configuration."
          />
        ) : (
          <>
          {simpleBind && platform === "windows" && (
            <div
              className="mb-3 flex items-start gap-2 rounded-md border border-[var(--color-info)] bg-[var(--color-info-bg)] px-3 py-2"
              data-testid="simple-bind-info"
            >
              <Info size={14} className="mt-0.5 shrink-0 text-[var(--color-info)]" />
              <p className="text-caption text-[var(--color-text-primary)]">
                Force replication is not available in simple bind mode.
                This feature requires a domain-joined machine with GSSAPI authentication
                to execute replication commands on domain controllers.
              </p>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-body" data-testid="replication-table">
              <thead>
                <tr className="border-b border-[var(--color-border-default)] text-left text-caption text-[var(--color-text-secondary)]">
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Source DC</th>
                  <th className="px-3 py-2 font-medium">Target DC</th>
                  <th className="px-3 py-2 font-medium">Naming Context</th>
                  <th className="px-3 py-2 font-medium">Last Sync</th>
                  <th className="px-3 py-2 font-medium">Errors</th>
                  {platform === "windows" && (
                    <th className="px-3 py-2 font-medium">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {partnerships.map((p, i) => {
                  const key = `${p.sourceDc}->${p.targetDc}-${i}`;
                  const forceKey = `${p.sourceDc}->${p.targetDc}`;
                  return (
                    <tr
                      key={key}
                      className="border-b border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-hover)]"
                      style={
                        p.status === "Failed"
                          ? {
                              backgroundColor:
                                "color-mix(in srgb, var(--color-error) 8%, transparent)",
                            }
                          : undefined
                      }
                      data-testid={`replication-row-${i}`}
                    >
                      <td className="px-3 py-2">
                        <StatusIcon status={p.status} />
                      </td>
                      <td className="px-3 py-2 font-mono text-caption text-[var(--color-text-primary)]">
                        {p.sourceDc}
                      </td>
                      <td className="px-3 py-2 font-mono text-caption text-[var(--color-text-primary)]">
                        {p.targetDc}
                      </td>
                      <td className="px-3 py-2 font-mono text-caption text-[var(--color-text-secondary)]">
                        {p.namingContext}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className="text-caption font-medium"
                          style={{ color: latencyColor(p.lastSyncTime) }}
                        >
                          {formatLatency(p.lastSyncTime)}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {p.consecutiveFailures > 0 ? (
                          <span
                            className="text-caption font-medium"
                            style={{ color: "var(--color-error)" }}
                            title={p.lastSyncMessage ?? undefined}
                          >
                            {p.consecutiveFailures} failures
                          </span>
                        ) : (
                          <span className="text-caption text-[var(--color-text-secondary)]">
                            -
                          </span>
                        )}
                      </td>
                      {platform === "windows" && (
                      <td className="px-3 py-2">
                        <button
                          className="btn btn-sm flex items-center gap-1 rounded border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-2.5 py-1 text-caption font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          onClick={() => handleForceReplication(p)}
                          disabled={forcingReplication === forceKey || simpleBind}
                          title={simpleBind ? "Force replication is not available in simple bind mode" : "Force replication"}
                          data-testid={`force-repl-${i}`}
                        >
                          <Play size={12} />
                          {forcingReplication === forceKey
                            ? "Syncing..."
                            : "Sync"}
                        </button>
                      </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>
    </div>
  );
}
