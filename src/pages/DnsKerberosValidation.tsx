import { useState, useCallback, useEffect } from "react";
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
} from "lucide-react";
import {
  type DnsKerberosReport,
  type DnsRecordStatus,
  type ClockSkewStatus,
} from "@/types/dns-validation";
import { extractErrorMessage } from "@/utils/errorMapping";
import { ExportToolbar } from "@/components/common/ExportToolbar";
import { useTranslation } from "react-i18next";

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
  const icon = (() => {
    switch (status) {
      case "Pass":
        return <CheckCircle size={size} />;
      case "Warning":
        return <AlertTriangle size={size} />;
      case "Fail":
        return <AlertCircle size={size} />;
    }
  })();
  return (
    <span className="flex items-center justify-center" style={{ color: dnsStatusColor(status) }}>
      {icon}
    </span>
  );
}

function ClockStatusIcon({
  status,
  size = 16,
}: {
  status: ClockSkewStatus;
  size?: number;
}) {
  const icon = (() => {
    switch (status) {
      case "Ok":
        return <CheckCircle size={size} />;
      case "Warning":
        return <AlertTriangle size={size} />;
      case "Critical":
        return <AlertCircle size={size} />;
    }
  })();
  return (
    <span className="flex items-center justify-center" style={{ color: clockStatusColor(status) }}>
      {icon}
    </span>
  );
}

export function DnsKerberosValidation() {
  const { t } = useTranslation(["dnsKerberos", "common"]);
  const [report, setReport] = useState<DnsKerberosReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const runValidation = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await invoke<DnsKerberosReport>(
        "get_dns_kerberos_validation",
        { thresholdSeconds: 300 },
      );
      setReport(data);
    } catch (e: unknown) {
      setError(extractErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Run validation on mount
  useEffect(() => {
    runValidation();
  }, [runValidation]);

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
          {t("pageTitle")}
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-caption text-[var(--color-text-secondary)]">
            {t("kerberosThreshold")}
          </span>

          <ExportToolbar<{ type: string; name: string; status: string; details: string }>
            columns={[
              { key: "type", header: "Type" },
              { key: "name", header: "Record / DC" },
              { key: "status", header: "Status" },
              { key: "details", header: "Details" },
            ]}
            data={[
              ...(report?.dnsResults.map((d) => ({
                type: "DNS",
                name: d.recordName,
                status: d.status,
                details: `Expected: ${d.expectedHosts.join(", ")} | Actual: ${d.actualHosts.join(", ")}`,
              })) ?? []),
              ...(report?.clockSkewResults.map((c) => ({
                type: "Clock Skew",
                name: c.dcHostname,
                status: c.status,
                details: `${c.skewSeconds}s offset`,
              })) ?? []),
            ]}
            rowMapper={(r) => [r.type, r.name, r.status, r.details]}
            title="DNS & Kerberos Validation"
            filenameBase="dns-kerberos"
          />

          <button
            className="btn btn-sm flex items-center gap-1"
            onClick={runValidation}
            disabled={loading}
            data-testid="run-button"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            {report ? t("reRun") : t("runValidation")}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <LoadingSpinner message={t("running")} />
        ) : error ? (
          <EmptyState
            icon={<AlertCircle size={40} />}
            title={t("validationFailed")}
            description={error}
          />
        ) : !report ? (
          <EmptyState
            icon={<Globe size={40} />}
            title={t("emptyTitle")}
            description={t("emptyDescription")}
          />
        ) : (
          <div className="space-y-6">
            {/* Summary */}
            <div className="flex items-center gap-4 text-caption">
              <span className="flex items-center gap-1.5">
                <Globe size={14} /> {t("dns")}: {dnsPassCount} {t("pass")}
                {dnsFailCount > 0 && (
                  <span style={{ color: "var(--color-error)" }}>
                    , {dnsFailCount} {t("fail")}
                  </span>
                )}
              </span>
              <span className="flex items-center gap-1.5">
                <Clock size={14} /> {t("clock")}: {clockOkCount} {t("ok")}
                {clockWarnCount > 0 && (
                  <span style={{ color: "var(--color-warning)" }}>
                    , {clockWarnCount} {t("issues")}
                  </span>
                )}
              </span>
              <span className="text-[var(--color-text-secondary)]">
                {t("checked")}: {new Date(report.checkedAt).toLocaleTimeString()}
              </span>
            </div>

            {/* DNS Results */}
            <section>
              <h3 className="mb-3 text-body font-semibold text-[var(--color-text-primary)]">
                {t("dnsSrvRecords")}
              </h3>
              <div className="overflow-x-auto rounded-lg border border-[var(--color-border-default)]">
                <table
                  className="w-full text-caption"
                  data-testid="dns-results-table"
                >
                  <thead>
                    <tr className="border-b border-[var(--color-border-default)] bg-[var(--color-surface-card)] text-left text-[var(--color-text-secondary)]">
                      <th className="w-16 px-3 py-2.5 text-center font-medium">{t("common:status")}</th>
                      <th className="px-4 py-2.5 font-medium">{t("record")}</th>
                      <th className="px-4 py-2.5 font-medium">{t("expected")}</th>
                      <th className="px-4 py-2.5 font-medium">{t("actual")}</th>
                      <th className="px-4 py-2.5 font-medium">{t("issues")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.dnsResults.map((dns) => (
                      <tr
                        key={dns.recordName}
                        className="border-b border-[var(--color-border-subtle)] transition-colors hover:bg-[var(--color-surface-hover)]"
                      >
                        <td className="w-16 px-3 py-2.5 text-center">
                          <DnsStatusIcon status={dns.status} />
                        </td>
                        <td className="px-4 py-2.5 font-mono text-[var(--color-text-primary)]">
                          {dns.recordName}
                        </td>
                        <td className="px-4 py-2.5 text-[var(--color-text-secondary)]">
                          {dns.expectedHosts.join(", ") || "-"}
                        </td>
                        <td className="px-4 py-2.5 text-[var(--color-text-secondary)]">
                          {dns.actualHosts.join(", ") || "-"}
                        </td>
                        <td className="px-4 py-2.5">
                          {dns.missingHosts.length > 0 && (
                            <span style={{ color: "var(--color-error)" }}>
                              {t("missing")}: {dns.missingHosts.join(", ")}
                            </span>
                          )}
                          {dns.extraHosts.length > 0 && (
                            <span style={{ color: "var(--color-warning)" }}>
                              {t("extra")}: {dns.extraHosts.join(", ")}
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
              <h3 className="mb-3 text-body font-semibold text-[var(--color-text-primary)]">
                {t("kerberosClockSkew")}
              </h3>
              <div className="overflow-x-auto rounded-lg border border-[var(--color-border-default)]">
                <table
                  className="w-full text-caption"
                  data-testid="clock-skew-table"
                >
                  <thead>
                    <tr className="border-b border-[var(--color-border-default)] bg-[var(--color-surface-card)] text-left text-[var(--color-text-secondary)]">
                      <th className="w-16 px-3 py-2.5 text-center font-medium">{t("common:status")}</th>
                      <th className="px-4 py-2.5 font-medium">{t("dc")}</th>
                      <th className="px-4 py-2.5 font-medium">{t("dcTime")}</th>
                      <th className="w-24 px-4 py-2.5 font-medium">{t("skew")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.clockSkewResults.map((skew) => (
                      <tr
                        key={skew.dcHostname}
                        className="border-b border-[var(--color-border-subtle)] transition-colors hover:bg-[var(--color-surface-hover)]"
                      >
                        <td className="w-16 px-3 py-2.5 text-center">
                          <ClockStatusIcon status={skew.status} />
                        </td>
                        <td className="px-4 py-2.5 font-mono text-[var(--color-text-primary)]">
                          {skew.dcHostname}
                        </td>
                        <td className="px-4 py-2.5 text-[var(--color-text-secondary)]">
                          {(() => {
                            const d = new Date(skew.dcTime);
                            return isNaN(d.getTime())
                              ? skew.dcTime
                              : d.toLocaleTimeString();
                          })()}
                        </td>
                        <td className="w-24 px-4 py-2.5">
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
