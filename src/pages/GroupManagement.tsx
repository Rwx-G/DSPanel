import { useState, useCallback, useEffect, useRef, useMemo, useId } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { SearchBar } from "@/components/common/SearchBar";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { EmptyState } from "@/components/common/EmptyState";
import { TruncatedBanner } from "@/components/common/TruncatedBanner";
import { VirtualizedList } from "@/components/data/VirtualizedList";
import {
  type DirectoryEntry,
  type DirectoryGroup,
  mapEntryToGroup,
} from "@/types/directory";
import { parseCnFromDn } from "@/utils/dn";
import { useGroupBrowse } from "@/hooks/useGroupBrowse";
import { useNavigation } from "@/contexts/NavigationContext";
import { usePermissions } from "@/hooks/usePermissions";
import { GroupDetail } from "@/pages/GroupDetail";
import {
  ContextMenu,
  type ContextMenuItem,
} from "@/components/common/ContextMenu";
import {
  MoveObjectDialog,
  type MoveTarget,
} from "@/components/dialogs/MoveObjectDialog";
import { Users, AlertCircle, Shield, Mail, FolderInput } from "lucide-react";
import { useTranslation } from "react-i18next";

const SCOPE_KEYS: Record<string, string> = {
  Global: "scopeGlobal",
  DomainLocal: "scopeDomainLocal",
  Universal: "scopeUniversal",
  Unknown: "scopeUnknown",
};

const CATEGORY_COLORS: Record<string, string> = {
  Security: "bg-[var(--color-info)]/10 text-[var(--color-info)]",
  Distribution: "bg-[var(--color-warning)]/10 text-[var(--color-warning)]",
};

const SCOPE_COLORS: Record<string, string> = {
  Global: "bg-[var(--color-success)]/10 text-[var(--color-success)]",
  DomainLocal: "bg-[var(--color-surface-hover)] text-[var(--color-text-primary)]",
  Universal: "bg-[var(--color-primary-subtle)] text-[var(--color-primary)]",
  Unknown: "bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]",
};

function GroupBadge({ group }: { group: DirectoryGroup }) {
  const { t } = useTranslation(["groupManagement", "common"]);
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipId = useId();
  const badgeRef = useRef<HTMLDivElement>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!showTooltip || !badgeRef.current) {
      setTooltipPos(null);
      return;
    }
    const rect = badgeRef.current.getBoundingClientRect();
    const tooltipWidth = 200;
    let left = rect.left + rect.width / 2 - tooltipWidth / 2;
    let top = rect.bottom + 4;
    if (left < 4) left = 4;
    if (left + tooltipWidth > window.innerWidth - 4) left = window.innerWidth - tooltipWidth - 4;
    if (top + 80 > window.innerHeight) top = rect.top - 4;
    setTooltipPos({ top, left });
  }, [showTooltip]);

  const isSecurity = group.category === "Security";
  const CategoryIcon = isSecurity ? Shield : Mail;
  const scopeAbbr =
    group.scope === "DomainLocal" ? "DL" : group.scope === "Universal" ? "U" : "G";

  return (
    <>
      <div
        ref={badgeRef}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className="inline-flex shrink-0 items-center gap-1"
        aria-describedby={showTooltip ? tooltipId : undefined}
      >
        <span className={`inline-flex items-center rounded-full p-1 ${CATEGORY_COLORS[group.category] || ""}`}>
          <CategoryIcon size={10} />
        </span>
        <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${SCOPE_COLORS[group.scope] || SCOPE_COLORS.Unknown}`}>
          {scopeAbbr}
        </span>
      </div>
      {showTooltip &&
        tooltipPos &&
        createPortal(
          <div
            id={tooltipId}
            role="tooltip"
            className="fixed z-50 w-[200px] rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-2 shadow-lg"
            style={{ top: tooltipPos.top, left: tooltipPos.left }}
          >
            <ul className="space-y-1">
              <li className="flex items-center gap-1.5">
                <CategoryIcon size={12} className={`mr-1 shrink-0 ${isSecurity ? "text-[var(--color-info)]" : "text-[var(--color-warning)]"}`} />
                <span className="text-caption font-medium text-[var(--color-text-primary)]">{t(`common:${group.category.toLowerCase()}`)}</span>
              </li>
              <li className="flex items-center gap-1.5">
                <Users size={12} className="mr-1 shrink-0 text-[var(--color-text-secondary)]" />
                <div>
                  <span className="text-caption font-medium text-[var(--color-text-primary)]">{t(SCOPE_KEYS[group.scope] || "scopeUnknown")}</span>
                  <p className="text-[10px] text-[var(--color-text-secondary)]">{t("common:scope")}</p>
                </div>
              </li>
              <li className="flex items-center gap-1.5">
                <Users size={12} className="mr-1 shrink-0 text-[var(--color-text-secondary)]" />
                <span className="text-caption font-medium text-[var(--color-text-primary)]">{t("common:member", { count: group.memberCount })}</span>
              </li>
            </ul>
          </div>,
          document.body,
        )}
    </>
  );
}

export function GroupManagement() {
  const { t } = useTranslation(["groupManagement", "common"]);
  const {
    items: groups,
    loading,
    loadingMore,
    error,
    hasMore,
    truncated,
    filterText,
    setFilterText,
    loadMore,
    selectedItem: selectedGroup,
    setSelectedItem: setSelectedGroup,
    refresh,
  } = useGroupBrowse();

  const { openTabs, activeTabId, clearTabData } = useNavigation();
  const activeTab = openTabs.find((t) => t.id === activeTabId);
  const selectedGroupDn = activeTab?.data?.selectedGroupDn as
    | string
    | undefined;

  const { hasPermission } = usePermissions();
  const canManageMembers = hasPermission("AccountOperator");
  const canMove = hasPermission("AccountOperator");
  const [moveTargets, setMoveTargets] = useState<MoveTarget[] | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [contextMenuItems, setContextMenuItems] = useState<ContextMenuItem[]>(
    [],
  );

  const [members, setMembers] = useState<DirectoryEntry[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<"all" | "Security" | "Distribution">("all");

  const filteredGroups = useMemo(() => {
    if (categoryFilter === "all") return groups;
    return groups.filter((g) => g.category === categoryFilter);
  }, [groups, categoryFilter]);

  const categoryCounts = useMemo(() => {
    let security = 0, distribution = 0;
    for (const g of groups) {
      if (g.category === "Security") security++;
      else distribution++;
    }
    return { security, distribution };
  }, [groups]);

  // Handle cross-module deep-linking: select group by DN
  const deepLinkHandled = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedGroupDn || deepLinkHandled.current === selectedGroupDn) return;

    const found = groups.find((g) => g.distinguishedName === selectedGroupDn);
    if (found) {
      setSelectedGroup(found);
      deepLinkHandled.current = selectedGroupDn;
      if (activeTabId) clearTabData(activeTabId);
      return;
    }

    if (!loading) {
      const cn = parseCnFromDn(selectedGroupDn);
      if (!cn) return;

      invoke<DirectoryEntry[]>("search_groups", { query: cn })
        .then((entries) => {
          const match = entries.find(
            (e) => e.distinguishedName === selectedGroupDn,
          );
          if (match) {
            setSelectedGroup(mapEntryToGroup(match));
          }
        })
        .catch((err) => console.warn("Deep-link group search failed:", err))
        .finally(() => {
          deepLinkHandled.current = selectedGroupDn;
          if (activeTabId) clearTabData(activeTabId);
        });
    }
  }, [
    selectedGroupDn,
    groups,
    loading,
    setSelectedGroup,
    activeTabId,
    clearTabData,
  ]);

  // Load members when a group is selected
  const loadMembers = useCallback(() => {
    if (!selectedGroup) {
      setMembers([]);
      return;
    }

    setMembersLoading(true);
    invoke<DirectoryEntry[]>("get_group_members", {
      groupDn: selectedGroup.distinguishedName,
    })
      .then((result) => {
        setMembers(result);
      })
      .catch((err) => {
        console.warn("Failed to load group members:", err);
        setMembers([]);
      })
      .finally(() => {
        setMembersLoading(false);
      });
  }, [selectedGroup]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  const handleFilterChange = useCallback(
    (query: string) => {
      setFilterText(query);
    },
    [setFilterText],
  );

  const handleGroupContextMenu = useCallback(
    (e: React.MouseEvent, group: DirectoryGroup) => {
      e.preventDefault();
      const items: ContextMenuItem[] = [];
      if (canMove) {
        items.push({
          label: t("common:moveToOu"),
          icon: <FolderInput size={14} />,
          onClick: () => {
            setMoveTargets([
              {
                distinguishedName: group.distinguishedName,
                displayName: group.displayName || group.samAccountName,
              },
            ]);
          },
        });
      }
      if (items.length > 0) {
        setContextMenuItems(items);
        setContextMenuPos({ x: e.clientX, y: e.clientY });
      }
    },
    [canMove],
  );

  const renderGroupItem = useCallback(
    (group: DirectoryGroup) => (
      <button
        className={`flex w-full items-center gap-2 border-b border-[var(--color-border-subtle)] px-3 py-2 text-left transition-colors hover:bg-[var(--color-surface-hover)] ${
          selectedGroup?.distinguishedName === group.distinguishedName
            ? "bg-[var(--color-surface-selected)]"
            : ""
        }`}
        onClick={() => setSelectedGroup(group)}
        onContextMenu={(e) => handleGroupContextMenu(e, group)}
        data-testid={`group-result-${group.samAccountName}`}
      >
        <Users
          size={16}
          className="shrink-0 text-[var(--color-text-secondary)]"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-medium text-[var(--color-text-primary)]">
            {group.displayName || group.samAccountName}
          </p>
          <p className="truncate text-caption text-[var(--color-text-secondary)]">
            {group.scope} {group.category} - {t("common:member", { count: group.memberCount })}
          </p>
        </div>
        <GroupBadge group={group} />
      </button>
    ),
    [selectedGroup, setSelectedGroup, handleGroupContextMenu],
  );

  return (
    <div className="flex h-full flex-col" data-testid="group-management">
      <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] px-3 py-2">
        <div className="flex-1">
          <SearchBar
            value={filterText}
            onChange={handleFilterChange}
            onSearch={handleFilterChange}
            placeholder={t("searchPlaceholder")}
            debounceMs={300}
          />
        </div>
        <div className="flex items-center gap-1">
          {(
            [
              { key: "all", label: t("all") },
              { key: "Security", label: t("common:security") },
              { key: "Distribution", label: t("common:distribution") },
            ] as const
          ).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setCategoryFilter(key)}
              className={`btn btn-sm ${
                categoryFilter === key ? "btn-outline" : "btn-ghost"
              }`}
            >
              {label}
              {key !== "all" && (
                <span className="ml-1 opacity-70">
                  ({key === "Security" ? categoryCounts.security : categoryCounts.distribution})
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div
        className="sr-only"
        aria-live="polite"
        data-testid="group-management-status"
      >
        {loading && t("loadingGroups")}
        {!loading &&
          filteredGroups.length > 0 &&
          t("found", { count: filteredGroups.length })}
        {!loading && filteredGroups.length === 0 && !error && t("noGroupsFound")}
        {error && `${t("common:error")}: ${error}`}
      </div>

      {truncated && (
        <div className="px-3 pt-2">
          <TruncatedBanner truncated={truncated} />
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {loading && (
          <div
            className="flex flex-1 items-center justify-center"
            data-testid="group-management-loading"
          >
            <LoadingSpinner message={t("loadingGroups")} />
          </div>
        )}

        {!loading && error && (
          <div
            className="flex flex-1 items-center justify-center"
            data-testid="group-management-error"
          >
            <EmptyState
              icon={<AlertCircle size={48} />}
              title={t("failedToLoad")}
              description={error}
              action={{ label: t("common:retry"), onClick: refresh }}
            />
          </div>
        )}

        {!loading && !error && filteredGroups.length === 0 && (
          <div
            className="flex flex-1 items-center justify-center"
            data-testid="group-management-empty"
          >
            <EmptyState
              icon={<Users size={48} />}
              title={t("noGroupsFound")}
              description={
                categoryFilter !== "all"
                  ? categoryFilter === "Security" ? t("noSecurityGroups") : t("noDistributionGroups")
                  : filterText
                    ? t("noGroupsMatch", { filter: filterText })
                    : t("noGroupsFound")
              }
            />
          </div>
        )}

        {!loading && !error && filteredGroups.length > 0 && (
          <>
            <div className="flex w-64 shrink-0 flex-col overflow-hidden border-r border-[var(--color-border-subtle)]">
              <div
                className="flex-1 overflow-hidden"
                data-testid="group-results-list"
              >
                <VirtualizedList
                  items={filteredGroups}
                  renderItem={renderGroupItem}
                  estimateSize={52}
                  itemKey={(group) => group.distinguishedName}
                  loadingMore={loadingMore}
                  onEndReached={hasMore ? loadMore : undefined}
                  className="h-full"
                />
              </div>
            </div>

            <div
              className="flex-1 overflow-auto p-4"
              data-testid="group-detail-panel"
            >
              {selectedGroup ? (
                <GroupDetail
                  group={selectedGroup}
                  members={members}
                  membersLoading={membersLoading}
                  canManageMembers={canManageMembers}
                  onMembersRefresh={loadMembers}
                  onDeleted={() => {
                    setSelectedGroup(null);
                    refresh();
                  }}
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <p className="text-body text-[var(--color-text-secondary)]">
                    {t("selectGroup")}
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <ContextMenu
        items={contextMenuItems}
        position={contextMenuPos}
        onClose={() => setContextMenuPos(null)}
      />

      {moveTargets && (
        <MoveObjectDialog
          targets={moveTargets}
          onClose={() => setMoveTargets(null)}
          onMoved={refresh}
        />
      )}
    </div>
  );
}
