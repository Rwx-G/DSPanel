import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { EmptyState } from "@/components/common/EmptyState";
import {
  RefreshCw,
  AlertCircle,
  CheckCircle,
  AlertTriangle,
  Globe,
  Clock,
  Download,
} from "lucide-react";
import {
  type DnsKerberosReport,
  type DnsRecordStatus,
  type ClockSkewStatus,
} from "@/types/dns-validation";

function dnsStatusColor(status: DnsRecordStatus): string {
  switch (status) {
    case "Pass":
      return "var(--color-success)";
    case "Warning":
      return "var(--color-warning)";
    case "Fail":
      return "var(--color-error)";
  }
}

function clockStatusColor(status: ClockSkewStatus): string {
  switch (status) {
    case "Ok":
      return "var(--color-success)";
    case "Warning":
      return "var(--color-warning)";
    case "Critical":
      return "var(--color-error)";
  }
}

function DnsStatusIcon({
  status,
  size = 16,
}: {
  status: DnsRecordStatus;
  size?: number;
}) {
  switch (status) {
    case "Pass":
      return (
        <CheckCircle size={size} style={{ color: dnsStatusColor(status) }} />
      );
    case "Warning":
      return (
        <AlertTriangle size={size} style={{ color: dnsStatusColor(status) }} />
      );
    case "Fail":
      return (
        <AlertCircle size={size} style={{ color: dnsStatusColor(status) }} />
      );
  }
}

function ClockStatusIcon({
  status,
  size = 16,
}: {
  status: ClockSkewStatus;
  size?: number;
}) {
  switch (status) {
    case "Ok":
      return (
        <CheckCircle size={size} style={{ color: clockStatusColor(status) }} />
      );
    case "Warning":
      return (
        <AlertTriangle
          size={size}
          style={{ color: clockStatusColor(status) }}
        />
      );
    case "Critical":
      return (
        <AlertCircle size={size} style={{ color: clockStatusColor(status) }} />
      );
  }
}

export function DnsKerberosValidation() {
  const [report, setReport] = useState<DnsKerberosReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(300);

  const runValidation = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await invoke<DnsKerberosReport>(
        "get_dns_kerberos_validation",
        { thresholdSeconds: threshold },
      );
      setReport(data);
    } catch (e: unknown) {
      const msg =
        typeof e === "string"
          ? e
          : (e as { message?: string })?.message ?? "Validation failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [threshold]);

  const exportCsv = useCallback(() => {
    if (!report) return;

    const lines = ["Type,Record/DC,Status,Details"];

    for (const dns of report.dnsResults) {
      const details = `Expected: ${dns.expectedHosts.join(";")} | Actual: ${dns.actualHosts.join(";")}`;
      lines.push(
        `DNS,"${dns.recordName}",${dns.status},"${details.replace(/"/g, '""')}"`,
      );
    }

    for (const skew of report.clockSkewResults) {
      lines.push(
        `Clock Skew,"${skew.dcHostname}",${skew.status},"${skew.skewSeconds}s offset"`,
      );
    }

    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `dns-kerberos-validation-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [report]);

  const dnsPassCount =
    report?.dnsResults.filter((r) => r.status === "Pass").length ?? 0;
  const dnsFailCount =
    report?.dnsResults.filter((r) => r.status === "Fail").length ?? 0;
  const clockOkCount =
    report?.clockSkewResults.filter((r) => r.status === "Ok").length ?? 0;
  const clockWarnCount =
    report?.clockSkewResults.filter(
      (r) => r.status === "Warning" || r.status === "Critical",
    ).length ?? 0;

  return (
    <div
      className="flex h-full flex-col"
      data-testid="dns-kerberos-validation"
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-[var(--color-border-default)] px-4 py-2">
        <h2 className="text-body font-semibold text-[var(--color-text-primary)]">
          DNS & Kerberos Validation
        </h2>
        <div className="flex items-center gap-3">
          {/* Clock skew threshold */}
          <label className="flex items-center gap-1.5 text-caption text-[var(--color-text-secondary)]">
            Skew threshold:
            <select
              className="rounded border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-2 py-1 text-caption text-[var(--color-text-primary)]"
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              data-testid="threshold-select"
            >
              <option value={60}>1 min</option>
              <option value={120}>2 min</option>
              <option value={300}>5 min</option>
              <option value={600}>10 min</option>
            </select>
          </label>

          {report && (
            <button
              className="btn btn-sm flex items-center gap-1"
              onClick={exportCsv}
              data-testid="export-button"
            >
              <Download size={14} />
              Export CSV
            </button>
          )}

          <button
            className="btn btn-sm flex items-center gap-1"
            onClick={runValidation}
            disabled={loading}
            data-testid="run-button"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            {report ? "Re-run" : "Run Validation"}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <LoadingSpinner message="Running DNS and Kerberos validation..." />
        ) : error ? (
          <EmptyState
            icon={<AlertCircle size={40} />}
            title="Validation Failed"
            description={error}
          />
        ) : !report ? (
          <EmptyState
            icon={<Globe size={40} />}
            title="DNS & Kerberos Validation"
            description="Click 'Run Validation' to check DNS SRV records and Kerberos clock skew."
          />
        ) : (
          <div className="space-y-6">
            {/* Summary */}
            <div className="flex items-center gap-4 text-caption">
              <span className="flex items-center gap-1.5">
                <Globe size={14} /> DNS: {dnsPassCount} pass
                {dnsFailCount > 0 && (
                  <span style={{ color: "var(--color-error)" }}>
                    , {dnsFailCount} fail
                  </span>
                )}
              </span>
              <span className="flex items-center gap-1.5">
                <Clock size={14} /> Clock: {clockOkCount} ok
                {clockWarnCount > 0 && (
                  <span style={{ color: "var(--color-warning)" }}>
                    , {clockWarnCount} issues
                  </span>
                )}
              </span>
              <span className="text-[var(--color-text-secondary)]">
                Checked: {new Date(report.checkedAt).toLocaleTimeString()}
              </span>
            </div>

            {/* DNS Results */}
            <section>
              <h3 className="mb-2 text-body font-semibold text-[var(--color-text-primary)]">
                DNS SRV Records
              </h3>
              <div className="overflow-x-auto rounded-lg border border-[var(--color-border-default)]">
                <table
                  className="w-full text-caption"
                  data-testid="dns-results-table"
                >
                  <thead>
                    <tr className="border-b border-[var(--color-border-default)] bg-[var(--color-surface-card)] text-left text-[var(--color-text-secondary)]">
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Record</th>
                      <th className="px-3 py-2 font-medium">Expected</th>
                      <th className="px-3 py-2 font-medium">Actual</th>
                      <th className="px-3 py-2 font-medium">Issues</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.dnsResults.map((dns) => (
                      <tr
                        key={dns.recordName}
                        className="border-b border-[var(--color-border-subtle)]"
                      >
                        <td className="px-3 py-2">
                          <DnsStatusIcon status={dns.status} />
                        </td>
                        <td className="px-3 py-2 font-mono text-[var(--color-text-primary)]">
                          {dns.recordName}
                        </td>
                        <td className="px-3 py-2 text-[var(--color-text-secondary)]">
                          {dns.expectedHosts.join(", ") || "-"}
                        </td>
                        <td className="px-3 py-2 text-[var(--color-text-secondary)]">
                          {dns.actualHosts.join(", ") || "-"}
                        </td>
                        <td className="px-3 py-2">
                          {dns.missingHosts.length > 0 && (
                            <span
                              className="text-caption"
                              style={{ color: "var(--color-error)" }}
                            >
                              Missing: {dns.missingHosts.join(", ")}
                            </span>
                          )}
                          {dns.extraHosts.length > 0 && (
                            <span
                              className="text-caption"
                              style={{ color: "var(--color-warning)" }}
                            >
                              Extra: {dns.extraHosts.join(", ")}
                            </span>
                          )}
                          {dns.missingHosts.length === 0 &&
                            dns.extraHosts.length === 0 && (
                              <span className="text-[var(--color-text-secondary)]">
                                -
                              </span>
                            )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Clock Skew Results */}
            <section>
              <h3 className="mb-2 text-body font-semibold text-[var(--color-text-primary)]">
                Kerberos Clock Skew
              </h3>
              <div className="overflow-x-auto rounded-lg border border-[var(--color-border-default)]">
                <table
                  className="w-full text-caption"
                  data-testid="clock-skew-table"
                >
                  <thead>
                    <tr className="border-b border-[var(--color-border-default)] bg-[var(--color-surface-card)] text-left text-[var(--color-text-secondary)]">
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Domain Controller</th>
                      <th className="px-3 py-2 font-medium">DC Time</th>
                      <th className="px-3 py-2 font-medium">Skew</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.clockSkewResults.map((skew) => (
                      <tr
                        key={skew.dcHostname}
                        className="border-b border-[var(--color-border-subtle)]"
                      >
                        <td className="px-3 py-2">
                          <ClockStatusIcon status={skew.status} />
                        </td>
                        <td className="px-3 py-2 font-mono text-[var(--color-text-primary)]">
                          {skew.dcHostname}
                        </td>
                        <td className="px-3 py-2 text-[var(--color-text-secondary)]">
                          {new Date(skew.dcTime).toLocaleTimeString()}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className="font-medium"
                            style={{ color: clockStatusColor(skew.status) }}
                          >
                            {Math.abs(skew.skewSeconds)}s
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
