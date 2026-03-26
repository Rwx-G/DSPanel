import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import {
  Cpu,
  MemoryStick,
  HardDrive,
  Server,
  Users,
  RefreshCw,
  Pause,
  Play,
  AlertCircle,
  Filter,
} from "lucide-react";
import { type SystemMetrics } from "@/types/system-metrics";
import { extractErrorMessage } from "@/utils/errorMapping";

interface WorkstationMonitoringPanelProps {
  hostname: string;
}

const REFRESH_INTERVALS = [
  { label: "5s", value: 5 },
  { label: "10s", value: 10 },
  { label: "30s", value: 30 },
];

function ProgressBar({
  value,
  max = 100,
  color,
}: {
  value: number;
  max?: number;
  color: string;
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-border-default)]">
      <div
        className="h-full rounded-full transition-all duration-300"
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
    </div>
  );
}

function usageColor(percent: number): string {
  if (percent < 60) return "var(--color-success)";
  if (percent < 85) return "var(--color-warning)";
  return "var(--color-error)";
}

export function WorkstationMonitoringPanel({
  hostname,
}: WorkstationMonitoringPanelProps) {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshInterval, setRefreshInterval] = useState(5);
  const [paused, setPaused] = useState(false);
  const [autoStartOnly, setAutoStartOnly] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMetrics = useCallback(async () => {
    try {
      setError(null);
      const data = await invoke<SystemMetrics>("get_workstation_metrics", {
        hostname,
      });
      if (data.errorMessage) {
        setError(data.errorMessage);
      }
      setMetrics(data);
    } catch (e: unknown) {
      const msg = extractErrorMessage(e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [hostname]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (!paused && refreshInterval > 0) {
      timerRef.current = setInterval(fetchMetrics, refreshInterval * 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [refreshInterval, paused, fetchMetrics]);

  const memoryPercent = metrics
    ? metrics.totalMemoryMb > 0
      ? (metrics.usedMemoryMb / metrics.totalMemoryMb) * 100
      : 0
    : 0;

  return (
    <div
      className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)]"
      data-testid="workstation-monitoring"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--color-border-default)] px-3 py-2">
        <h3 className="text-body font-semibold text-[var(--color-text-primary)]">
          Monitoring: {hostname}
        </h3>
        <div className="flex items-center gap-2">
          <select
            className="rounded border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-1.5 py-0.5 text-caption text-[var(--color-text-primary)]"
            value={refreshInterval}
            onChange={(e) => setRefreshInterval(Number(e.target.value))}
            data-testid="monitor-refresh-interval"
          >
            {REFRESH_INTERVALS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <button
            className="btn btn-sm p-1"
            onClick={() => setPaused(!paused)}
            title={paused ? "Resume" : "Pause"}
            data-testid="monitor-pause"
          >
            {paused ? <Play size={14} /> : <Pause size={14} />}
          </button>
          <button
            className="btn btn-sm p-1"
            onClick={() => {
              setLoading(true);
              fetchMetrics();
            }}
            disabled={loading}
            data-testid="monitor-refresh"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-3">
        {loading && !metrics ? (
          <LoadingSpinner message="Connecting to workstation..." />
        ) : error && !metrics ? (
          <div className="flex items-center gap-2 text-caption text-[var(--color-error)]">
            <AlertCircle size={16} />
            <span data-testid="monitor-error">{error}</span>
          </div>
        ) : metrics ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {/* CPU */}
            <div className="space-y-1" data-testid="cpu-section">
              <div className="flex items-center gap-1.5 text-caption font-medium text-[var(--color-text-primary)]">
                <Cpu size={14} /> CPU
              </div>
              <ProgressBar
                value={metrics.cpuUsagePercent}
                color={usageColor(metrics.cpuUsagePercent)}
              />
              <span className="text-caption text-[var(--color-text-secondary)]">
                {Math.round(metrics.cpuUsagePercent)}%
              </span>
            </div>

            {/* Memory */}
            <div className="space-y-1" data-testid="memory-section">
              <div className="flex items-center gap-1.5 text-caption font-medium text-[var(--color-text-primary)]">
                <MemoryStick size={14} /> Memory
              </div>
              <ProgressBar
                value={memoryPercent}
                color={usageColor(memoryPercent)}
              />
              <span className="text-caption text-[var(--color-text-secondary)]">
                {Math.round(metrics.usedMemoryMb / 1024 * 10) / 10}GB /{" "}
                {Math.round(metrics.totalMemoryMb / 1024 * 10) / 10}GB (
                {Math.round(memoryPercent)}%)
              </span>
            </div>

            {/* Disks */}
            <div className="space-y-1" data-testid="disk-section">
              <div className="flex items-center gap-1.5 text-caption font-medium text-[var(--color-text-primary)]">
                <HardDrive size={14} /> Disks
              </div>
              {metrics.disks.length > 0 ? (
                metrics.disks.map((disk) => (
                  <div key={disk.deviceId} className="space-y-0.5">
                    <div className="flex items-center justify-between text-caption text-[var(--color-text-secondary)]">
                      <span>{disk.deviceId}</span>
                      <span>
                        {disk.freeGb.toFixed(1)}GB free /{" "}
                        {disk.totalGb.toFixed(1)}GB
                      </span>
                    </div>
                    <ProgressBar
                      value={disk.usedPercent}
                      color={usageColor(disk.usedPercent)}
                    />
                  </div>
                ))
              ) : (
                <span className="text-caption text-[var(--color-text-secondary)]">
                  Unavailable
                </span>
              )}
            </div>

            {/* Sessions */}
            <div className="space-y-1" data-testid="sessions-section">
              <div className="flex items-center gap-1.5 text-caption font-medium text-[var(--color-text-primary)]">
                <Users size={14} /> Sessions ({metrics.sessions.length})
              </div>
              {metrics.sessions.length > 0 ? (
                <ul className="space-y-0.5 text-caption text-[var(--color-text-secondary)]">
                  {metrics.sessions.map((s, i) => (
                    <li key={i}>{s.username}</li>
                  ))}
                </ul>
              ) : (
                <span className="text-caption text-[var(--color-text-secondary)]">
                  No active sessions
                </span>
              )}
            </div>

            {/* Services */}
            <div
              className="space-y-1 sm:col-span-2 lg:col-span-2"
              data-testid="services-section"
            >
              <div className="flex items-center gap-1.5 text-caption font-medium text-[var(--color-text-primary)]">
                <Server size={14} /> Services ({metrics.services.length})
                <button
                  onClick={() => setAutoStartOnly(!autoStartOnly)}
                  className={`ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                    autoStartOnly
                      ? "bg-[var(--color-primary)] text-white"
                      : "bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]"
                  }`}
                  title="Show only auto-start services"
                  data-testid="filter-auto-start"
                >
                  <Filter size={10} /> Auto-start
                </button>
              </div>
              {metrics.services.length > 0 ? (
                <div className="max-h-32 overflow-y-auto">
                  <table className="w-full text-caption">
                    <tbody>
                      {metrics.services
                        .filter((svc) => !autoStartOnly || svc.startMode === "Auto")
                        .map((svc) => (
                        <tr
                          key={svc.name}
                          className="border-b border-[var(--color-border-subtle)]"
                        >
                          <td className="py-0.5 text-[var(--color-text-primary)]">
                            {svc.displayName || svc.name}
                          </td>
                          <td className="py-0.5">
                            <span
                              style={{
                                color:
                                  svc.state === "Running"
                                    ? "var(--color-success)"
                                    : "var(--color-error)",
                              }}
                            >
                              {svc.state}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <span className="text-caption text-[var(--color-text-secondary)]">
                  Unavailable
                </span>
              )}
            </div>
          </div>
        ) : null}

        {/* Error banner when partial data */}
        {error && metrics && (
          <div className="mt-2 rounded border border-[var(--color-warning)] bg-[color-mix(in_srgb,var(--color-warning)_10%,transparent)] px-2 py-1 text-caption text-[var(--color-warning)]">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
