import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { EmptyState } from "@/components/common/EmptyState";
import { ExportToolbar } from "@/components/common/ExportToolbar";
import { SecurityDisclaimer } from "@/components/common/SecurityDisclaimer";
import { extractErrorMessage } from "@/utils/errorMapping";
import { useTranslation } from "react-i18next";
import {
  Play,
  AlertTriangle,
  CheckCircle,
  Shield,
  Download,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FrameworkMapping {
  standard: string;
  controlRef: string;
}

interface CheckResult {
  checkId: string;
  title: string;
  description: string;
  severity: string;
  findingCount: number;
  headers: string[];
  rows: string[][];
  frameworks: FrameworkMapping[];
  remediation: string;
}

interface FrameworkScore {
  standard: string;
  score: number;
  totalChecks: number;
  checksWithFindings: number;
  controlRefs: string[];
}

interface ComplianceScanResult {
  scannedAt: string;
  generator: string;
  totalAccountsScanned: number;
  globalScore: number;
  totalFindings: number;
  frameworkScores: FrameworkScore[];
  checks: CheckResult[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FRAMEWORK_COLORS: Record<string, string> = {
  GDPR: "#1565c0",
  HIPAA: "#2e7d32",
  SOX: "#e65100",
  "PCI-DSS v4.0": "#6a1b9a",
  "ISO 27001": "#00695c",
  "NIST 800-53": "#283593",
  "CIS v8": "#bf360c",
  NIS2: "#0d47a1",
  ANSSI: "#c62828",
};

function scoreColor(score: number): string {
  if (score >= 80) return "var(--color-success)";
  if (score >= 50) return "var(--color-warning)";
  return "var(--color-error)";
}

function sevColor(severity: string): string {
  switch (severity) {
    case "Critical": return "var(--color-error)";
    case "High": return "#e65100";
    case "Medium": return "#f9a825";
    default: return "#546e7a";
  }
}

// ---------------------------------------------------------------------------
// Framework Score Card
// ---------------------------------------------------------------------------

function FrameworkCard({
  fw,
  onExport,
}: {
  fw: FrameworkScore;
  onExport: () => void;
}) {
  const { t } = useTranslation(["complianceReports"]);
  const color = FRAMEWORK_COLORS[fw.standard] ?? "#546e7a";
  return (
    <div
      className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-3 flex flex-col gap-1"
      data-testid={`fw-card-${fw.standard}`}
    >
      <div className="flex items-center justify-between">
        <span
          className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold text-white"
          style={{ backgroundColor: color }}
        >
          {fw.standard}
        </span>
        <span className="text-lg font-bold" style={{ color: scoreColor(fw.score) }}>
          {fw.score}
        </span>
      </div>
      <div className="text-[10px] text-[var(--color-text-secondary)]">
        {fw.totalChecks} {t("checks")} - {fw.checksWithFindings} {t("findingsLabel")}
      </div>
      <button
        className="self-end mt-1 flex items-center gap-1 text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
        onClick={onExport}
        data-testid={`export-fw-${fw.standard}`}
      >
        <Download size={10} />
        {t("common:export")} {fw.standard} {t("report")}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Check Row (expandable)
// ---------------------------------------------------------------------------

function CheckRow({ check }: { check: CheckResult }) {
  const { t } = useTranslation(["complianceReports"]);
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="border-t border-[var(--color-border-subtle)]"
      data-testid={`check-${check.checkId}`}
    >
      <button
        className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-[var(--color-surface-hover)] transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="flex-1 text-caption font-medium text-[var(--color-text-primary)]">
          {t(`checkTitles.${check.checkId}`, { defaultValue: check.title })}
        </span>
        <span className="text-caption font-bold" style={{ color: check.findingCount > 0 ? sevColor(check.severity) : "var(--color-success)" }}>
          {check.findingCount}
        </span>
        {check.findingCount > 0 && (
          <span
            className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
            style={{ backgroundColor: sevColor(check.severity) }}
          >
            {t(`severityLabels.${check.severity}`, { defaultValue: check.severity })}
          </span>
        )}
        {check.findingCount === 0 && (
          <span className="inline-flex items-center gap-1 text-[10px] text-[var(--color-success)]">
            <CheckCircle size={10} /> {t("checkClear")}
          </span>
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          <p className="text-[11px] leading-relaxed text-[var(--color-text-secondary)]">
            {check.description}
          </p>

          {/* Framework chips */}
          <div className="flex flex-wrap gap-1">
            {check.frameworks.map((f) => (
              <span
                key={`${f.standard}-${f.controlRef}`}
                className="inline-flex items-center rounded bg-[var(--color-surface-hover)] px-1.5 py-0.5 text-[9px] text-[var(--color-text-secondary)]"
              >
                <span className="font-semibold mr-1" style={{ color: FRAMEWORK_COLORS[f.standard] ?? "#546e7a" }}>
                  {f.standard}
                </span>
                {f.controlRef}
              </span>
            ))}
          </div>

          {/* Data table (first 30 rows) */}
          {check.findingCount > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-caption">
                <thead>
                  <tr className="border-b border-[var(--color-border-default)] text-left text-[var(--color-text-secondary)]">
                    {check.headers.map((h) => (
                      <th key={h} className="px-2 py-1.5 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {check.rows.slice(0, 30).map((row, ri) => (
                    <tr key={ri} className="border-t border-[var(--color-border-subtle)]">
                      {row.map((cell, ci) => (
                        <td key={ci} className="px-2 py-1 text-[var(--color-text-primary)]">{cell || "-"}</td>
                      ))}
                    </tr>
                  ))}
                  {check.rows.length > 30 && (
                    <tr>
                      <td colSpan={check.headers.length} className="px-2 py-1 text-center text-[var(--color-text-secondary)] italic">
                        {t("andMore", { count: check.rows.length - 30 })}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Remediation */}
          <div className="whitespace-pre-line text-[11px] leading-relaxed text-[var(--color-text-secondary)] bg-[var(--color-surface-card)] rounded p-2 font-mono">
            {check.remediation}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function ComplianceReports() {
  const { t } = useTranslation(["complianceReports", "common"]);
  const [scan, setScan] = useState<ComplianceScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleScan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<ComplianceScanResult>("run_compliance_scan");
      setScan(result);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const handleExportFramework = async (framework: string) => {
    if (!scan) return;
    try {
      const date = new Date().toISOString().slice(0, 10);
      const safeName = framework.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();
      await invoke("export_compliance_framework_report", {
        scan,
        framework,
        defaultName: `${safeName}-compliance-report_${date}.html`,
      });
    } catch (err) {
      console.error("Export failed:", err);
    }
  };

  return (
    <div className="flex h-full flex-col" data-testid="compliance-reports">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-[var(--color-border-default)] px-4 py-2">
        <h2 className="flex items-center gap-1.5 text-body font-semibold text-[var(--color-text-primary)]">
          <Shield size={16} />
          {t("pageTitle")}
          <SecurityDisclaimer
            coverage="~15-20%"
            checks={t("disclaimer.checks")}
            limitations={t("disclaimer.limitations")}
            tools={t("disclaimer.tools")}
          />
        </h2>
        <div className="flex items-center gap-2">
          {scan && (
            <ExportToolbar<CheckResult>
              columns={[
                { key: "title", header: t("check") },
                { key: "severity", header: t("severity") },
                { key: "findingCount", header: t("findings") },
                { key: "description", header: t("description") },
                { key: "remediation", header: t("remediation") },
              ]}
              data={scan.checks}
              rowMapper={(c) => [
                c.title,
                c.severity,
                String(c.findingCount),
                c.description,
                c.remediation,
              ]}
              title={t("exportTitle")}
              filenameBase="compliance-scan"
            />
          )}
          <button
            className="btn btn-sm btn-primary flex items-center gap-1"
            onClick={handleScan}
            disabled={loading}
            data-testid="scan-button"
          >
            <Play size={14} />
            {loading ? t("scanningLabel") : scan ? t("reScan") : t("runScan")}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <LoadingSpinner />
          </div>
        )}

        {error && (
          <EmptyState icon={<AlertTriangle size={40} />} title={t("scanFailed")} description={error} />
        )}

        {!scan && !loading && !error && (
          <EmptyState
            icon={<Shield size={40} />}
            title={t("emptyTitle")}
            description={t("emptyDescription")}
          />
        )}

        {scan && (
          <>
            {/* Global score + metadata */}
            <div className="flex items-center gap-4 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-4">
              <div className="text-[2.5rem] font-bold" style={{ color: scoreColor(scan.globalScore) }}>
                {scan.globalScore}/100
              </div>
              <div>
                <div className="text-body font-semibold text-[var(--color-text-primary)]">
                  {t("globalScore")}
                </div>
                <div className="text-[11px] text-[var(--color-text-secondary)]">
                  {scan.totalAccountsScanned} {t("accountsScanned")} - {scan.totalFindings} {t("findingsLabel")} - {scan.scannedAt} - {scan.generator}
                </div>
              </div>
            </div>

            {/* Framework score cards grid */}
            <div className="grid grid-cols-3 gap-2 lg:grid-cols-5" data-testid="framework-grid">
              {scan.frameworkScores.map((fw) => (
                <FrameworkCard
                  key={fw.standard}
                  fw={fw}
                  onExport={() => handleExportFramework(fw.standard)}
                />
              ))}
            </div>

            {/* Checks list */}
            <div
              className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)]"
              data-testid="checks-list"
            >
              <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border-default)]">
                <h3 className="text-caption font-semibold text-[var(--color-text-primary)]">
                  {t("checks")} ({scan.checks.length})
                </h3>
                <div className="flex items-center gap-2 text-[10px] text-[var(--color-text-secondary)]">
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-error)]" /> {t("common:critical")}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-full" style={{ background: "#e65100" }} /> {t("common:high")}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-full" style={{ background: "#f9a825" }} /> {t("common:medium")}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-full" style={{ background: "#546e7a" }} /> {t("common:low")}
                  </span>
                </div>
              </div>
              {scan.checks.map((check) => (
                <CheckRow key={check.checkId} check={check} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
