import { useState, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { EmptyState } from "@/components/common/EmptyState";
import { DataTable, type Column } from "@/components/data/DataTable";
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
} from "lucide-react";

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
  const canDelete = hasPermission("DomainAdmin");
  const { openTab } = useNavigation();

  const totalIssues =
    emptyGroups.length +
    cycles.length +
    singleMemberGroups.length +
    staleGroups.length +
    undescribedGroups.length +
    deeplyNested.length +
    duplicateGroups.length;

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
      openTab("Group Management", "group-management", "Users", {
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
        width: 80,
        resizable: false,
        render: (_value, row) => (
          <button
            className="btn btn-ghost flex items-center gap-1 text-caption"
            onClick={() => handleGoToGroup(row.dn)}
            data-testid={`go-to-group-${row.name}`}
            title="Go to group"
          >
            <ExternalLink size={14} />
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
        width: 80,
        resizable: false,
        render: (_value: string, row: SimpleGroupRow) => (
          <button
            className="btn btn-ghost flex items-center gap-1 text-caption"
            onClick={() => handleGoToGroup(row.dn)}
            data-testid={`go-to-group-${row.name}`}
            title="Go to group"
          >
            <ExternalLink size={14} />
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
        width: 80,
        resizable: false,
        render: (_value: string, row: StaleGroupRow) => (
          <button
            className="btn btn-ghost flex items-center gap-1 text-caption"
            onClick={() => handleGoToGroup(row.dn)}
            data-testid={`go-to-group-${row.name}`}
            title="Go to group"
          >
            <ExternalLink size={14} />
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
                <p className="text-caption font-semibold text-[var(--color-text-primary)] mb-1">
                  Group Hygiene Scanner
                </p>
                <p className="text-caption text-[var(--color-text-secondary)]">
                  Scan your domain to detect empty groups, single-member groups,
                  stale groups, groups without description, circular nesting, and
                  excessive nesting depth. Empty groups can be cleaned up in bulk
                  if you have DomainAdmin permissions.
                </p>
              </div>
            )}
          </div>
        </div>
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

      {/* Placeholder containers before scan */}
      {!scanned && !scanning && !scanError && (
        <>
          <div className="rounded-lg border border-dashed border-[var(--color-border-default)] bg-[var(--color-surface-bg)] p-4 opacity-60">
            <div className="mb-2 flex items-center gap-2">
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-text-disabled)] px-1.5 text-caption font-medium text-white">
                -
              </span>
              <h3 className="text-body font-semibold text-[var(--color-text-secondary)]">
                Empty Groups
              </h3>
            </div>
            <p className="text-caption text-[var(--color-text-disabled)]">
              Run scan to detect groups with no members
            </p>
          </div>
          <div className="rounded-lg border border-dashed border-[var(--color-border-default)] bg-[var(--color-surface-bg)] p-4 opacity-60">
            <div className="mb-2 flex items-center gap-2">
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-text-disabled)] px-1.5 text-caption font-medium text-white">
                -
              </span>
              <h3 className="text-body font-semibold text-[var(--color-text-secondary)]">
                Single-Member Groups
              </h3>
            </div>
            <p className="text-caption text-[var(--color-text-disabled)]">
              Run scan to detect groups with only one member
            </p>
          </div>
          <div className="rounded-lg border border-dashed border-[var(--color-border-default)] bg-[var(--color-surface-bg)] p-4 opacity-60">
            <div className="mb-2 flex items-center gap-2">
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-text-disabled)] px-1.5 text-caption font-medium text-white">
                -
              </span>
              <h3 className="text-body font-semibold text-[var(--color-text-secondary)]">
                Stale Groups
              </h3>
            </div>
            <p className="text-caption text-[var(--color-text-disabled)]">
              Run scan to detect groups not modified in over 180 days
            </p>
          </div>
          <div className="rounded-lg border border-dashed border-[var(--color-border-default)] bg-[var(--color-surface-bg)] p-4 opacity-60">
            <div className="mb-2 flex items-center gap-2">
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-text-disabled)] px-1.5 text-caption font-medium text-white">
                -
              </span>
              <h3 className="text-body font-semibold text-[var(--color-text-secondary)]">
                Groups Without Description
              </h3>
            </div>
            <p className="text-caption text-[var(--color-text-disabled)]">
              Run scan to detect groups missing a description
            </p>
          </div>
          <div className="rounded-lg border border-dashed border-[var(--color-border-default)] bg-[var(--color-surface-bg)] p-4 opacity-60">
            <div className="mb-2 flex items-center gap-2">
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-text-disabled)] px-1.5 text-caption font-medium text-white">
                -
              </span>
              <h3 className="text-body font-semibold text-[var(--color-text-secondary)]">
                Circular Nesting
              </h3>
            </div>
            <p className="text-caption text-[var(--color-text-disabled)]">
              Run scan to detect circular group nesting
            </p>
          </div>
          <div className="rounded-lg border border-dashed border-[var(--color-border-default)] bg-[var(--color-surface-bg)] p-4 opacity-60">
            <div className="mb-2 flex items-center gap-2">
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-text-disabled)] px-1.5 text-caption font-medium text-white">
                -
              </span>
              <h3 className="text-body font-semibold text-[var(--color-text-secondary)]">
                Excessive Nesting Depth
              </h3>
            </div>
            <p className="text-caption text-[var(--color-text-disabled)]">
              Run scan to detect groups nested deeper than 3 levels
            </p>
          </div>
          <div className="rounded-lg border border-dashed border-[var(--color-border-default)] bg-[var(--color-surface-bg)] p-4 opacity-60">
            <div className="mb-2 flex items-center gap-2">
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-text-disabled)] px-1.5 text-caption font-medium text-white">
                -
              </span>
              <h3 className="text-body font-semibold text-[var(--color-text-secondary)]">
                Duplicate Groups
              </h3>
            </div>
            <p className="text-caption text-[var(--color-text-disabled)]">
              Run scan to detect groups with identical members
            </p>
          </div>
        </>
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

      {scanned && !scanning && !scanError && totalIssues === 0 && (
        <div
          className="flex flex-col items-center justify-center py-8"
          data-testid="no-issues"
        >
          <CheckCircle
            size={48}
            className="mb-2 text-[var(--color-success)]"
          />
          <p className="text-body font-medium text-[var(--color-text-primary)]">
            No issues found
          </p>
          <p className="text-caption text-[var(--color-text-secondary)]">
            All groups are healthy.
          </p>
        </div>
      )}

      {/* Empty Groups */}
      {scanned && !scanning && emptyGroups.length > 0 && (
        <div
          className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-3"
          data-testid="empty-groups-section"
        >
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-body font-semibold text-[var(--color-text-primary)]">
              Empty Groups
              <span
                className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-warning)] px-1.5 text-caption font-medium text-white"
                data-testid="empty-groups-count"
              >
                {emptyGroups.length}
              </span>
            </h3>
            <div className="flex items-center gap-2">
              {canDelete && emptyGroups.length > 0 && (
                <label className="flex items-center gap-1.5 text-caption text-[var(--color-text-secondary)]">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                    data-testid="select-all-empty"
                  />
                  Select all
                </label>
              )}
              {canDelete && selectedEmpty.size > 0 && (
                <button
                  className="btn btn-secondary flex items-center gap-1 text-caption"
                  onClick={() => setShowDeletePreview(true)}
                  disabled={deleting}
                  data-testid="delete-selected-btn"
                >
                  <Trash2 size={14} />
                  Delete Selected ({selectedEmpty.size})
                </button>
              )}
            </div>
          </div>
          <DataTable
            columns={emptyGroupColumns}
            data={emptyGroupRows}
            rowKey={(row) => row.dn}
          />
        </div>
      )}

      {/* Single-Member Groups */}
      {scanned && !scanning && singleMemberGroups.length > 0 && (
        <div
          className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-3"
          data-testid="single-member-groups-section"
        >
          <h3 className="mb-3 flex items-center gap-2 text-body font-semibold text-[var(--color-text-primary)]">
            Single-Member Groups
            <span
              className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-warning)] px-1.5 text-caption font-medium text-white"
              data-testid="single-member-groups-count"
            >
              {singleMemberGroups.length}
            </span>
          </h3>
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
        </div>
      )}

      {/* Stale Groups */}
      {scanned && !scanning && staleGroups.length > 0 && (
        <div
          className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-3"
          data-testid="stale-groups-section"
        >
          <h3 className="mb-3 flex items-center gap-2 text-body font-semibold text-[var(--color-text-primary)]">
            Stale Groups
            <span
              className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-warning)] px-1.5 text-caption font-medium text-white"
              data-testid="stale-groups-count"
            >
              {staleGroups.length}
            </span>
          </h3>
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
        </div>
      )}

      {/* Groups Without Description */}
      {scanned && !scanning && undescribedGroups.length > 0 && (
        <div
          className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-3"
          data-testid="undescribed-groups-section"
        >
          <h3 className="mb-3 flex items-center gap-2 text-body font-semibold text-[var(--color-text-primary)]">
            Groups Without Description
            <span
              className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-warning)] px-1.5 text-caption font-medium text-white"
              data-testid="undescribed-groups-count"
            >
              {undescribedGroups.length}
            </span>
          </h3>
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
        </div>
      )}

      {/* Circular Nesting */}
      {scanned && !scanning && cycles.length > 0 && (
        <div
          className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-3"
          data-testid="circular-groups-section"
        >
          <h3 className="mb-3 flex items-center gap-2 text-body font-semibold text-[var(--color-text-primary)]">
            Circular Nesting
            <span
              className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-error)] px-1.5 text-caption font-medium text-white"
              data-testid="cycles-count"
            >
              {cycles.length}
            </span>
          </h3>
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
        </div>
      )}

      {/* Excessive Nesting Depth */}
      {scanned && !scanning && deeplyNested.length > 0 && (
        <div
          className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-3"
          data-testid="deep-nesting-section"
        >
          <h3 className="mb-3 flex items-center gap-2 text-body font-semibold text-[var(--color-text-primary)]">
            Excessive Nesting Depth
            <span
              className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-warning)] px-1.5 text-caption font-medium text-white"
              data-testid="deep-nesting-count"
            >
              {deeplyNested.length}
            </span>
          </h3>
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
                  className="btn btn-ghost flex items-center gap-1 text-caption"
                  onClick={() => handleGoToGroup(item.groupDn)}
                  data-testid={`go-to-group-${item.groupName}`}
                  title="Go to group"
                >
                  <ExternalLink size={14} />
                  Go to
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Duplicate Groups */}
      {scanned && !scanning && duplicateGroups.length > 0 && (
        <div
          className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-3"
          data-testid="duplicate-groups-section"
        >
          <h3 className="mb-3 flex items-center gap-2 text-body font-semibold text-[var(--color-text-primary)]">
            Duplicate Groups
            <span
              className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-warning)] px-1.5 text-caption font-medium text-white"
              data-testid="duplicate-groups-count"
            >
              {duplicateGroups.length}
            </span>
          </h3>
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
        </div>
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
