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
  MapPin,
} from "lucide-react";
import { ExportToolbar } from "@/components/common/ExportToolbar";
import {
  type DcHealthResult,
  type DcHealthCheck,
  type DcHealthLevel,
} from "@/types/dc-health";
import { extractErrorMessage } from "@/utils/errorMapping";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation(["infrastructureHealth", "common"]);
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
            {t("site")}: {result.dc.siteName}
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
              title={`${t(`checkNames.${check.name}`, { defaultValue: check.name })}: ${check.message}`}
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
          <table className="w-full text-caption" style={{ tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "120px" }} />
              <col style={{ width: "60px" }} />
              <col />
              <col style={{ width: "280px" }} />
            </colgroup>
            <thead>
              <tr className="text-left text-[var(--color-text-secondary)]">
                <th className="pb-2 font-medium">{t("check")}</th>
                <th className="pb-2 font-medium">{t("common:status")}</th>
                <th className="pb-2 font-medium">{t("common:details")}</th>
                <th className="pb-2 font-medium">{t("common:value")}</th>
              </tr>
            </thead>
            <tbody>
              {result.checks.map((check) => (
                <CheckRow key={check.name} check={check} />
              ))}
            </tbody>
          </table>
          <div className="mt-2 text-[10px] text-[var(--color-text-secondary)]">
            {t("lastChecked")}: {new Date(result.checkedAt).toLocaleTimeString()}
          </div>
        </div>
      )}
    </div>
  );
}

/** Translate a DC health check message using pattern matching on the English text. */
function useTranslateCheckMessage() {
  const { t } = useTranslation("infrastructureHealth");
  return (msg: string): string => {
    const patterns: [RegExp, string, (m: RegExpMatchArray) => Record<string, string>][] = [
      [/^Resolved via AD DNS to (.+)$/, "checkMsg.dnsResolved", (m) => ({ ip: m[1] })],
      [/^No SRV records/, "checkMsg.dnsNoRecords", () => ({})],
      [/^DNS resolution failed/, "checkMsg.dnsFailed", () => ({})],
      [/^LDAP response: (\d+)ms$/, "checkMsg.ldapResponse", (m) => ({ ms: m[1] })],
      [/^LDAP response slow: (\d+)ms$/, "checkMsg.ldapSlow", (m) => ({ ms: m[1] })],
      [/^LDAP response very slow: (\d+)ms$/, "checkMsg.ldapVerySlow", (m) => ({ ms: m[1] })],
      [/^LDAP connection failed/, "checkMsg.ldapFailed", () => ({})],
      [/^All services registered: (.+)$/, "checkMsg.servicesAll", (m) => ({ list: m[1] })],
      [/^Missing services: (.+)$/, "checkMsg.servicesMissing", (m) => ({ list: m[1] })],
      [/^Service check failed/, "checkMsg.servicesFailed", () => ({})],
      [/^(\d+) inbound replication link/, "checkMsg.replLinks", (m) => ({ count: m[1] })],
      [/^No inbound replication/, "checkMsg.replNone", () => ({})],
      [/^Replication check failed/, "checkMsg.replFailed", () => ({})],
      [/^DFSR enabled, SMB reachable \((.+)\)$/, "checkMsg.sysvolOk", (m) => ({ state: m[1] })],
      [/^DFSR enabled but SMB port 445 unreachable \((.+)\)$/, "checkMsg.sysvolSmbFail", (m) => ({ state: m[1] })],
      [/^SYSVOL check failed/, "checkMsg.sysvolFailed", () => ({})],
      [/^(\d+)s skew - exceeds/, "checkMsg.clockCritical", (m) => ({ seconds: m[1] })],
      [/^(\d+)s skew \(Kerberos/, "checkMsg.clockWarn", (m) => ({ seconds: m[1] })],
      [/^(\d+)s skew$/, "checkMsg.clockOk", (m) => ({ seconds: m[1] })],
      [/^Clock skew check failed/, "checkMsg.clockFailed", () => ({})],
      [/^Machine account OK \((.+)\)$/, "checkMsg.accountOk", (m) => ({ info: m[1] })],
      [/^Machine account: (.+)$/, "checkMsg.accountWarn", (m) => ({ issues: m[1] })],
      [/^Machine account check failed/, "checkMsg.accountFailed", () => ({})],
    ];
    for (const [re, key, extract] of patterns) {
      const m = msg.match(re);
      if (m) return t(key, extract(m));
    }
    return msg; // fallback: return original
  };
}

function CheckRow({ check }: { check: DcHealthCheck }) {
  const { t } = useTranslation("infrastructureHealth");
  const translateMsg = useTranslateCheckMessage();
  const translatedName = t(`checkNames.${check.name}`, { defaultValue: check.name });
  const translatedMsg = translateMsg(check.message);
  return (
    <tr className="border-t border-[var(--color-border-subtle)]">
      <td className="py-2 pr-4">
        <div className="flex items-center gap-2 text-[var(--color-text-primary)]">
          {checkIcon(check.name)}
          {translatedName}
        </div>
      </td>
      <td className="py-2 pr-4 text-center">
        <span className="flex items-center justify-center">
          <StatusIcon level={check.status} size={14} />
        </span>
      </td>
      <td className="truncate py-2 pr-4 text-[var(--color-text-secondary)]" title={translatedMsg}>
        {translatedMsg}
      </td>
      <td className="truncate py-2 font-mono text-[var(--color-text-secondary)]" title={check.value ?? "-"}>
        {check.value ?? "-"}
      </td>
    </tr>
  );
}

export function InfrastructureHealth() {
  const { t } = useTranslation(["infrastructureHealth", "common"]);

  const REFRESH_INTERVALS = [
    { label: t("autoRefresh1m"), value: 60 },
    { label: t("autoRefresh5m"), value: 300 },
    { label: t("autoRefresh15m"), value: 900 },
    { label: t("autoRefreshOff"), value: 0 },
  ];

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
          {t("pageTitle")}
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

          <ExportToolbar<{ dc: string; site: string; status: string; check: string; checkStatus: string; message: string }>
            columns={[
              { key: "dc", header: t("exportDc") },
              { key: "site", header: t("site") },
              { key: "status", header: t("exportOverall") },
              { key: "check", header: t("check") },
              { key: "checkStatus", header: t("exportCheckStatus") },
              { key: "message", header: t("exportMessage") },
            ]}
            data={(() => {
              let lastDc = "";
              return results.flatMap((r) =>
                r.checks.map((c) => {
                  const isFirst = r.dc.hostname !== lastDc;
                  if (isFirst) lastDc = r.dc.hostname;
                  return {
                    dc: isFirst ? r.dc.hostname : "",
                    site: isFirst ? r.dc.siteName : "",
                    status: isFirst ? r.overallStatus : "",
                    check: c.name,
                    checkStatus: c.status,
                    message: c.message,
                  };
                }),
              );
            })()}
            rowMapper={(r) => [r.dc, r.site, r.status, r.check, r.checkStatus, r.message]}
            title={t("exportTitle")}
            filenameBase="dc-health"
          />

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
            {t("common:refresh")}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && results.length === 0 ? (
          <LoadingSpinner message={t("checkingDcs")} />
        ) : error ? (
          <EmptyState
            icon={<AlertCircle size={40} />}
            title={t("healthCheckFailed")}
            description={error}
          />
        ) : results.length === 0 ? (
          <EmptyState
            icon={<Server size={40} />}
            title={t("noDcsFound")}
            description={t("noDcsDescription")}
          />
        ) : (
          <div className="flex flex-col gap-6">
            {Object.entries(
              results.reduce<Record<string, DcHealthResult[]>>((groups, result) => {
                const site = result.dc.siteName || "Unknown Site";
                (groups[site] ??= []).push(result);
                return groups;
              }, {}),
            ).map(([site, dcs]) => (
              <div key={site}>
                <div className="mb-2 flex items-center gap-2">
                  <MapPin size={14} className="text-[var(--color-primary)]" />
                  <h3 className="text-body font-semibold text-[var(--color-text-primary)]">
                    {site}
                  </h3>
                  <span className="text-caption text-[var(--color-text-secondary)]">
                    ({dcs.length} DC{dcs.length > 1 ? "s" : ""})
                  </span>
                </div>
                <div className="flex flex-col gap-4">
                  {dcs.map((result) => (
                    <DcHealthCard
                      key={result.dc.hostname}
                      result={result}
                      isExpanded={!collapsedDcs.has(result.dc.hostname)}
                      onToggle={() => handleToggleDc(result.dc.hostname)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
