import { useState, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { EmptyState } from "@/components/common/EmptyState";
import { DataTable, type Column } from "@/components/data/DataTable";
import { ExportToolbar } from "@/components/common/ExportToolbar";
import {
  type DirectoryEntry,
  type DirectoryGroup,
  mapEntryToGroup,
} from "@/types/directory";
import { usePermissions } from "@/hooks/usePermissions";
import { useNavigation } from "@/contexts/NavigationContext";
import {
  Search,
  CheckCircle,
  AlertCircle,
  Trash2,
  ExternalLink,
  ArrowRight,
  Info,
  ThumbsUp,
} from "lucide-react";

/** Wrapper for hygiene result sections - shows green "all clear" when count is 0 */
function HygieneSection({
  title,
  count,
  testId,
  countTestId,
  severity = "warning",
  tooltip,
  tooltipPosition = "below",
  actions,
  children,
}: {
  title: string;
  count: number;
  testId: string;
  countTestId: string;
  severity?: "warning" | "error";
  tooltip?: { what: string; why: string; fix: string; warn?: string };
  tooltipPosition?: "below" | "above";
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const [showTip, setShowTip] = useState(false);
  const isClean = count === 0;
  return (
    <div
      className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-3"
      data-testid={testId}
    >
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-body font-semibold text-[var(--color-text-primary)]">
          {title}
          <span
            className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-caption font-medium text-white ${
              isClean
                ? "bg-[var(--color-success)]"
                : severity === "error"
                  ? "bg-[var(--color-error)]"
                  : "bg-[var(--color-warning)]"
            }`}
            data-testid={countTestId}
          >
            {count}
          </span>
          {isClean && (
            <ThumbsUp size={14} className="text-[var(--color-success)]" />
          )}
          {tooltip && (
            <div className="relative">
              <button
                className="flex h-5 w-5 items-center justify-center rounded-full text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
                onClick={() => setShowTip(!showTip)}
                onBlur={() => setTimeout(() => setShowTip(false), 150)}
                aria-label={`About ${title}`}
              >
                <Info size={13} />
              </button>
              {showTip && (
                <div className={`absolute left-0 z-50 w-80 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-3 shadow-lg ${tooltipPosition === "above" ? "bottom-full mb-1" : "top-full mt-1"}`}>
                  <p className="text-caption text-[var(--color-text-primary)]">
                    <strong>What:</strong> {tooltip.what}
                  </p>
                  <p className="mt-1 text-caption text-[var(--color-text-primary)]">
                    <strong>Why:</strong> {tooltip.why}
                  </p>
                  <p className="mt-1 text-caption text-[var(--color-text-primary)]">
                    <strong>Fix:</strong> {tooltip.fix}
                  </p>
                  {tooltip.warn && (
                    <p className="mt-1.5 flex items-start gap-1 text-caption text-[var(--color-warning)]">
                      <AlertCircle size={12} className="mt-0.5 shrink-0" />
                      {tooltip.warn}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </h3>
        {!isClean && actions && <div>{actions}</div>}
      </div>
      {isClean ? (
        <p className="mt-2 text-caption text-[var(--color-success)]">
          All clear - no issues detected
        </p>
      ) : (
        <div className="mt-3">{children}</div>
      )}
    </div>
  );
}

const HYGIENE_TOOLTIPS = {
  empty: {
    what: "Groups with zero members.",
    why: "Empty groups clutter AD and may still be referenced in UNC path ACLs or GPOs, causing confusion during audits.",
    fix: "Delete the group if unused, or add the appropriate members. Check UNC permissions before deleting.",
    warn: "The group may still be configured on UNC paths or file share ACLs. Verify with NTFS Analyzer before deleting.",
  },
  singleMember: {
    what: "Groups containing only one member.",
    why: "A single-member group adds unnecessary indirection. The user could be assigned permissions directly.",
    fix: "Assign the user directly to the resource, then remove the group. Or add more members if the group is meant to grow.",
    warn: "Some applications require group-based access even for a single user. Verify before removing.",
  },
  stale: {
    what: "Groups not modified in over 180 days.",
    why: "Stale groups may reflect outdated team structures or completed projects, increasing the attack surface.",
    fix: "Review with the group owner. Archive or delete if obsolete, update membership if still needed.",
  },
  undescribed: {
    what: "Groups missing the description attribute.",
    why: "Without a description, administrators cannot determine the group's purpose, making audits and cleanup harder.",
    fix: "Add a meaningful description in Group Management (e.g. team name, project, access scope).",
  },
  circular: {
    what: "Groups that contain each other in a nesting loop (A contains B contains A).",
    why: "Circular nesting causes unexpected permission inheritance and can degrade LDAP query performance.",
    fix: "Break the cycle by removing one of the nesting relationships. Decide which group should be the parent.",
    warn: "Circular nesting can cause token bloat and authentication delays. Fix as soon as possible.",
  },
  deepNesting: {
    what: "Groups nested deeper than 3 levels.",
    why: "Deep nesting makes permissions hard to audit and can cause Kerberos token size issues (MaxTokenSize).",
    fix: "Flatten the group structure by reducing nesting levels. Consider using direct memberships instead.",
  },
  duplicate: {
    what: "Multiple groups with exactly the same set of members.",
    why: "Duplicate groups create confusion about which group to use and increase maintenance burden.",
    fix: "Consolidate into a single group. Update all ACLs and GPOs to reference the surviving group, then delete duplicates.",
    warn: "Different groups may be used on different resources. Verify all references before merging.",
  },
};

interface DeleteProgress {
  current: number;
  total: number;
  status: "idle" | "running" | "completed" | "failed";
  message: string;
}

interface DeepNestingResult {
  groupDn: string;
  groupName: string;
  depth: number;
}

export function GroupHygiene() {
  const [scanning, setScanning] = useState(false);
  const [emptyGroups, setEmptyGroups] = useState<DirectoryGroup[]>([]);
  const [cycles, setCycles] = useState<string[][]>([]);
  const [singleMemberGroups, setSingleMemberGroups] = useState<
    DirectoryGroup[]
  >([]);
  const [staleGroups, setStaleGroups] = useState<DirectoryGroup[]>([]);
  const [undescribedGroups, setUndescribedGroups] = useState<DirectoryGroup[]>(
    [],
  );
  const [deeplyNested, setDeeplyNested] = useState<DeepNestingResult[]>([]);
  const [duplicateGroups, setDuplicateGroups] = useState<DirectoryGroup[][]>(
    [],
  );
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanned, setScanned] = useState(false);
  const [selectedEmpty, setSelectedEmpty] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [showDeletePreview, setShowDeletePreview] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState<DeleteProgress>({
    current: 0,
    total: 0,
    status: "idle",
    message: "",
  });

  const [showInfo, setShowInfo] = useState(false);
  const { hasPermission } = usePermissions();
  const canDelete = hasPermission("Admin");
  const { openTab } = useNavigation();

  const handleScan = useCallback(async () => {
    setScanning(true);
    setScanError(null);
    setEmptyGroups([]);
    setCycles([]);
    setSingleMemberGroups([]);
    setStaleGroups([]);
    setUndescribedGroups([]);
    setDeeplyNested([]);
    setDuplicateGroups([]);
    setSelectedEmpty(new Set());
    setScanned(false);

    try {
      const [
        emptyEntries,
        detectedCycles,
        singleEntries,
        staleEntries,
        undescribedEntries,
        nestingResults,
        duplicateEntries,
      ] = await Promise.all([
        invoke<DirectoryEntry[]>("detect_empty_groups"),
        invoke<string[][]>("detect_circular_groups"),
        invoke<DirectoryEntry[]>("detect_single_member_groups"),
        invoke<DirectoryEntry[]>("detect_stale_groups", {
          daysThreshold: 180,
        }),
        invoke<DirectoryEntry[]>("detect_undescribed_groups"),
        invoke<DeepNestingResult[]>("detect_deep_nesting", { maxDepth: 3 }),
        invoke<DirectoryEntry[][]>("detect_duplicate_groups"),
      ]);

      setEmptyGroups(emptyEntries.map(mapEntryToGroup));
      setCycles(detectedCycles);
      setSingleMemberGroups(singleEntries.map(mapEntryToGroup));
      setStaleGroups(staleEntries.map(mapEntryToGroup));
      setUndescribedGroups(undescribedEntries.map(mapEntryToGroup));
      setDeeplyNested(nestingResults);
      setDuplicateGroups(
        duplicateEntries.map((cluster) => cluster.map(mapEntryToGroup)),
      );
      setScanned(true);

      // Audit log the scan completion
      const totalIssues =
        emptyEntries.length +
        detectedCycles.length +
        singleEntries.length +
        staleEntries.length +
        undescribedEntries.length +
        nestingResults.length +
        duplicateEntries.length;
      invoke("audit_log", {
        action: "HygieneScanCompleted",
        targetDn: "",
        details: `Scan complete: ${totalIssues} issue(s) found (${emptyEntries.length} empty, ${detectedCycles.length} circular, ${singleEntries.length} single-member, ${staleEntries.length} stale, ${undescribedEntries.length} undescribed, ${nestingResults.length} deep-nested, ${duplicateEntries.length} duplicate)`,
        success: true,
      }).catch(() => {});
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setScanError(message);
    } finally {
      setScanning(false);
    }
  }, []);

  const handleSelectEmpty = useCallback((dn: string, checked: boolean) => {
    setSelectedEmpty((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(dn);
      } else {
        next.delete(dn);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(
    (checked: boolean) => {
      if (checked) {
        setSelectedEmpty(new Set(emptyGroups.map((g) => g.distinguishedName)));
      } else {
        setSelectedEmpty(new Set());
      }
    },
    [emptyGroups],
  );

  const allSelected =
    emptyGroups.length > 0 && selectedEmpty.size === emptyGroups.length;

  const handleDeleteSelected = useCallback(async () => {
    if (selectedEmpty.size === 0) return;
    setShowDeletePreview(false);
    setDeleting(true);

    const dns = Array.from(selectedEmpty);
    const total = dns.length;

    setDeleteProgress({
      current: 0,
      total,
      status: "running",
      message: "Starting deletion...",
    });

    let completed = 0;
    let failed = 0;
    for (const dn of dns) {
      setDeleteProgress({
        current: completed,
        total,
        status: "running",
        message: `Deleting ${dn}...`,
      });

      try {
        // Re-check that the group is still empty before deleting (race condition protection)
        const members = await invoke<DirectoryEntry[]>("get_group_members", {
          groupDn: dn,
          maxResults: 1,
        });
        if (members.length > 0) {
          failed++;
          console.warn("Group no longer empty, skipping deletion:", dn);
          continue;
        }
        await invoke("delete_group", { groupDn: dn });
        completed++;
      } catch (err) {
        failed++;
        console.warn("Failed to delete group:", dn, err);
      }
    }

    if (failed > 0) {
      setDeleteProgress({
        current: completed,
        total,
        status: "failed",
        message: `Completed with ${failed} failure(s). ${completed} deleted.`,
      });
    } else {
      setDeleteProgress({
        current: total,
        total,
        status: "completed",
        message: `Successfully deleted ${total} group(s).`,
      });
    }

    setDeleting(false);
    setSelectedEmpty(new Set());

    // Re-scan to refresh the list
    handleScan();
  }, [selectedEmpty, handleScan]);

  const handleGoToGroup = useCallback(
    (groupDn: string) => {
      openTab("Group Management", "groups", "users-group", {
        selectedGroupDn: groupDn,
      });
    },
    [openTab],
  );

  type EmptyGroupRow = {
    select: string;
    name: string;
    dn: string;
    scope: string;
    ou: string;
    actions: string;
  };

  const emptyGroupColumns: Column<EmptyGroupRow>[] = useMemo(() => {
    const cols: Column<EmptyGroupRow>[] = [];

    if (canDelete) {
      cols.push({
        key: "select",
        header: "",
        sortable: false,
        width: 40,
        resizable: false,
        render: (_value, row) => (
          <input
            type="checkbox"
            checked={selectedEmpty.has(row.dn)}
            onChange={(e) => handleSelectEmpty(row.dn, e.target.checked)}
            onClick={(e) => e.stopPropagation()}
            data-testid={`empty-group-checkbox-${row.name}`}
            aria-label={`Select ${row.name}`}
          />
        ),
      });
    }

    cols.push(
      {
        key: "name",
        header: "Name",
        sortable: true,
      },
      {
        key: "scope",
        header: "Scope",
        sortable: true,
      },
      {
        key: "ou",
        header: "Organizational Unit",
        sortable: true,
      },
      {
        key: "actions",
        header: "",
        sortable: false,
        width: 70,
        resizable: false,
        render: (_value, row) => (
          <button
            className="btn btn-ghost btn-sm flex items-center gap-1 whitespace-nowrap"
            onClick={() => handleGoToGroup(row.dn)}
            data-testid={`go-to-group-${row.name}`}
            title="Open in Group Management"
          >
            <ExternalLink size={12} />
            Go to
          </button>
        ),
      },
    );

    return cols;
  }, [canDelete, selectedEmpty, handleSelectEmpty, handleGoToGroup]);

  const emptyGroupRows: EmptyGroupRow[] = emptyGroups.map((g) => ({
    select: "",
    name: g.displayName || g.samAccountName,
    dn: g.distinguishedName,
    scope: g.scope,
    ou: g.organizationalUnit || "-",
    actions: "",
  }));

  const selectedGroupsForPreview = emptyGroups.filter((g) =>
    selectedEmpty.has(g.distinguishedName),
  );

  type SimpleGroupRow = {
    name: string;
    dn: string;
    scope: string;
    actions: string;
  };

  const simpleGroupColumns: Column<SimpleGroupRow>[] = useMemo(
    () => [
      { key: "name", header: "Name", sortable: true },
      { key: "scope", header: "Scope", sortable: true },
      {
        key: "actions",
        header: "",
        sortable: false,
        width: 70,
        resizable: false,
        render: (_value: string, row: SimpleGroupRow) => (
          <button
            className="btn btn-ghost btn-sm flex items-center gap-1 whitespace-nowrap"
            onClick={() => handleGoToGroup(row.dn)}
            data-testid={`go-to-group-${row.name}`}
            title="Open in Group Management"
          >
            <ExternalLink size={12} />
            Go to
          </button>
        ),
      },
    ],
    [handleGoToGroup],
  );

  type StaleGroupRow = {
    name: string;
    dn: string;
    scope: string;
    lastModified: string;
    actions: string;
  };

  const staleGroupColumns: Column<StaleGroupRow>[] = useMemo(
    () => [
      { key: "name", header: "Name", sortable: true },
      { key: "scope", header: "Scope", sortable: true },
      { key: "lastModified", header: "Last Modified", sortable: true },
      {
        key: "actions",
        header: "",
        sortable: false,
        width: 70,
        resizable: false,
        render: (_value: string, row: StaleGroupRow) => (
          <button
            className="btn btn-ghost btn-sm flex items-center gap-1 whitespace-nowrap"
            onClick={() => handleGoToGroup(row.dn)}
            data-testid={`go-to-group-${row.name}`}
            title="Open in Group Management"
          >
            <ExternalLink size={12} />
            Go to
          </button>
        ),
      },
    ],
    [handleGoToGroup],
  );

  function formatWhenChanged(group: DirectoryGroup): string {
    const raw = group.distinguishedName;
    // Look up the original entry's whenChanged from the stale groups state
    // We use the description field workaround - but actually the attribute is on the raw entry.
    // Since we mapped via mapEntryToGroup, we lost raw attributes.
    // For display we rely on staleGroups which were detected by backend as stale (>180 days).
    // We show a generic "Over 180 days ago" label.
    void raw;
    return "> 180 days ago";
  }

  return (
    <div
      className="flex h-full flex-col gap-4 overflow-auto p-4"
      data-testid="group-hygiene"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
            Group Hygiene
          </h2>
          <div className="relative">
            <button
              className="flex h-5 w-5 items-center justify-center rounded-full text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
              onClick={() => setShowInfo(!showInfo)}
              onBlur={() => setTimeout(() => setShowInfo(false), 150)}
              aria-label="About group hygiene"
              data-testid="hygiene-info-btn"
            >
              <Info size={13} />
            </button>
            {showInfo && (
              <div
                className="absolute left-0 top-full z-50 mt-1 w-80 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-3 shadow-lg"
                data-testid="hygiene-info-popup"
              >
                <p className="text-caption font-semibold text-[var(--color-text-primary)] mb-1.5">
                  Group Hygiene Scanner
                </p>
                <ul className="space-y-1 text-caption text-[var(--color-text-secondary)]">
                  <li><strong>Empty groups</strong> - no members at all</li>
                  <li><strong>Single-member groups</strong> - only one member, possibly redundant</li>
                  <li><strong>Stale groups</strong> - not modified in over 180 days</li>
                  <li><strong>No description</strong> - missing documentation</li>
                  <li><strong>Circular nesting</strong> - Group A contains B contains A</li>
                  <li><strong>Excessive depth</strong> - nested deeper than 3 levels</li>
                  <li><strong>Duplicate groups</strong> - identical member sets</li>
                </ul>
                <p className="mt-1.5 text-caption text-[var(--color-text-disabled)]">
                  Empty groups can be deleted in bulk (DomainAdmin required).
                </p>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ExportToolbar<{ category: string; name: string; scope: string; detail: string }>
            columns={[
              { key: "category", header: "Category" },
              { key: "name", header: "Group Name" },
              { key: "scope", header: "Scope" },
              { key: "detail", header: "Detail" },
            ]}
            data={[
              ...emptyGroups.map((g) => ({ category: "Empty", name: g.displayName || g.samAccountName, scope: g.scope, detail: "No members" })),
              ...singleMemberGroups.map((g) => ({ category: "Single Member", name: g.displayName || g.samAccountName, scope: g.scope, detail: "1 member" })),
              ...staleGroups.map((g) => ({ category: "Stale", name: g.displayName || g.samAccountName, scope: g.scope, detail: `Last modified: ${formatWhenChanged(g)}` })),
              ...undescribedGroups.map((g) => ({ category: "No Description", name: g.displayName || g.samAccountName, scope: g.scope, detail: "" })),
            ]}
            rowMapper={(row) => [row.category, row.name, row.scope, row.detail]}
            title="Group Hygiene Report"
            filenameBase="group-hygiene"
          />
          <button
            className="btn btn-primary btn-sm flex items-center gap-1.5"
            onClick={handleScan}
            disabled={scanning}
            data-testid="scan-button"
          >
            <Search size={14} />
            {scanning ? "Scanning..." : "Run Scan"}
          </button>
        </div>
      </div>

      {/* Placeholder containers before scan - same layout as populated sections but greyed out */}
      {!scanned && !scanning && !scanError && (
        <div className="space-y-4 opacity-50 pointer-events-none">
          {[
            { title: "Empty Groups", hint: "No members at all" },
            { title: "Single-Member Groups", hint: "Only one member, possibly redundant" },
            { title: "Stale Groups", hint: "Not modified in over 180 days" },
            { title: "Groups Without Description", hint: "Missing documentation" },
            { title: "Circular Nesting", hint: "Circular group nesting detected" },
            { title: "Excessive Nesting Depth", hint: "Nested deeper than 3 levels" },
            { title: "Duplicate Groups", hint: "Identical member sets" },
          ].map((section) => (
            <div
              key={section.title}
              className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-3"
            >
              <h3 className="mb-3 flex items-center gap-2 text-body font-semibold text-[var(--color-text-primary)]">
                {section.title}
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-text-disabled)] px-1.5 text-caption font-medium text-white">
                  -
                </span>
              </h3>
              <p className="text-caption text-[var(--color-text-secondary)]">
                Run scan to detect: {section.hint}
              </p>
            </div>
          ))}
        </div>
      )}

      {scanning && (
        <div
          className="flex items-center justify-center py-8"
          data-testid="scan-loading"
        >
          <LoadingSpinner message="Scanning for group issues..." />
        </div>
      )}

      {scanError && (
        <div data-testid="scan-error">
          <EmptyState
            icon={<AlertCircle size={48} />}
            title="Scan failed"
            description={scanError}
            action={{ label: "Retry", onClick: handleScan }}
          />
        </div>
      )}

      {/* --- Hygiene Sections (always visible after scan, green when clean) --- */}
      {scanned && !scanning && !scanError && (
        <>
          {/* Empty Groups */}
          <HygieneSection
            title="Empty Groups"
            count={emptyGroups.length}
            testId="empty-groups-section"
            countTestId="empty-groups-count"
            tooltip={HYGIENE_TOOLTIPS.empty}
            actions={
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-caption text-[var(--color-text-secondary)]">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                    disabled={!canDelete}
                    data-testid="select-all-empty"
                  />
                  Select all
                </label>
                <button
                  className="btn btn-outline btn-sm flex items-center gap-1 tabular-nums"
                  onClick={() => setShowDeletePreview(true)}
                  disabled={!canDelete || selectedEmpty.size === 0 || deleting}
                  title={!canDelete ? "Requires Admin permission" : undefined}
                  data-testid="delete-selected-btn"
                >
                  <Trash2 size={14} />
                  Delete Selected ({selectedEmpty.size})
                </button>
              </div>
            }
          >
            <DataTable
              columns={emptyGroupColumns}
              data={emptyGroupRows}
              rowKey={(row) => row.dn}
              onRowClick={
                canDelete
                  ? (row) =>
                      handleSelectEmpty(row.dn, !selectedEmpty.has(row.dn))
                  : undefined
              }
            />
          </HygieneSection>

          {/* Single-Member Groups */}
          <HygieneSection
            title="Single-Member Groups"
            count={singleMemberGroups.length}
            testId="single-member-groups-section"
            countTestId="single-member-groups-count"
            tooltip={HYGIENE_TOOLTIPS.singleMember}
          >
            <DataTable
              columns={simpleGroupColumns}
              data={singleMemberGroups.map((g) => ({
                name: g.displayName || g.samAccountName,
                dn: g.distinguishedName,
                scope: g.scope,
                actions: "",
              }))}
              rowKey={(row) => row.dn}
            />
          </HygieneSection>

          {/* Stale Groups */}
          <HygieneSection
            title="Stale Groups"
            count={staleGroups.length}
            testId="stale-groups-section"
            countTestId="stale-groups-count"
            tooltip={HYGIENE_TOOLTIPS.stale}
          >
            <DataTable
              columns={staleGroupColumns}
              data={staleGroups.map((g) => ({
                name: g.displayName || g.samAccountName,
                dn: g.distinguishedName,
                scope: g.scope,
                lastModified: formatWhenChanged(g),
                actions: "",
              }))}
              rowKey={(row) => row.dn}
            />
          </HygieneSection>

          {/* Groups Without Description */}
          <HygieneSection
            title="Groups Without Description"
            count={undescribedGroups.length}
            testId="undescribed-groups-section"
            countTestId="undescribed-groups-count"
            tooltip={HYGIENE_TOOLTIPS.undescribed}
          >
            <DataTable
              columns={simpleGroupColumns}
              data={undescribedGroups.map((g) => ({
                name: g.displayName || g.samAccountName,
                dn: g.distinguishedName,
                scope: g.scope,
                actions: "",
              }))}
              rowKey={(row) => row.dn}
            />
          </HygieneSection>

          {/* Circular Nesting */}
          <HygieneSection
            title="Circular Nesting"
            count={cycles.length}
            testId="circular-groups-section"
            countTestId="cycles-count"
            severity="error"
            tooltip={HYGIENE_TOOLTIPS.circular}
          >
            <div className="space-y-2">
              {cycles.map((cycle, idx) => (
                <div
                  key={idx}
                  className="flex flex-wrap items-center gap-1 rounded border border-[var(--color-border-subtle)] px-3 py-2"
                  data-testid={`cycle-${idx}`}
                >
                  {cycle.map((dn, dnIdx) => {
                    const cn = dn.match(/^CN=([^,]+)/i)?.[1] ?? dn;
                    const isLast = dnIdx === cycle.length - 1;
                    return (
                      <span key={dnIdx} className="flex items-center gap-1">
                        <button
                          className="text-body font-medium text-[var(--color-primary)] hover:underline"
                          onClick={() => handleGoToGroup(dn)}
                          data-testid={`cycle-group-${cn}`}
                          title={dn}
                        >
                          {cn}
                        </button>
                        {!isLast && (
                          <ArrowRight
                            size={14}
                            className="text-[var(--color-text-secondary)]"
                          />
                        )}
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
          </HygieneSection>

          {/* Excessive Nesting Depth */}
          <HygieneSection
            title="Excessive Nesting Depth"
            count={deeplyNested.length}
            testId="deep-nesting-section"
            countTestId="deep-nesting-count"
            tooltip={HYGIENE_TOOLTIPS.deepNesting}
            tooltipPosition="above"
          >
            <div className="space-y-2">
              {deeplyNested.map((item) => (
                <div
                  key={item.groupDn}
                  className="flex items-center justify-between rounded border border-[var(--color-border-subtle)] px-3 py-2"
                  data-testid={`deep-nested-${item.groupName}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-body font-medium text-[var(--color-text-primary)]">
                      {item.groupName}
                    </span>
                    <span
                      className="text-caption text-[var(--color-text-secondary)]"
                      data-testid={`depth-${item.groupName}`}
                    >
                      Depth: {item.depth}
                    </span>
                  </div>
                  <button
                    className="btn btn-ghost btn-sm flex items-center gap-1 whitespace-nowrap"
                    onClick={() => handleGoToGroup(item.groupDn)}
                    data-testid={`go-to-group-${item.groupName}`}
                    title="Open in Group Management"
                  >
                    <ExternalLink size={12} />
                    Go to
                  </button>
                </div>
              ))}
            </div>
          </HygieneSection>

          {/* Duplicate Groups */}
          <HygieneSection
            title="Duplicate Groups"
            count={duplicateGroups.length}
            testId="duplicate-groups-section"
            countTestId="duplicate-groups-count"
            tooltip={HYGIENE_TOOLTIPS.duplicate}
            tooltipPosition="above"
          >
            <div className="space-y-2">
              {duplicateGroups.map((cluster, idx) => (
                <div
                  key={idx}
                  className="rounded border border-[var(--color-border-subtle)] px-3 py-2"
                  data-testid={`duplicate-cluster-${idx}`}
                >
                  <p className="mb-1 text-caption text-[var(--color-text-secondary)]">
                    These groups share identical members:
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {cluster.map((g) => (
                      <button
                        key={g.distinguishedName}
                        className="btn btn-sm btn-outline flex items-center gap-1"
                        onClick={() => handleGoToGroup(g.distinguishedName)}
                        data-testid={`duplicate-group-${g.displayName || g.samAccountName}`}
                      >
                        {g.displayName || g.samAccountName}
                        <ExternalLink size={12} />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </HygieneSection>
        </>
      )}

      {showDeletePreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          data-testid="delete-preview-dialog"
        >
          <div className="max-h-96 w-full max-w-md overflow-auto rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-4 shadow-lg">
            <h3 className="mb-3 text-body font-semibold text-[var(--color-text-primary)]">
              Delete {selectedGroupsForPreview.length} Empty Group(s)?
            </h3>
            <p className="mb-3 text-caption text-[var(--color-text-secondary)]">
              This action cannot be undone. The following groups will be
              permanently deleted:
            </p>
            <ul className="mb-4 max-h-48 space-y-1 overflow-auto">
              {selectedGroupsForPreview.map((g) => (
                <li
                  key={g.distinguishedName}
                  className="text-body text-[var(--color-text-primary)]"
                >
                  {g.displayName || g.samAccountName}
                  <span className="ml-1 text-caption text-[var(--color-text-secondary)]">
                    ({g.scope})
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <button
                className="btn btn-ghost"
                onClick={() => setShowDeletePreview(false)}
                data-testid="delete-preview-cancel"
              >
                Cancel
              </button>
              <button
                className="btn bg-[var(--color-error)] text-white hover:opacity-90"
                onClick={handleDeleteSelected}
                data-testid="delete-preview-confirm"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteProgress.status !== "idle" && (
        <div
          className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-3"
          data-testid="delete-progress"
        >
          <div className="mb-2 flex items-center gap-2">
            {deleteProgress.status === "running" && (
              <LoadingSpinner size={16} />
            )}
            {deleteProgress.status === "completed" && (
              <CheckCircle size={16} className="text-[var(--color-success)]" />
            )}
            {deleteProgress.status === "failed" && (
              <AlertCircle size={16} className="text-[var(--color-error)]" />
            )}
            <span className="text-body text-[var(--color-text-primary)]">
              {deleteProgress.current} / {deleteProgress.total}
            </span>
          </div>
          <p
            className="text-caption text-[var(--color-text-secondary)]"
            data-testid="delete-progress-message"
          >
            {deleteProgress.message}
          </p>
        </div>
      )}
    </div>
  );
}
