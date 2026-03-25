import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { EmptyState } from "@/components/common/EmptyState";
import { ExportToolbar } from "@/components/common/ExportToolbar";
import { SecurityDisclaimer } from "@/components/common/SecurityDisclaimer";
import { extractErrorMessage } from "@/utils/errorMapping";
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
        {fw.totalChecks} checks - {fw.checksWithFindings} with findings
      </div>
      <button
        className="self-end mt-1 flex items-center gap-1 text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
        onClick={onExport}
        data-testid={`export-fw-${fw.standard}`}
      >
        <Download size={10} />
        Export {fw.standard} Report
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Check Row (expandable)
// ---------------------------------------------------------------------------

function CheckRow({ check }: { check: CheckResult }) {
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
          {check.title}
        </span>
        <span className="text-caption font-bold" style={{ color: check.findingCount > 0 ? sevColor(check.severity) : "var(--color-success)" }}>
          {check.findingCount}
        </span>
        {check.findingCount > 0 && (
          <span
            className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
            style={{ backgroundColor: sevColor(check.severity) }}
          >
            {check.severity}
          </span>
        )}
        {check.findingCount === 0 && (
          <span className="inline-flex items-center gap-1 text-[10px] text-[var(--color-success)]">
            <CheckCircle size={10} /> Clear
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
                        ... and {check.rows.length - 30} more (see exported report)
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
          Compliance Reports
          <SecurityDisclaimer
            coverage="~15-20%"
            checks="7 checks across 9 frameworks (GDPR, HIPAA, SOX, PCI-DSS v4.0, ISO 27001, NIST 800-53, CIS v8, NIS2, ANSSI). Checks: privileged accounts (adminCount), inactive accounts (>90d), PASSWD_NOTREQD flag, reversible encryption, stale passwords (>90d), password never expires, disabled accounts. Compliance score 0-100 with per-framework breakdown. Per-framework HTML report export with control references and PowerShell remediation."
            limitations="Point-in-time snapshot only - no change history or continuous monitoring. Does not assess GPO settings, file server permissions, audit log configuration, or network segmentation. No shared/generic account detection, separation of duties analysis, or access recertification workflows. Cannot read domain password policy (complexity, lockout thresholds)."
            tools="Netwrix Auditor (change auditing, 30+ controls/framework), ManageEngine ADAudit Plus (200+ reports, real-time alerts), Microsoft Compliance Manager (shared controls, improvement actions), Qualys Policy Compliance (CIS benchmarks), or SolarWinds ARM (access rights visualization) for comprehensive compliance management."
          />
        </h2>
        <div className="flex items-center gap-2">
          {scan && (
            <ExportToolbar<CheckResult>
              columns={[
                { key: "title", header: "Check" },
                { key: "severity", header: "Severity" },
                { key: "findingCount", header: "Findings" },
                { key: "description", header: "Description" },
                { key: "remediation", header: "Remediation" },
              ]}
              data={scan.checks}
              rowMapper={(c) => [
                c.title,
                c.severity,
                String(c.findingCount),
                c.description,
                c.remediation,
              ]}
              title="Compliance Scan - All Checks"
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
            {loading ? "Scanning..." : scan ? "Re-scan" : "Run Compliance Scan"}
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
          <EmptyState icon={<AlertTriangle size={40} />} title="Scan Failed" description={error} />
        )}

        {!scan && !loading && !error && (
          <EmptyState
            icon={<Shield size={40} />}
            title="Compliance Reports"
            description="Run a compliance scan to assess your Active Directory against 9 frameworks: GDPR, HIPAA, SOX, PCI-DSS v4.0, ISO 27001, NIST 800-53, CIS v8, NIS2, and ANSSI."
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
                  Global Compliance Score
                </div>
                <div className="text-[11px] text-[var(--color-text-secondary)]">
                  {scan.totalAccountsScanned} accounts scanned - {scan.totalFindings} findings - {scan.scannedAt} - {scan.generator}
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
                  Checks ({scan.checks.length})
                </h3>
                <div className="flex items-center gap-2 text-[10px] text-[var(--color-text-secondary)]">
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-error)]" /> Critical
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-full" style={{ background: "#e65100" }} /> High
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-full" style={{ background: "#f9a825" }} /> Medium
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-full" style={{ background: "#546e7a" }} /> Low
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
