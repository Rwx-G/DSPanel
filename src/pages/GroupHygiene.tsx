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
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation(["groupHygiene"]);
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
                aria-label={t("aboutGroupHygiene")}
              >
                <Info size={13} />
              </button>
              {showTip && (
                <div className={`absolute left-0 z-50 w-80 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-3 shadow-lg ${tooltipPosition === "above" ? "bottom-full mb-1" : "top-full mt-1"}`}>
                  <p className="text-caption text-[var(--color-text-primary)]">
                    <strong>{t("what")}</strong> {tooltip.what}
                  </p>
                  <p className="mt-1 text-caption text-[var(--color-text-primary)]">
                    <strong>{t("why")}</strong> {tooltip.why}
                  </p>
                  <p className="mt-1 text-caption text-[var(--color-text-primary)]">
                    <strong>{t("fix")}</strong> {tooltip.fix}
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
          {t("allClear")}
        </p>
      ) : (
        <div className="mt-3">{children}</div>
      )}
    </div>
  );
}

function useHygieneTooltips() {
  const { t } = useTranslation(["groupHygiene"]);
  return {
    empty: {
      what: t("groupHygiene:tooltip.empty.what"),
      why: t("groupHygiene:tooltip.empty.why"),
      fix: t("groupHygiene:tooltip.empty.fix"),
      warn: t("groupHygiene:tooltip.empty.warn"),
    },
    singleMember: {
      what: t("groupHygiene:tooltip.singleMember.what"),
      why: t("groupHygiene:tooltip.singleMember.why"),
      fix: t("groupHygiene:tooltip.singleMember.fix"),
      warn: t("groupHygiene:tooltip.singleMember.warn"),
    },
    stale: {
      what: t("groupHygiene:tooltip.stale.what"),
      why: t("groupHygiene:tooltip.stale.why"),
      fix: t("groupHygiene:tooltip.stale.fix"),
    },
    undescribed: {
      what: t("groupHygiene:tooltip.undescribed.what"),
      why: t("groupHygiene:tooltip.undescribed.why"),
      fix: t("groupHygiene:tooltip.undescribed.fix"),
    },
    circular: {
      what: t("groupHygiene:tooltip.circular.what"),
      why: t("groupHygiene:tooltip.circular.why"),
      fix: t("groupHygiene:tooltip.circular.fix"),
      warn: t("groupHygiene:tooltip.circular.warn"),
    },
    deepNesting: {
      what: t("groupHygiene:tooltip.deepNesting.what"),
      why: t("groupHygiene:tooltip.deepNesting.why"),
      fix: t("groupHygiene:tooltip.deepNesting.fix"),
    },
    duplicate: {
      what: t("groupHygiene:tooltip.duplicate.what"),
      why: t("groupHygiene:tooltip.duplicate.why"),
      fix: t("groupHygiene:tooltip.duplicate.fix"),
      warn: t("groupHygiene:tooltip.duplicate.warn"),
    },
  };
}

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
  const { t } = useTranslation(["groupHygiene", "common", "sidebar"]);
  const HYGIENE_TOOLTIPS = useHygieneTooltips();
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
  const canDelete = hasPermission("AccountOperator");
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

      // Audit logging handled internally by the backend
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
      openTab(t("sidebar:groupManagement"), "groups", "users-group", {
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
        header: t("common:name"),
        sortable: true,
      },
      {
        key: "scope",
        header: t("common:scope"),
        sortable: true,
      },
      {
        key: "ou",
        header: t("organizationalUnit"),
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
            title={t("openInGroupManagement")}
          >
            <ExternalLink size={12} />
            {t("goTo")}
          </button>
        ),
      },
    );

    return cols;
  }, [canDelete, selectedEmpty, handleSelectEmpty, handleGoToGroup, t]);

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
      { key: "name", header: t("common:name"), sortable: true },
      { key: "scope", header: t("common:scope"), sortable: true },
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
            title={t("openInGroupManagement")}
          >
            <ExternalLink size={12} />
            {t("goTo")}
          </button>
        ),
      },
    ],
    [handleGoToGroup, t],
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
      { key: "name", header: t("common:name"), sortable: true },
      { key: "scope", header: t("common:scope"), sortable: true },
      { key: "lastModified", header: t("common:modified"), sortable: true },
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
            title={t("openInGroupManagement")}
          >
            <ExternalLink size={12} />
            {t("goTo")}
          </button>
        ),
      },
    ],
    [handleGoToGroup, t],
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
            {t("pageTitle")}
          </h2>
          <div className="relative">
            <button
              className="flex h-5 w-5 items-center justify-center rounded-full text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
              onClick={() => setShowInfo(!showInfo)}
              onBlur={() => setTimeout(() => setShowInfo(false), 150)}
              aria-label={t("aboutGroupHygiene")}
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
                  {t("scannerTitle")}
                </p>
                <ul className="space-y-1 text-caption text-[var(--color-text-secondary)]">
                  <li>{t("scannerDesc1")}</li>
                  <li>{t("scannerDesc2")}</li>
                  <li>{t("scannerDesc3")}</li>
                  <li>{t("scannerDesc4")}</li>
                  <li>{t("scannerDesc5")}</li>
                  <li>{t("scannerDesc6")}</li>
                  <li>{t("scannerDesc7")}</li>
                </ul>
                <p className="mt-1.5 text-caption text-[var(--color-text-disabled)]">
                  {t("scannerBulkDelete")}
                </p>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ExportToolbar<{ category: string; name: string; scope: string; detail: string }>
            columns={[
              { key: "category", header: t("exportColCategory") },
              { key: "name", header: t("exportColGroupName") },
              { key: "scope", header: t("exportColScope") },
              { key: "detail", header: t("exportColDetail") },
            ]}
            data={[
              ...emptyGroups.map((g) => ({ category: t("exportCategoryEmpty"), name: g.displayName || g.samAccountName, scope: g.scope, detail: t("exportDetailNoMembers") })),
              ...singleMemberGroups.map((g) => ({ category: t("exportCategorySingleMember"), name: g.displayName || g.samAccountName, scope: g.scope, detail: t("exportDetailOneMember") })),
              ...staleGroups.map((g) => ({ category: t("exportCategoryStale"), name: g.displayName || g.samAccountName, scope: g.scope, detail: t("exportDetailLastModified", { date: formatWhenChanged(g) }) })),
              ...undescribedGroups.map((g) => ({ category: t("exportCategoryNoDescription"), name: g.displayName || g.samAccountName, scope: g.scope, detail: "" })),
              ...cycles.map((chain) => ({ category: t("exportCategoryCircularNesting"), name: chain.join(" -> "), scope: "-", detail: t("exportDetailGroupsInCycle", { count: chain.length }) })),
              ...deeplyNested.map((d) => ({ category: t("exportCategoryExcessiveDepth"), name: d.groupName, scope: "-", detail: t("exportDetailDepthLevels", { depth: d.depth }) })),
              ...duplicateGroups.map((pair) => ({ category: t("exportCategoryDuplicateMembers"), name: pair.map((g) => g.displayName || g.samAccountName).join(" = "), scope: pair[0]?.scope ?? "-", detail: t("exportDetailIdenticalMembers", { count: pair.length }) })),
            ]}
            rowMapper={(row) => [row.category, row.name, row.scope, row.detail]}
            title={t("exportTitle")}
            filenameBase="group-hygiene"
            disabled={!scanned}
          />
          <button
            className="btn btn-primary btn-sm flex items-center gap-1.5"
            onClick={handleScan}
            disabled={scanning}
            data-testid="scan-button"
          >
            <Search size={14} />
            {scanning ? t("scanning") : t("runScan")}
          </button>
        </div>
      </div>

      {/* Placeholder containers before scan - same layout as populated sections but greyed out */}
      {!scanned && !scanning && !scanError && (
        <div className="space-y-4 opacity-50 pointer-events-none">
          {[
            { title: t("emptyGroups"), hint: t("emptyGroupsHint") },
            { title: t("singleMemberGroups"), hint: t("singleMemberGroupsHint") },
            { title: t("staleGroups"), hint: t("staleGroupsHint") },
            { title: t("undescribedGroups"), hint: t("undescribedGroupsHint") },
            { title: t("circularNesting"), hint: t("circularNestingHint") },
            { title: t("excessiveDepth"), hint: t("excessiveDepthHint") },
            { title: t("duplicateGroups"), hint: t("duplicateGroupsHint") },
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
                {t("runScanToDetect")}: {section.hint}
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
          <LoadingSpinner message={t("scanningMessage")} />
        </div>
      )}

      {scanError && (
        <div data-testid="scan-error">
          <EmptyState
            icon={<AlertCircle size={48} />}
            title={t("scanFailed")}
            description={scanError}
            action={{ label: t("common:retry"), onClick: handleScan }}
          />
        </div>
      )}

      {/* --- Hygiene Sections (always visible after scan, green when clean) --- */}
      {scanned && !scanning && !scanError && (
        <>
          {/* Empty Groups */}
          <HygieneSection
            title={t("emptyGroups")}
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
                  {t("selectAll")}
                </label>
                <button
                  className="btn btn-outline btn-sm flex items-center gap-1 tabular-nums"
                  onClick={() => setShowDeletePreview(true)}
                  disabled={!canDelete || selectedEmpty.size === 0 || deleting}
                  title={!canDelete ? t("requiresAdmin") : undefined}
                  data-testid="delete-selected-btn"
                >
                  <Trash2 size={14} />
                  {t("deleteSelected", { count: selectedEmpty.size })}
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
            title={t("singleMemberGroups")}
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
            title={t("staleGroups")}
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
            title={t("undescribedGroups")}
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
            title={t("circularNesting")}
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
            title={t("excessiveDepth")}
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
                      {t("depth", { depth: item.depth })}
                    </span>
                  </div>
                  <button
                    className="btn btn-ghost btn-sm flex items-center gap-1 whitespace-nowrap"
                    onClick={() => handleGoToGroup(item.groupDn)}
                    data-testid={`go-to-group-${item.groupName}`}
                    title={t("openInGroupManagement")}
                  >
                    <ExternalLink size={12} />
                    {t("goTo")}
                  </button>
                </div>
              ))}
            </div>
          </HygieneSection>

          {/* Duplicate Groups */}
          <HygieneSection
            title={t("duplicateGroups")}
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
                    {t("identicalMembers")}:
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
              {t("deleteConfirmTitle", { count: selectedGroupsForPreview.length })}
            </h3>
            <p className="mb-3 text-caption text-[var(--color-text-secondary)]">
              {t("deleteConfirmMessage")}
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
                {t("common:cancel")}
              </button>
              <button
                className="btn bg-[var(--color-error)] text-white hover:opacity-90"
                onClick={handleDeleteSelected}
                data-testid="delete-preview-confirm"
              >
                {t("common:delete")}
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
