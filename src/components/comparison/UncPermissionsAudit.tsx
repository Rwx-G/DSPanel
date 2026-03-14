import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FolderSearch, Download, Shield, ShieldAlert, ShieldX, Minus } from "lucide-react";
import { type AceEntry, type NtfsAuditResult, type AceCrossReference, type AccessIndicator } from "@/types/ntfs";
import { type DirectoryEntry } from "@/types/directory";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { formatCsv, downloadCsv } from "@/utils/csvExport";

function AccessIcon({ indicator }: { indicator: AccessIndicator }) {
  switch (indicator) {
    case "Allowed":
      return <Shield size={14} className="text-[var(--color-success)]" data-testid="access-allowed" />;
    case "Denied":
      return <ShieldAlert size={14} className="text-[var(--color-error)]" data-testid="access-denied" />;
    case "NoMatch":
      return <Minus size={14} className="text-[var(--color-text-secondary)]" data-testid="access-nomatch" />;
  }
}

interface UncPermissionsAuditProps {
  userA: DirectoryEntry | null;
  userB: DirectoryEntry | null;
}

export function UncPermissionsAudit({ userA, userB }: UncPermissionsAuditProps) {
  const [uncPath, setUncPath] = useState("");
  const [isAuditing, setIsAuditing] = useState(false);
  const [auditResult, setAuditResult] = useState<NtfsAuditResult | null>(null);
  const [crossRef, setCrossRef] = useState<AceCrossReference[]>([]);
  const [error, setError] = useState<string | null>(null);

  const audit = useCallback(async () => {
    if (!uncPath.trim()) return;
    setIsAuditing(true);
    setError(null);
    setAuditResult(null);
    setCrossRef([]);

    try {
      const result = await invoke<NtfsAuditResult>("audit_ntfs_permissions", {
        path: uncPath.trim(),
      });
      setAuditResult(result);

      // Cross-reference if both users are selected
      if (userA && userB && result.aces.length > 0) {
        const userASids = userA.attributes?.memberOf ?? [];
        const userBSids = userB.attributes?.memberOf ?? [];
        const refs = await invoke<AceCrossReference[]>("cross_reference_ntfs", {
          aces: result.aces,
          userASids,
          userBSids,
        });
        setCrossRef(refs);
      }
    } catch (e) {
      setError(`${e}`);
    } finally {
      setIsAuditing(false);
    }
  }, [uncPath, userA, userB]);

  const exportCsv = useCallback(() => {
    if (!auditResult) return;
    const headers = [
      "Path",
      "Trustee",
      "Trustee SID",
      "Type",
      "Permissions",
      "Inherited",
      "User A Access",
      "User B Access",
    ];
    const rows = auditResult.aces.map((ace, idx) => {
      const ref = crossRef[idx];
      return [
        auditResult.path,
        ace.trusteeDisplayName,
        ace.trusteeSid,
        ace.accessType,
        ace.permissions.join("; "),
        ace.isInherited ? "Yes" : "No",
        ref?.userAAccess ?? "-",
        ref?.userBAccess ?? "-",
      ];
    });
    const csv = formatCsv(headers, rows);
    downloadCsv(`ntfs-audit-${Date.now()}.csv`, csv);
  }, [auditResult, crossRef]);

  return (
    <div className="space-y-3" data-testid="unc-permissions-audit">
      {/* UNC path input */}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="mb-1 block text-caption font-medium text-[var(--color-text-secondary)]">
            UNC Path
          </label>
          <input
            type="text"
            className="w-full rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-bg)] px-3 py-1.5 text-body text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:border-[var(--color-primary)] focus:outline-none"
            placeholder="\\\\server\\share\\folder"
            value={uncPath}
            onChange={(e) => setUncPath(e.target.value)}
            data-testid="unc-path-input"
          />
        </div>
        <button
          className="btn btn-primary flex items-center gap-1.5 px-4 py-1.5"
          onClick={audit}
          disabled={!uncPath.trim() || isAuditing}
          data-testid="audit-button"
        >
          {isAuditing ? (
            <LoadingSpinner size="sm" />
          ) : (
            <FolderSearch size={14} />
          )}
          Audit
        </button>
      </div>

      {/* Error */}
      {error && (
        <div
          className="rounded-md border border-[var(--color-error)] bg-[var(--color-error-bg)] px-4 py-2 text-body text-[var(--color-error)]"
          data-testid="unc-error"
        >
          {error}
        </div>
      )}

      {/* ACE Results */}
      {auditResult && (
        <div data-testid="ace-results">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-caption text-[var(--color-text-secondary)]">
              {auditResult.aces.length} ACE(s) found for {auditResult.path}
            </span>
            <button
              className="btn btn-ghost flex items-center gap-1.5 text-caption"
              onClick={exportCsv}
              data-testid="export-csv-button"
            >
              <Download size={14} />
              Export CSV
            </button>
          </div>

          <div className="overflow-x-auto rounded-lg border border-[var(--color-border-default)]">
            <table className="w-full text-body" data-testid="ace-table">
              <thead>
                <tr className="border-b border-[var(--color-border-default)] bg-[var(--color-surface-card)]">
                  <th className="px-3 py-2 text-left text-caption font-medium text-[var(--color-text-secondary)]">
                    Trustee
                  </th>
                  <th className="px-3 py-2 text-left text-caption font-medium text-[var(--color-text-secondary)]">
                    Type
                  </th>
                  <th className="px-3 py-2 text-left text-caption font-medium text-[var(--color-text-secondary)]">
                    Permissions
                  </th>
                  <th className="px-3 py-2 text-center text-caption font-medium text-[var(--color-text-secondary)]">
                    Inherited
                  </th>
                  {userA && userB && (
                    <>
                      <th className="px-3 py-2 text-center text-caption font-medium text-[var(--color-text-secondary)]">
                        User A
                      </th>
                      <th className="px-3 py-2 text-center text-caption font-medium text-[var(--color-text-secondary)]">
                        User B
                      </th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {auditResult.aces.map((ace, idx) => {
                  const ref = crossRef[idx];
                  const isDeny = ace.accessType === "Deny";
                  return (
                    <tr
                      key={`${ace.trusteeSid}-${idx}`}
                      className={`border-b border-[var(--color-border-subtle)] last:border-b-0 ${
                        isDeny ? "bg-[var(--color-error-bg)]" : ""
                      }`}
                      data-testid={`ace-row-${idx}`}
                    >
                      <td className="px-3 py-2 text-[var(--color-text-primary)]">
                        <div>{ace.trusteeDisplayName}</div>
                        <div className="text-[11px] text-[var(--color-text-secondary)]">
                          {ace.trusteeSid}
                        </div>
                      </td>
                      <td className={`px-3 py-2 font-medium ${isDeny ? "text-[var(--color-error)]" : "text-[var(--color-success)]"}`}>
                        {isDeny && <ShieldX size={12} className="mr-1 inline" />}
                        {ace.accessType}
                      </td>
                      <td className="px-3 py-2 text-[var(--color-text-primary)]">
                        {ace.permissions.join(", ")}
                      </td>
                      <td className="px-3 py-2 text-center text-caption text-[var(--color-text-secondary)]">
                        {ace.isInherited ? "Yes" : "No"}
                      </td>
                      {userA && userB && ref && (
                        <>
                          <td className="px-3 py-2 text-center">
                            <AccessIcon indicator={ref.userAAccess} />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <AccessIcon indicator={ref.userBAccess} />
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {auditResult.errors.length > 0 && (
            <div className="mt-2 text-caption text-[var(--color-warning)]">
              {auditResult.errors.length} error(s) during audit
            </div>
          )}
        </div>
      )}
    </div>
  );
}
