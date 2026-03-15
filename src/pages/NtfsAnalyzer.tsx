import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  FolderSearch,
  Download,
  AlertTriangle,
  ShieldX,
  ChevronDown,
  ChevronRight,
  Users,
} from "lucide-react";
import {
  type NtfsAnalysisResult,
  type PathAclResult,
} from "@/types/ntfs-analyzer";
import { type AceEntry } from "@/types/ntfs";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import {
  ContextMenu,
  type ContextMenuItem,
} from "@/components/common/ContextMenu";
import { GroupMembersDialog } from "@/components/dialogs/GroupMembersDialog";
import { GroupChainTree } from "@/components/comparison/GroupChainTree";
import { formatCsv, downloadCsv } from "@/utils/csvExport";

function PathAclSection({
  result,
  onTrusteeContextMenu,
}: {
  result: PathAclResult;
  onTrusteeContextMenu: (e: React.MouseEvent, ace: AceEntry) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [expandedTrustees, setExpandedTrustees] = useState<Set<number>>(
    new Set(),
  );

  const toggleTrustee = (idx: number) => {
    setExpandedTrustees((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  };

  return (
    <div
      className="rounded-lg border border-[var(--color-border-default)] overflow-hidden"
      data-testid={`path-section-${result.path}`}
    >
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left bg-[var(--color-surface-card)] hover:bg-[var(--color-surface-hover)] transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="flex-1 text-body font-medium text-[var(--color-text-primary)] truncate">
          {result.path}
        </span>
        <span className="text-caption text-[var(--color-text-secondary)]">
          {result.aces.length} ACE(s)
        </span>
        {result.error && (
          <AlertTriangle size={14} className="text-[var(--color-warning)]" />
        )}
      </button>

      {expanded && (
        <div>
          {result.error && (
            <div className="border-t border-[var(--color-border-subtle)] bg-[var(--color-warning-bg)] px-3 py-2 text-caption text-[var(--color-warning)]">
              {result.error}
            </div>
          )}
          {result.aces.length > 0 && (
            <table className="w-full table-fixed text-body">
              <colgroup>
                <col className="w-[40%]" />
                <col className="w-[12%]" />
                <col className="w-[33%]" />
                <col className="w-[15%]" />
              </colgroup>
              <thead>
                <tr className="border-t border-[var(--color-border-default)] bg-[var(--color-surface-bg)]">
                  <th className="px-3 py-1.5 text-left text-caption font-medium text-[var(--color-text-secondary)]">
                    Trustee
                  </th>
                  <th className="px-3 py-1.5 text-left text-caption font-medium text-[var(--color-text-secondary)]">
                    Type
                  </th>
                  <th className="px-3 py-1.5 text-left text-caption font-medium text-[var(--color-text-secondary)]">
                    Permissions
                  </th>
                  <th className="px-3 py-1.5 text-center text-caption font-medium text-[var(--color-text-secondary)]">
                    Source
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.aces.map((ace, idx) => {
                  const isDeny = ace.accessType === "Deny";
                  return (
                    <tr
                      key={`${ace.trusteeSid}-${idx}`}
                      className={`border-t border-[var(--color-border-subtle)] ${isDeny ? "bg-[var(--color-error-bg)]" : ""}`}
                      data-testid={`ace-row-${result.path}-${idx}`}
                    >
                      <td
                        className="px-3 py-1.5 text-[var(--color-text-primary)]"
                        onContextMenu={(e) => onTrusteeContextMenu(e, ace)}
                      >
                        <button
                          className="flex items-center gap-1.5 cursor-pointer hover:text-[var(--color-primary)] transition-colors"
                          onClick={() => toggleTrustee(idx)}
                          data-testid={`trustee-expand-${idx}`}
                        >
                          {expandedTrustees.has(idx) ? (
                            <ChevronDown
                              size={12}
                              className="shrink-0 text-[var(--color-text-secondary)]"
                            />
                          ) : (
                            <ChevronRight
                              size={12}
                              className="shrink-0 text-[var(--color-text-secondary)]"
                            />
                          )}
                          <span className="truncate">
                            {ace.trusteeDisplayName}
                          </span>
                        </button>
                        {expandedTrustees.has(idx) && (
                          <div className="mt-1">
                            <GroupChainTree
                              groupDn={`CN=${ace.trusteeDisplayName.includes("\\") ? ace.trusteeDisplayName.split("\\").pop()! : ace.trusteeDisplayName},OU=Groups,DC=contoso,DC=com`}
                              groupName={
                                ace.trusteeDisplayName.includes("\\")
                                  ? ace.trusteeDisplayName.split("\\").pop()!
                                  : ace.trusteeDisplayName
                              }
                            />
                          </div>
                        )}
                      </td>
                      <td
                        className={`px-3 py-1.5 font-medium ${isDeny ? "text-[var(--color-error)]" : "text-[var(--color-success)]"}`}
                      >
                        {isDeny && (
                          <ShieldX size={12} className="mr-1 inline" />
                        )}
                        {ace.accessType}
                      </td>
                      <td className="truncate px-3 py-1.5 text-[var(--color-text-primary)]">
                        {ace.permissions.join(", ")}
                      </td>
                      <td className="px-3 py-1.5 text-center text-caption text-[var(--color-text-secondary)]">
                        {ace.isInherited ? "Inherited" : "Explicit"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {result.aces.length === 0 && !result.error && (
            <div className="border-t border-[var(--color-border-subtle)] px-3 py-2 text-caption text-[var(--color-text-secondary)]">
              No ACEs found
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function NtfsAnalyzer() {
  const [uncPath, setUncPath] = useState("");
  const [depth, setDepth] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<NtfsAnalysisResult | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [contextMenuItems, setContextMenuItems] = useState<ContextMenuItem[]>(
    [],
  );
  const [groupMembersDialog, setGroupMembersDialog] = useState<{
    dn: string;
    name: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showExplicitOnly, setShowExplicitOnly] = useState(false);

  const handleTrusteeContextMenu = useCallback(
    (e: React.MouseEvent, ace: AceEntry) => {
      e.preventDefault();
      // Extract group name from display name (e.g. "CONTOSO\IT Team" -> "IT Team")
      const name = ace.trusteeDisplayName.includes("\\")
        ? ace.trusteeDisplayName.split("\\").pop()!
        : ace.trusteeDisplayName;
      // Build group DN matching the demo data convention
      const groupDn =
        name === "Domain Users"
          ? `CN=${name},CN=Users,DC=contoso,DC=com`
          : `CN=${name},OU=Groups,DC=contoso,DC=com`;

      setContextMenuItems([
        {
          label: `View members of ${name}`,
          icon: <Users size={14} />,
          onClick: () => setGroupMembersDialog({ dn: groupDn, name }),
        },
      ]);
      setContextMenuPos({ x: e.clientX, y: e.clientY });
    },
    [],
  );

  const analyze = useCallback(async () => {
    if (!uncPath.trim()) return;
    setIsAnalyzing(true);
    setError(null);
    setResult(null);

    try {
      const res = await invoke<NtfsAnalysisResult>("analyze_ntfs", {
        path: uncPath.trim(),
        depth,
      });
      setResult(res);
    } catch (e) {
      setError(`${e}`);
    } finally {
      setIsAnalyzing(false);
    }
  }, [uncPath, depth]);

  const exportCsv = useCallback(async () => {
    if (!result) return;
    const headers = [
      "Path",
      "Trustee",
      "Trustee SID",
      "Type",
      "Permissions",
      "Inherited",
      "Source",
    ];
    const rows: string[][] = [];
    for (const pr of result.paths) {
      for (const ace of pr.aces) {
        rows.push([
          pr.path,
          ace.trusteeDisplayName,
          ace.trusteeSid,
          ace.accessType,
          ace.permissions.join("; "),
          ace.isInherited ? "Yes" : "No",
          ace.isInherited ? "Inherited" : "Explicit",
        ]);
      }
    }
    const csv = formatCsv(headers, rows);
    await downloadCsv(`ntfs-analysis-${Date.now()}.csv`, csv);
  }, [result]);

  const filteredPaths = result?.paths.map((pr) => {
    if (!showExplicitOnly) return pr;
    return {
      ...pr,
      aces: pr.aces.filter((ace) => !ace.isInherited),
    };
  });

  return (
    <div
      className="flex h-full flex-col gap-4 p-4"
      data-testid="ntfs-analyzer-page"
    >
      <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">
        NTFS Permissions Analyzer
      </h1>

      {/* Controls */}
      <div>
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
                if (e.key === "Enter" && uncPath.trim() && !isAnalyzing) {
                  analyze();
                }
              }}
              data-testid="analyzer-path-input"
            />
          </div>
          <div>
            <label className="mb-1 block text-caption font-medium text-[var(--color-text-secondary)]">
              Depth
            </label>
            <select
              className="w-40 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-bg)] px-3 py-1.5 text-body text-[var(--color-text-primary)]"
              value={depth}
              onChange={(e) => setDepth(Number(e.target.value))}
              data-testid="depth-selector"
            >
              <option value={0}>Current only</option>
              <option value={1}>1 level</option>
              <option value={2}>2 levels</option>
              <option value={3}>3 levels</option>
              <option value={5}>5 levels</option>
            </select>
          </div>
          <button
            className="btn btn-primary btn-sm flex items-center gap-1.5"
            style={{ padding: "6px 12px" }}
            onClick={analyze}
            disabled={!uncPath.trim() || isAnalyzing}
            data-testid="analyze-button"
          >
            {isAnalyzing ? (
              <LoadingSpinner size="sm" />
            ) : (
              <FolderSearch size={14} />
            )}
            Analyze
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div
          className="rounded-md border border-[var(--color-error)] bg-[var(--color-error-bg)] px-4 py-2 text-body text-[var(--color-error)]"
          data-testid="analyzer-error"
        >
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div
          className="flex flex-1 flex-col gap-3 overflow-hidden"
          data-testid="analyzer-results"
        >
          {/* Summary */}
          <div className="flex items-center gap-4 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-4 py-3">
            <span className="text-body text-[var(--color-text-primary)]">
              <strong>{result.totalPathsScanned}</strong> path(s) scanned
            </span>
            <span className="text-body text-[var(--color-text-primary)]">
              <strong>{result.totalAces}</strong> ACE(s) found
            </span>
            {result.totalErrors > 0 && (
              <span className="text-body text-[var(--color-warning)]">
                <AlertTriangle size={14} className="mr-1 inline" />
                <strong>{result.totalErrors}</strong> error(s)
              </span>
            )}
            {result.conflicts.length > 0 && (
              <span className="text-body text-[var(--color-error)]">
                <ShieldX size={14} className="mr-1 inline" />
                <strong>{result.conflicts.length}</strong> conflict(s)
              </span>
            )}
            <div className="ml-auto flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-caption text-[var(--color-text-secondary)]">
                <input
                  type="checkbox"
                  checked={showExplicitOnly}
                  onChange={(e) => setShowExplicitOnly(e.target.checked)}
                  data-testid="explicit-only-toggle"
                />
                Explicit only
              </label>
              <button
                className="btn btn-ghost flex items-center gap-1.5 text-caption"
                onClick={exportCsv}
                data-testid="export-csv-btn"
              >
                <Download size={14} />
                CSV
              </button>
            </div>
          </div>

          {/* Conflicts */}
          {result.conflicts.length > 0 && (
            <div
              className="rounded-lg border border-[var(--color-error)] bg-[var(--color-error-bg)] p-3"
              data-testid="conflict-panel"
            >
              <h3 className="mb-2 text-body font-semibold text-[var(--color-error)]">
                <AlertTriangle size={14} className="mr-1 inline" />
                Permission Conflicts Detected
              </h3>
              {result.conflicts.map((c, idx) => (
                <div
                  key={idx}
                  className="mb-1 text-caption text-[var(--color-text-primary)]"
                  data-testid={`conflict-${idx}`}
                >
                  <strong>{c.trusteeDisplayName}</strong> ({c.trusteeSid}):
                  Allow at{" "}
                  <code className="text-[var(--color-success)]">
                    {c.allowPath}
                  </code>{" "}
                  vs Deny at{" "}
                  <code className="text-[var(--color-error)]">
                    {c.denyPath}
                  </code>{" "}
                  for {c.denyPermissions.join(", ")}
                </div>
              ))}
            </div>
          )}

          {/* Path results */}
          <div className="flex-1 space-y-2 overflow-y-auto">
            {filteredPaths?.map((pr, idx) => (
              <PathAclSection
                key={`${pr.path}-${idx}`}
                result={pr}
                onTrusteeContextMenu={handleTrusteeContextMenu}
              />
            ))}
          </div>
        </div>
      )}

      <ContextMenu
        items={contextMenuItems}
        position={contextMenuPos}
        onClose={() => setContextMenuPos(null)}
      />

      {groupMembersDialog && (
        <GroupMembersDialog
          groupDn={groupMembersDialog.dn}
          groupName={groupMembersDialog.name}
          onClose={() => setGroupMembersDialog(null)}
        />
      )}
    </div>
  );
}
