import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SearchBar } from "@/components/common/SearchBar";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { EmptyState } from "@/components/common/EmptyState";
import { StatusBadge } from "@/components/common/StatusBadge";
import { VirtualizedList } from "@/components/data/VirtualizedList";
import { TreeView, type TreeNode } from "@/components/data/TreeView";
import {
  type DirectoryEntry,
  type DirectoryGroup,
  mapEntryToGroup,
} from "@/types/directory";
import { parseCnFromDn } from "@/utils/dn";
import { useGroupBrowse } from "@/hooks/useGroupBrowse";
import { useOUTree } from "@/hooks/useOUTree";
import { useNavigation } from "@/contexts/NavigationContext";
import { usePermissions } from "@/hooks/usePermissions";
import { type OUNode } from "@/components/form/OUPicker";
import { BulkOperations } from "@/pages/BulkOperations";
import { GroupHygiene } from "@/pages/GroupHygiene";
import { GroupDetail } from "@/pages/GroupDetail";
import {
  Users,
  AlertCircle,
  FolderTree,
  List,
  Layers,
  ShieldAlert,
} from "lucide-react";

type ViewMode = "flat" | "tree" | "bulk" | "hygiene";

function ouNodesToTreeNodes(nodes: OUNode[]): TreeNode[] {
  return nodes.map((ou) => ({
    id: ou.distinguishedName,
    label: ou.name,
    hasChildren: ou.hasChildren,
    children: ou.children ? ouNodesToTreeNodes(ou.children) : undefined,
  }));
}

export function GroupManagement() {
  const {
    items: groups,
    loading,
    loadingMore,
    error,
    hasMore,
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

  const [viewMode, setViewMode] = useState<ViewMode>("flat");
  const [selectedOU, setSelectedOU] = useState<string | null>(null);
  const [members, setMembers] = useState<DirectoryEntry[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);

  const { nodes: ouNodes, loading: ouLoading, error: ouError } = useOUTree();

  const treeNodes = useMemo(() => ouNodesToTreeNodes(ouNodes), [ouNodes]);

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

  const filteredGroupsForOU = useMemo(() => {
    if (!selectedOU) return groups;
    return groups.filter((g) =>
      g.distinguishedName.toLowerCase().includes(selectedOU.toLowerCase()),
    );
  }, [groups, selectedOU]);

  const handleOUSelect = useCallback((id: string) => {
    setSelectedOU(id);
  }, []);

  const renderGroupItem = useCallback(
    (group: DirectoryGroup) => (
      <button
        className={`flex w-full items-center gap-2 border-b border-[var(--color-border-subtle)] px-3 py-2 text-left transition-colors hover:bg-[var(--color-surface-hover)] ${
          selectedGroup?.distinguishedName === group.distinguishedName
            ? "bg-[var(--color-surface-selected)]"
            : ""
        }`}
        onClick={() => setSelectedGroup(group)}
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
            {group.scope} {group.category} - {group.memberCount} member(s)
          </p>
        </div>
        <StatusBadge
          text={group.category}
          variant={group.category === "Security" ? "neutral" : "warning"}
        />
      </button>
    ),
    [selectedGroup, setSelectedGroup],
  );

  const displayedGroups = viewMode === "tree" ? filteredGroupsForOU : groups;
  const isListView = viewMode === "flat" || viewMode === "tree";

  return (
    <div className="flex h-full flex-col" data-testid="group-management">
      <div className="border-b border-[var(--color-border-subtle)] p-3">
        <SearchBar
          value={filterText}
          onChange={handleFilterChange}
          onSearch={handleFilterChange}
          placeholder="Search groups by name or description..."
          debounceMs={300}
        />
      </div>

      <div
        className="sr-only"
        aria-live="polite"
        data-testid="group-management-status"
      >
        {loading && "Loading groups..."}
        {!loading &&
          groups.length > 0 &&
          `${groups.length} group${groups.length > 1 ? "s" : ""} found`}
        {!loading && groups.length === 0 && !error && "No groups found"}
        {error && `Error: ${error}`}
      </div>

      <div className="flex items-center gap-1 border-b border-[var(--color-border-subtle)] px-3 py-1.5">
        <button
          className={`btn btn-ghost flex h-8 w-8 items-center justify-center rounded-md p-0 ${
            viewMode === "flat"
              ? "bg-[var(--color-surface-selected)] text-[var(--color-primary)]"
              : ""
          }`}
          onClick={() => setViewMode("flat")}
          title="Flat view"
          data-testid="view-toggle-flat"
        >
          <List size={16} />
        </button>
        <button
          className={`btn btn-ghost flex h-8 w-8 items-center justify-center rounded-md p-0 ${
            viewMode === "tree"
              ? "bg-[var(--color-surface-selected)] text-[var(--color-primary)]"
              : ""
          }`}
          onClick={() => setViewMode("tree")}
          title="Tree view"
          data-testid="view-toggle-tree"
        >
          <FolderTree size={16} />
        </button>
        {canManageMembers && (
          <>
            <div className="mx-1 h-4 w-px bg-[var(--color-border-subtle)]" />
            <button
              className={`btn btn-ghost flex h-8 w-8 items-center justify-center rounded-md p-0 ${
                viewMode === "bulk"
                  ? "bg-[var(--color-surface-selected)] text-[var(--color-primary)]"
                  : ""
              }`}
              onClick={() => setViewMode("bulk")}
              title="Bulk operations"
              data-testid="view-toggle-bulk"
            >
              <Layers size={16} />
            </button>
            <button
              className={`btn btn-ghost flex h-8 w-8 items-center justify-center rounded-md p-0 ${
                viewMode === "hygiene"
                  ? "bg-[var(--color-surface-selected)] text-[var(--color-primary)]"
                  : ""
              }`}
              onClick={() => setViewMode("hygiene")}
              title="Group hygiene"
              data-testid="view-toggle-hygiene"
            >
              <ShieldAlert size={16} />
            </button>
          </>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {viewMode === "bulk" && (
          <div
            className="flex-1 overflow-hidden"
            data-testid="bulk-operations-view"
          >
            <BulkOperations />
          </div>
        )}

        {viewMode === "hygiene" && (
          <div className="flex-1 overflow-hidden" data-testid="hygiene-view">
            <GroupHygiene />
          </div>
        )}

        {isListView && loading && (
          <div
            className="flex flex-1 items-center justify-center"
            data-testid="group-management-loading"
          >
            <LoadingSpinner message="Loading groups..." />
          </div>
        )}

        {isListView && !loading && error && (
          <div
            className="flex flex-1 items-center justify-center"
            data-testid="group-management-error"
          >
            <EmptyState
              icon={<AlertCircle size={48} />}
              title="Failed to load groups"
              description={error}
              action={{ label: "Retry", onClick: refresh }}
            />
          </div>
        )}

        {isListView && !loading && !error && displayedGroups.length === 0 && (
          <div
            className="flex flex-1 items-center justify-center"
            data-testid="group-management-empty"
          >
            <EmptyState
              icon={<Users size={48} />}
              title="No groups found"
              description={
                filterText
                  ? `No groups match "${filterText}".`
                  : "No groups available."
              }
            />
          </div>
        )}

        {isListView && !loading && !error && displayedGroups.length > 0 && (
          <>
            <div className="flex w-64 shrink-0 flex-col overflow-hidden border-r border-[var(--color-border-subtle)]">
              {viewMode === "tree" && (
                <div
                  className="overflow-auto border-b border-[var(--color-border-subtle)] p-2"
                  data-testid="group-tree-panel"
                  style={{ maxHeight: "40%" }}
                >
                  {ouLoading && <LoadingSpinner message="Loading OU tree..." />}
                  {ouError && (
                    <p className="text-caption text-[var(--color-text-secondary)]">
                      Failed to load OU tree
                    </p>
                  )}
                  {!ouLoading && !ouError && (
                    <TreeView
                      nodes={treeNodes}
                      selectedIds={
                        selectedOU ? new Set([selectedOU]) : new Set()
                      }
                      onSelect={handleOUSelect}
                    />
                  )}
                </div>
              )}
              <div
                className="flex-1 overflow-hidden"
                data-testid="group-results-list"
              >
                <VirtualizedList
                  items={displayedGroups}
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
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <p className="text-body text-[var(--color-text-secondary)]">
                    Select a group to view details
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
