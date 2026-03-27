import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { EmptyState } from "@/components/common/EmptyState";
import { AlertBadge } from "@/components/common/AlertBadge";
import {
  RefreshCw,
  ShieldAlert,
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  type PrivilegedAccountsReport,
  type PrivilegedAccountInfo,
} from "@/types/security";
import { extractErrorMessage } from "@/utils/errorMapping";
import { SecurityDisclaimer } from "@/components/common/SecurityDisclaimer";
import { ExportToolbar } from "@/components/common/ExportToolbar";
import { useTranslation } from "react-i18next";

function AccountRow({
  account,
  isExpanded,
  onToggle,
}: {
  account: PrivilegedAccountInfo;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation(["securityDashboard", "common"]);
  const hasAlerts = account.alerts.length > 0;

  return (
    <>
      <tr
        className="border-t border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-hover)] cursor-pointer transition-colors"
        onClick={onToggle}
        data-testid={`account-row-${account.samAccountName}`}
      >
        <td className="px-3 py-2">
          <div className="flex items-center gap-1.5">
            {isExpanded ? (
              <ChevronDown size={14} className="shrink-0 text-[var(--color-text-secondary)]" />
            ) : (
              <ChevronRight size={14} className="shrink-0 text-[var(--color-text-secondary)]" />
            )}
            <span className="font-medium text-[var(--color-text-primary)]">
              {account.samAccountName}
            </span>
          </div>
        </td>
        <td className="px-3 py-2 text-[var(--color-text-secondary)]">
          {account.displayName}
        </td>
        <td className="px-3 py-2 text-[var(--color-text-secondary)]">
          {account.privilegedGroups.join(", ")}
        </td>
        <td className="px-3 py-2 text-[var(--color-text-secondary)]">
          {account.lastLogon
            ? new Date(account.lastLogon).toLocaleDateString()
            : t("common:never")}
        </td>
        <td className="px-3 py-2 text-center text-[var(--color-text-secondary)]">
          {account.passwordAgeDays != null ? `${account.passwordAgeDays}d` : "-"}
        </td>
        <td className="px-3 py-2 text-center">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{
              backgroundColor: account.enabled
                ? "var(--color-success)"
                : "var(--color-error)",
            }}
            title={account.enabled ? t("common:enabled") : t("common:disabled")}
          />
        </td>
        <td className="px-3 py-2">
          <AlertBadge alerts={account.alerts} compact={!hasAlerts} />
        </td>
      </tr>
      {isExpanded && (
        <tr className="bg-[var(--color-surface-card)]">
          <td colSpan={7} className="px-6 py-3">
            <div className="space-y-2">
              <div className="text-caption text-[var(--color-text-secondary)]">
                <strong>{t("dn")}</strong> {account.distinguishedName}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-[var(--color-text-secondary)]">
                <span><strong>{t("pwdNeverExpires")}</strong> {account.passwordNeverExpires ? t("common:yes") : t("common:no")}</span>
                <span><strong>{t("kerberoastable")}</strong> {account.kerberoastable ? t("common:yes") : t("common:no")}</span>
                <span><strong>{t("asRepRoastable")}</strong> {account.asrepRoastable ? t("common:yes") : t("common:no")}</span>
                <span><strong>{t("protectedUsers")}</strong> {account.inProtectedUsers ? t("common:yes") : t("common:no")}</span>
                {account.reversibleEncryption && <span><strong>{t("reversibleEncryption")}</strong> {t("common:yes")}</span>}
                {account.desOnly && <span><strong>{t("desOnly")}</strong> {t("common:yes")}</span>}
                {account.constrainedDelegationTransition && <span><strong>{t("constrainedDelegTransition")}</strong> {t("common:yes")}</span>}
                {account.hasSidHistory && <span><strong>{t("sidHistory")}</strong> {t("common:present")}</span>}
                {account.isServiceAccount && <span><strong>{t("serviceAccount")}</strong> {t("common:yes")}</span>}
              </div>
              {account.alerts.length > 0 && (
                <div className="mt-2">
                  <AlertBadge alerts={account.alerts} />
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function SecurityDashboard() {
  const { t } = useTranslation(["securityDashboard", "common"]);
  const [report, setReport] = useState<PrivilegedAccountsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());

  const fetchReport = useCallback(async () => {
    try {
      setError(null);
      const data = await invoke<PrivilegedAccountsReport>("get_privileged_accounts");
      setReport(data);
    } catch (e: unknown) {
      setError(extractErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const handleToggleAccount = (dn: string) => {
    setExpandedAccounts((prev) => {
      const next = new Set(prev);
      if (next.has(dn)) {
        next.delete(dn);
      } else {
        next.add(dn);
      }
      return next;
    });
  };

  return (
    <div className="flex h-full flex-col" data-testid="security-dashboard">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-[var(--color-border-default)] px-4 py-2">
        <h2 className="flex items-center gap-1.5 text-body font-semibold text-[var(--color-text-primary)]">
          {t("privilegedAccounts")}
          <SecurityDisclaimer
            coverage="~35%"
            checks={t("disclaimer.checks")}
            limitations={t("disclaimer.limitations")}
            tools={t("disclaimer.tools")}
          />
        </h2>
        <div className="flex items-center gap-3">
          {/* Summary badges */}
          {report && (
            <div className="flex items-center gap-1.5 text-caption">
              {report.summary.critical > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-[var(--color-error-bg)] px-2 py-0.5 font-medium" style={{ color: "var(--color-error)" }}>
                  <AlertCircle size={12} /> {report.summary.critical} {t("common:critical")}
                </span>
              )}
              {report.summary.high > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-[var(--color-warning-bg)] px-2 py-0.5 font-medium" style={{ color: "var(--color-warning)" }}>
                  <AlertTriangle size={12} /> {report.summary.high} {t("common:high")}
                </span>
              )}
              {report.summary.medium > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-[var(--color-info-bg)] px-2 py-0.5 font-medium" style={{ color: "var(--color-info)" }}>
                  <AlertTriangle size={12} /> {report.summary.medium} {t("common:medium")}
                </span>
              )}
              <span className="ml-1 text-[var(--color-text-secondary)]">
                · {report.accounts.length} {t("accounts")}
              </span>
            </div>
          )}

          {/* Export */}
          <ExportToolbar<PrivilegedAccountInfo>
            columns={[
              { key: "samAccountName", header: t("username") },
              { key: "displayName", header: t("common:displayName") },
              { key: "groups", header: t("groups") },
              { key: "lastLogon", header: t("common:lastLogon") },
              { key: "passwordAge", header: t("passwordAge") },
              { key: "enabled", header: t("common:enabled") },
            ]}
            data={report?.accounts ?? []}
            rowMapper={(a) => [
              a.samAccountName,
              a.displayName ?? "",
              a.privilegedGroups.join(", "),
              a.lastLogon ?? t("common:never"),
              a.passwordAgeDays != null ? `${a.passwordAgeDays}d` : "-",
              String(a.enabled),
            ]}
            title={t("exportTitle")}
            filenameBase="privileged-accounts"
          />

          {/* Manual refresh */}
          <button
            className="btn btn-sm flex items-center gap-1"
            onClick={() => {
              setLoading(true);
              fetchReport();
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
        {loading && !report ? (
          <LoadingSpinner message={t("scanningPrivileged")} />
        ) : error ? (
          <EmptyState
            icon={<AlertCircle size={40} />}
            title={t("scanFailed")}
            description={error}
          />
        ) : !report || report.accounts.length === 0 ? (
          <EmptyState
            icon={<ShieldAlert size={40} />}
            title={t("noPrivilegedFound")}
            description={t("noMembersInGroups")}
          />
        ) : (
          <>
          <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)]">
            <table className="w-full text-caption" data-testid="privileged-accounts-table">
              <thead>
                <tr className="border-b border-[var(--color-border-default)] text-left text-[var(--color-text-secondary)]">
                  <th className="px-3 py-2 font-medium">{t("username")}</th>
                  <th className="px-3 py-2 font-medium">{t("common:displayName")}</th>
                  <th className="px-3 py-2 font-medium">{t("groups")}</th>
                  <th className="px-3 py-2 font-medium">{t("common:lastLogon")}</th>
                  <th className="px-3 py-2 text-center font-medium">{t("pwdAge")}</th>
                  <th className="px-3 py-2 text-center font-medium">{t("common:status")}</th>
                  <th className="px-3 py-2 font-medium">{t("alerts")}</th>
                </tr>
              </thead>
              <tbody>
                {report.accounts.map((account) => (
                  <AccountRow
                    key={account.distinguishedName}
                    account={account}
                    isExpanded={expandedAccounts.has(account.distinguishedName)}
                    onToggle={() => handleToggleAccount(account.distinguishedName)}
                  />
                ))}
              </tbody>
            </table>
            <div className="border-t border-[var(--color-border-default)] px-3 py-2 text-[10px] text-[var(--color-text-secondary)]">
              {t("lastScanned")} {new Date(report.scannedAt).toLocaleString()}
            </div>
          </div>

          {/* Domain-level findings */}
          {report.domainFindings && (
            <div className="mt-4 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-4" data-testid="domain-findings">
              <h3 className="mb-3 text-body font-semibold text-[var(--color-text-primary)]">
                {t("domainSecurityFindings")}
              </h3>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-caption">
                {report.domainFindings.krbtgtPasswordAgeDays != null && (
                  <div className="text-[var(--color-text-secondary)]">
                    <strong>{t("krbtgtPasswordAge")}</strong>{" "}
                    <span style={{ color: report.domainFindings.krbtgtPasswordAgeDays > 180 ? "var(--color-error)" : "var(--color-success)" }}>
                      {report.domainFindings.krbtgtPasswordAgeDays} {t("days")}
                    </span>
                  </div>
                )}
                {report.domainFindings.lapsCoveragePercent != null && (
                  <div className="text-[var(--color-text-secondary)]">
                    <strong>{t("lapsCoverage")}</strong>{" "}
                    <span style={{ color: report.domainFindings.lapsCoveragePercent < 80 ? "var(--color-warning)" : "var(--color-success)" }}>
                      {report.domainFindings.lapsCoveragePercent.toFixed(0)}% ({report.domainFindings.lapsDeployedCount}/{report.domainFindings.totalComputerCount})
                    </span>
                  </div>
                )}
                {report.domainFindings.domainFunctionalLevel && (
                  <div className="text-[var(--color-text-secondary)]">
                    <strong>{t("domainLevel")}</strong> {report.domainFindings.domainFunctionalLevel}
                  </div>
                )}
                {report.domainFindings.psoCount > 0 && (
                  <div className="text-[var(--color-text-secondary)]">
                    <strong>{t("passwordPolicies")}</strong> {report.domainFindings.psoCount}
                  </div>
                )}
                {report.domainFindings.rbcdConfiguredCount > 0 && (
                  <div className="text-[var(--color-text-secondary)]">
                    <strong>{t("rbcdConfigured")}</strong>{" "}
                    <span style={{ color: "var(--color-warning)" }}>{report.domainFindings.rbcdConfiguredCount} {t("objects")}</span>
                  </div>
                )}
                {report.domainFindings.recycleBinEnabled != null && (
                  <div className="text-[var(--color-text-secondary)]">
                    <strong>{t("recycleBin")}</strong>{" "}
                    <span style={{ color: report.domainFindings.recycleBinEnabled ? "var(--color-success)" : "var(--color-warning)" }}>
                      {report.domainFindings.recycleBinEnabled ? t("common:enabled") : t("common:disabled")}
                    </span>
                  </div>
                )}
              </div>
              {report.domainFindings.alerts.length > 0 && (
                <div className="mt-3">
                  <AlertBadge alerts={report.domainFindings.alerts} />
                </div>
              )}
            </div>
          )}
          </>
        )}
      </div>
    </div>
  );
}
