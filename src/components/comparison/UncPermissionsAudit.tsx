import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  FolderSearch,
  Download,
  Shield,
  ShieldAlert,
  ShieldX,
  Minus,
} from "lucide-react";
import {
  type NtfsAuditResult,
  type AceCrossReference,
  type AccessIndicator,
} from "@/types/ntfs";
import { type DirectoryEntry } from "@/types/directory";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { formatCsv, downloadCsv } from "@/utils/csvExport";

const ACCESS_TOOLTIPS: Record<AccessIndicator, string> = {
  Allowed: "User has access via a matching group membership or direct ACE",
  Denied: "User is explicitly denied access via a matching ACE",
  NoMatch: "ACE does not match any of the user's group memberships",
};

function AccessIcon({ indicator }: { indicator: AccessIndicator }) {
  switch (indicator) {
    case "Allowed":
      return (
        <span title={ACCESS_TOOLTIPS.Allowed} data-testid="access-allowed">
          <Shield size={14} className="text-[var(--color-success)]" />
        </span>
      );
    case "Denied":
      return (
        <span title={ACCESS_TOOLTIPS.Denied} data-testid="access-denied">
          <ShieldAlert size={14} className="text-[var(--color-error)]" />
        </span>
      );
    case "NoMatch":
      return (
        <span title={ACCESS_TOOLTIPS.NoMatch} data-testid="access-nomatch">
          <Minus
            size={14}
            className="text-[var(--color-text-secondary)]"
          />
        </span>
      );
  }
}

interface UncPermissionsAuditProps {
  userA: DirectoryEntry | null;
  userB: DirectoryEntry | null;
}

export function UncPermissionsAudit({
  userA,
  userB,
}: UncPermissionsAuditProps) {
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
      // Use tokenGroups (SIDs) for ACL matching, fallback to memberOf (DNs)
      if (userA && userB && result.aces.length > 0) {
        const userASids =
          userA.attributes?.tokenGroups ?? userA.attributes?.memberOf ?? [];
        const userBSids =
          userB.attributes?.tokenGroups ?? userB.attributes?.memberOf ?? [];
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

  const exportCsv = useCallback(async () => {
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
    await downloadCsv(`ntfs-audit-${Date.now()}.csv`, csv);
  }, [auditResult, crossRef]);

  return (
    <div className="space-y-3" data-testid="unc-permissions-audit">
      {/* UNC path input */}
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <label className="mb-1 block text-caption font-medium text-[var(--color-text-secondary)]">
            UNC Path
          </label>
          <input
            type="text"
            className="w-full rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-bg)] px-3 py-1.5 text-body text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] focus:border-[var(--color-primary)] focus:outline-none"
            placeholder="\\server\share\folder"
            value={uncPath}
            onChange={(e) => setUncPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && uncPath.trim() && !isAuditing) {
                audit();
              }
            }}
            data-testid="unc-path-input"
          />
        </div>
        <button
          className="btn btn-primary btn-sm flex items-center gap-1.5"
          style={{ padding: "6px 12px" }}
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
          {/* Access summary - shown first as it's the key information */}
          {userA && userB && crossRef.length > 0 && (
            <AccessSummary
              crossRef={crossRef}
              userAName={userA.displayName ?? userA.samAccountName ?? "User A"}
              userBName={userB.displayName ?? userB.samAccountName ?? "User B"}
            />
          )}

          <div className="mb-2 mt-3 flex items-center justify-between">
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

          {userA && userB && crossRef.length > 0 && (
            <div
              className="mb-2 flex items-center gap-4 text-caption text-[var(--color-text-primary)]"
              data-testid="ace-legend"
            >
              <div className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-full bg-[var(--color-success)]" />
                Both users
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-full bg-[var(--color-error)]" />
                {userA.displayName ?? userA.samAccountName} only
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-full bg-[var(--color-primary)]" />
                {userB.displayName ?? userB.samAccountName} only
              </div>
            </div>
          )}

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
                        {userA.displayName ?? userA.samAccountName}
                      </th>
                      <th className="px-3 py-2 text-center text-caption font-medium text-[var(--color-text-secondary)]">
                        {userB.displayName ?? userB.samAccountName}
                      </th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {auditResult.aces.map((ace, idx) => {
                  const ref = crossRef[idx];
                  const isDeny = ace.accessType === "Deny";
                  let rowBg = "";
                  if (isDeny) {
                    rowBg = "bg-[var(--color-error-bg)]";
                  } else if (ref) {
                    const aHas = ref.userAAccess === "Allowed";
                    const bHas = ref.userBAccess === "Allowed";
                    if (aHas && bHas) rowBg = "bg-[var(--color-success-bg)]";
                    else if (aHas && !bHas)
                      rowBg = "bg-[var(--color-error-bg)]";
                    else if (!aHas && bHas)
                      rowBg = "bg-[var(--color-primary-subtle)]";
                  }
                  return (
                    <tr
                      key={`${ace.trusteeSid}-${idx}`}
                      className={`border-b border-[var(--color-border-subtle)] last:border-b-0 ${rowBg}`}
                      data-testid={`ace-row-${idx}`}
                    >
                      <td className="px-3 py-2 text-[var(--color-text-primary)]">
                        <div>{ace.trusteeDisplayName}</div>
                        <div className="text-[11px] text-[var(--color-text-secondary)]">
                          {ace.trusteeSid}
                        </div>
                      </td>
                      <td
                        className={`px-3 py-2 font-medium ${isDeny ? "text-[var(--color-error)]" : "text-[var(--color-success)]"}`}
                      >
                        {isDeny && (
                          <ShieldX size={12} className="mr-1 inline" />
                        )}
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

function AccessSummary({
  crossRef,
  userAName,
  userBName,
}: {
  crossRef: AceCrossReference[];
  userAName: string;
  userBName: string;
}) {
  const userAAllowed = crossRef.filter((r) => r.userAAccess === "Allowed");
  const userADenied = crossRef.filter((r) => r.userAAccess === "Denied");
  const userBAllowed = crossRef.filter((r) => r.userBAccess === "Allowed");
  const userBDenied = crossRef.filter((r) => r.userBAccess === "Denied");

  const onlyA = crossRef.filter(
    (r) => r.userAAccess === "Allowed" && r.userBAccess === "NoMatch",
  );
  const onlyB = crossRef.filter(
    (r) => r.userBAccess === "Allowed" && r.userAAccess === "NoMatch",
  );

  return (
    <div
      className="mt-3 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-bg)] p-3 space-y-2"
      data-testid="access-summary"
    >
      <p className="text-caption font-semibold text-[var(--color-text-primary)]">
        Access Summary
      </p>

      <div className="grid grid-cols-2 gap-3 text-caption">
        <div>
          <p className="font-medium text-[var(--color-text-primary)] mb-1">
            {userAName}
          </p>
          <p className="text-[var(--color-success)]">
            {userAAllowed.length} rule(s) grant access
            {userAAllowed.length > 0 && (
              <span className="text-[var(--color-text-secondary)]">
                {" "}
                via{" "}
                {userAAllowed
                  .map((r) => r.ace.trusteeDisplayName.split("\\").pop())
                  .join(", ")}
              </span>
            )}
          </p>
          {userADenied.length > 0 && (
            <p className="text-[var(--color-error)]">
              {userADenied.length} rule(s) deny access
              <span className="text-[var(--color-text-secondary)]">
                {" "}
                via{" "}
                {userADenied
                  .map((r) => r.ace.trusteeDisplayName.split("\\").pop())
                  .join(", ")}
              </span>
            </p>
          )}
        </div>
        <div>
          <p className="font-medium text-[var(--color-text-primary)] mb-1">
            {userBName}
          </p>
          <p className="text-[var(--color-success)]">
            {userBAllowed.length} rule(s) grant access
            {userBAllowed.length > 0 && (
              <span className="text-[var(--color-text-secondary)]">
                {" "}
                via{" "}
                {userBAllowed
                  .map((r) => r.ace.trusteeDisplayName.split("\\").pop())
                  .join(", ")}
              </span>
            )}
          </p>
          {userBDenied.length > 0 && (
            <p className="text-[var(--color-error)]">
              {userBDenied.length} rule(s) deny access
              <span className="text-[var(--color-text-secondary)]">
                {" "}
                via{" "}
                {userBDenied
                  .map((r) => r.ace.trusteeDisplayName.split("\\").pop())
                  .join(", ")}
              </span>
            </p>
          )}
        </div>
      </div>

      {/* Differences explanation */}
      {(onlyA.length > 0 || onlyB.length > 0) && (
        <div className="border-t border-[var(--color-border-subtle)] pt-2">
          <p className="font-medium text-[var(--color-text-primary)] mb-1">
            Differences
          </p>
          {onlyA.map((r, i) => (
            <p key={`a-${i}`} className="text-[var(--color-text-secondary)]">
              <span className="font-medium text-[var(--color-text-primary)]">
                {userAName}
              </span>{" "}
              has{" "}
              <span className="font-medium">
                {r.ace.permissions.join(", ")}
              </span>{" "}
              access via{" "}
              <span className="font-medium">
                {r.ace.trusteeDisplayName.split("\\").pop()}
              </span>{" "}
              -{" "}
              <span className="font-medium text-[var(--color-text-primary)]">
                {userBName}
              </span>{" "}
              does not
            </p>
          ))}
          {onlyB.map((r, i) => (
            <p key={`b-${i}`} className="text-[var(--color-text-secondary)]">
              <span className="font-medium text-[var(--color-text-primary)]">
                {userBName}
              </span>{" "}
              has{" "}
              <span className="font-medium">
                {r.ace.permissions.join(", ")}
              </span>{" "}
              access via{" "}
              <span className="font-medium">
                {r.ace.trusteeDisplayName.split("\\").pop()}
              </span>{" "}
              -{" "}
              <span className="font-medium text-[var(--color-text-primary)]">
                {userAName}
              </span>{" "}
              does not
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
