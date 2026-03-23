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
  Download,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  type PrivilegedAccountsReport,
  type PrivilegedAccountInfo,
} from "@/types/security";
import { extractErrorMessage } from "@/utils/errorMapping";
import { exportTableToCsv } from "@/utils/csvExport";

function AccountRow({
  account,
  isExpanded,
  onToggle,
}: {
  account: PrivilegedAccountInfo;
  isExpanded: boolean;
  onToggle: () => void;
}) {
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
            : "Never"}
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
            title={account.enabled ? "Enabled" : "Disabled"}
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
                <strong>DN:</strong> {account.distinguishedName}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-[var(--color-text-secondary)]">
                <span><strong>Pwd Never Expires:</strong> {account.passwordNeverExpires ? "Yes" : "No"}</span>
                <span><strong>Kerberoastable:</strong> {account.kerberoastable ? "Yes" : "No"}</span>
                <span><strong>AS-REP Roastable:</strong> {account.asrepRoastable ? "Yes" : "No"}</span>
                <span><strong>Protected Users:</strong> {account.inProtectedUsers ? "Yes" : "No"}</span>
                {account.reversibleEncryption && <span><strong>Reversible Encryption:</strong> Yes</span>}
                {account.desOnly && <span><strong>DES Only:</strong> Yes</span>}
                {account.constrainedDelegationTransition && <span><strong>Constrained Deleg+Transition:</strong> Yes</span>}
                {account.hasSidHistory && <span><strong>SIDHistory:</strong> Present</span>}
                {account.isServiceAccount && <span><strong>Service Account:</strong> Yes</span>}
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

  const handleExportCsv = async () => {
    if (!report) return;

    const columns = [
      { key: "samAccountName" as const, header: "Username" },
      { key: "displayName" as const, header: "Display Name" },
      { key: "privilegedGroups" as const, header: "Groups" },
      { key: "lastLogon" as const, header: "Last Logon" },
      { key: "passwordAgeDays" as const, header: "Password Age (days)" },
      { key: "enabled" as const, header: "Enabled" },
      { key: "passwordNeverExpires" as const, header: "Password Never Expires" },
      { key: "alerts" as const, header: "Alerts" },
    ];

    const exportData = report.accounts.map((a) => ({
      samAccountName: a.samAccountName,
      displayName: a.displayName,
      privilegedGroups: a.privilegedGroups.join("; "),
      lastLogon: a.lastLogon ?? "Never",
      passwordAgeDays: a.passwordAgeDays != null ? String(a.passwordAgeDays) : "-",
      enabled: a.enabled ? "Yes" : "No",
      passwordNeverExpires: a.passwordNeverExpires ? "Yes" : "No",
      alerts: a.alerts.map((al) => `[${al.severity}] ${al.message}`).join("; "),
    }));

    await exportTableToCsv(columns, exportData, "privileged-accounts.csv");
  };

  return (
    <div className="flex h-full flex-col" data-testid="security-dashboard">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-[var(--color-border-default)] px-4 py-2">
        <h2 className="text-body font-semibold text-[var(--color-text-primary)]">
          Privileged Accounts
        </h2>
        <div className="flex items-center gap-3">
          {/* Summary badges */}
          {report && (
            <div className="flex items-center gap-1.5 text-caption">
              {report.summary.critical > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-[var(--color-error-bg)] px-2 py-0.5 font-medium" style={{ color: "var(--color-error)" }}>
                  <AlertCircle size={12} /> {report.summary.critical} Critical
                </span>
              )}
              {report.summary.high > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-[var(--color-warning-bg)] px-2 py-0.5 font-medium" style={{ color: "var(--color-warning)" }}>
                  <AlertTriangle size={12} /> {report.summary.high} High
                </span>
              )}
              {report.summary.medium > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-[var(--color-info-bg)] px-2 py-0.5 font-medium" style={{ color: "var(--color-info)" }}>
                  <AlertTriangle size={12} /> {report.summary.medium} Medium
                </span>
              )}
              <span className="ml-1 text-[var(--color-text-secondary)]">
                · {report.accounts.length} accounts
              </span>
            </div>
          )}

          {/* Export CSV */}
          <button
            className="btn btn-sm rounded border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-2.5 py-1 text-caption font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors flex items-center gap-1"
            onClick={handleExportCsv}
            disabled={!report || report.accounts.length === 0}
            data-testid="export-csv-button"
          >
            <Download size={14} />
            CSV
          </button>

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
            Refresh
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && !report ? (
          <LoadingSpinner message="Scanning privileged accounts..." />
        ) : error ? (
          <EmptyState
            icon={<AlertCircle size={40} />}
            title="Scan Failed"
            description={error}
          />
        ) : !report || report.accounts.length === 0 ? (
          <EmptyState
            icon={<ShieldAlert size={40} />}
            title="No Privileged Accounts Found"
            description="No members were found in the default privileged groups."
          />
        ) : (
          <>
          <div className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)]">
            <table className="w-full text-caption" data-testid="privileged-accounts-table">
              <thead>
                <tr className="border-b border-[var(--color-border-default)] text-left text-[var(--color-text-secondary)]">
                  <th className="px-3 py-2 font-medium">Username</th>
                  <th className="px-3 py-2 font-medium">Display Name</th>
                  <th className="px-3 py-2 font-medium">Groups</th>
                  <th className="px-3 py-2 font-medium">Last Logon</th>
                  <th className="px-3 py-2 text-center font-medium">Pwd Age</th>
                  <th className="px-3 py-2 text-center font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Alerts</th>
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
              Last scanned: {new Date(report.scannedAt).toLocaleString()}
            </div>
          </div>

          {/* Domain-level findings */}
          {report.domainFindings && (
            <div className="mt-4 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-4" data-testid="domain-findings">
              <h3 className="mb-3 text-body font-semibold text-[var(--color-text-primary)]">
                Domain Security Findings
              </h3>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-caption">
                {report.domainFindings.krbtgtPasswordAgeDays != null && (
                  <div className="text-[var(--color-text-secondary)]">
                    <strong>KRBTGT Password Age:</strong>{" "}
                    <span style={{ color: report.domainFindings.krbtgtPasswordAgeDays > 180 ? "var(--color-error)" : "var(--color-success)" }}>
                      {report.domainFindings.krbtgtPasswordAgeDays} days
                    </span>
                  </div>
                )}
                {report.domainFindings.lapsCoveragePercent != null && (
                  <div className="text-[var(--color-text-secondary)]">
                    <strong>LAPS Coverage:</strong>{" "}
                    <span style={{ color: report.domainFindings.lapsCoveragePercent < 80 ? "var(--color-warning)" : "var(--color-success)" }}>
                      {report.domainFindings.lapsCoveragePercent.toFixed(0)}% ({report.domainFindings.lapsDeployedCount}/{report.domainFindings.totalComputerCount})
                    </span>
                  </div>
                )}
                {report.domainFindings.domainFunctionalLevel && (
                  <div className="text-[var(--color-text-secondary)]">
                    <strong>Domain Level:</strong> {report.domainFindings.domainFunctionalLevel}
                  </div>
                )}
                {report.domainFindings.psoCount > 0 && (
                  <div className="text-[var(--color-text-secondary)]">
                    <strong>Password Policies (PSO):</strong> {report.domainFindings.psoCount}
                  </div>
                )}
                {report.domainFindings.rbcdConfiguredCount > 0 && (
                  <div className="text-[var(--color-text-secondary)]">
                    <strong>RBCD Configured:</strong>{" "}
                    <span style={{ color: "var(--color-warning)" }}>{report.domainFindings.rbcdConfiguredCount} object(s)</span>
                  </div>
                )}
                {report.domainFindings.recycleBinEnabled != null && (
                  <div className="text-[var(--color-text-secondary)]">
                    <strong>Recycle Bin:</strong>{" "}
                    <span style={{ color: report.domainFindings.recycleBinEnabled ? "var(--color-success)" : "var(--color-warning)" }}>
                      {report.domainFindings.recycleBinEnabled ? "Enabled" : "Disabled"}
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
