import { useState, useCallback, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SearchBar } from "@/components/common/SearchBar";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { EmptyState } from "@/components/common/EmptyState";
import { VirtualizedList } from "@/components/data/VirtualizedList";
import { TreeView, type TreeNode } from "@/components/data/TreeView";
import { DataTable, type Column } from "@/components/data/DataTable";
import { type DirectoryEntry, type DirectoryGroup } from "@/types/directory";
import { parseCnFromDn } from "@/utils/dn";
import { useGroupBrowse } from "@/hooks/useGroupBrowse";
import { useOUTree } from "@/hooks/useOUTree";
import { useNavigation } from "@/contexts/NavigationContext";
import { type OUNode } from "@/components/form/OUPicker";
import { Users, AlertCircle, FolderTree, List } from "lucide-react";

type ViewMode = "flat" | "tree";

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

  const { openTabs, activeTabId } = useNavigation();
  const activeTab = openTabs.find((t) => t.id === activeTabId);
  const selectedGroupDn = activeTab?.data?.selectedGroupDn as
    | string
    | undefined;

  const [viewMode, setViewMode] = useState<ViewMode>("flat");
  const [selectedOU, setSelectedOU] = useState<string | null>(null);
  const [members, setMembers] = useState<DirectoryEntry[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);

  const { nodes: ouNodes, loading: ouLoading, error: ouError } = useOUTree();

  const treeNodes = useMemo(() => ouNodesToTreeNodes(ouNodes), [ouNodes]);

  // Handle cross-module deep-linking
  useEffect(() => {
    if (selectedGroupDn && groups.length > 0 && !selectedGroup) {
      const found = groups.find((g) => g.distinguishedName === selectedGroupDn);
      if (found) {
        setSelectedGroup(found);
      }
    }
  }, [selectedGroupDn, groups, selectedGroup, setSelectedGroup]);

  // Load members when a group is selected
  useEffect(() => {
    if (!selectedGroup) {
      setMembers([]);
      return;
    }

    let cancelled = false;
    setMembersLoading(true);

    invoke<DirectoryEntry[]>("get_group_members", {
      groupDn: selectedGroup.distinguishedName,
    })
      .then((result) => {
        if (!cancelled) {
          setMembers(result);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn("Failed to load group members:", err);
          setMembers([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setMembersLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedGroup]);

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

  const memberColumns: Column<{
    name: string;
    type: string;
    dn: string;
  }>[] = [
    { key: "name", header: "Name", sortable: true },
    { key: "type", header: "Type", sortable: true },
    { key: "dn", header: "Distinguished Name", sortable: true },
  ];

  const memberRows = members.map((m) => ({
    name:
      m.displayName ?? m.samAccountName ?? parseCnFromDn(m.distinguishedName),
    type: m.objectClass ?? "unknown",
    dn: m.distinguishedName,
  }));

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
            {group.scope} {group.category}
            {group.description ? ` - ${group.description}` : ""}
          </p>
        </div>
      </button>
    ),
    [selectedGroup, setSelectedGroup],
  );

  const displayedGroups = viewMode === "tree" ? filteredGroupsForOU : groups;

  return (
    <div className="flex h-full flex-col" data-testid="group-management">
      <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] p-3">
        <div className="flex-1">
          <SearchBar
            value={filterText}
            onChange={handleFilterChange}
            onSearch={handleFilterChange}
            placeholder="Search groups by name or description..."
            debounceMs={300}
          />
        </div>
        <div className="flex gap-1">
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
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {loading && (
          <div
            className="flex flex-1 items-center justify-center"
            data-testid="group-management-loading"
          >
            <LoadingSpinner message="Loading groups..." />
          </div>
        )}

        {!loading && error && (
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

        {!loading && !error && displayedGroups.length === 0 && (
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

        {!loading && !error && displayedGroups.length > 0 && (
          <>
            <div className="w-64 shrink-0 border-r border-[var(--color-border-subtle)] overflow-hidden flex flex-col">
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
                <div data-testid="group-detail">
                  <h2 className="mb-4 text-lg font-semibold text-[var(--color-text-primary)]">
                    {selectedGroup.displayName || selectedGroup.samAccountName}
                  </h2>

                  <div className="mb-6 grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-caption font-medium text-[var(--color-text-secondary)]">
                        Distinguished Name
                      </p>
                      <p className="text-body text-[var(--color-text-primary)] break-all">
                        {selectedGroup.distinguishedName}
                      </p>
                    </div>
                    <div>
                      <p className="text-caption font-medium text-[var(--color-text-secondary)]">
                        sAMAccountName
                      </p>
                      <p className="text-body text-[var(--color-text-primary)]">
                        {selectedGroup.samAccountName}
                      </p>
                    </div>
                    <div>
                      <p className="text-caption font-medium text-[var(--color-text-secondary)]">
                        Description
                      </p>
                      <p className="text-body text-[var(--color-text-primary)]">
                        {selectedGroup.description || "-"}
                      </p>
                    </div>
                    <div>
                      <p className="text-caption font-medium text-[var(--color-text-secondary)]">
                        Scope
                      </p>
                      <p
                        className="text-body text-[var(--color-text-primary)]"
                        data-testid="group-scope"
                      >
                        {selectedGroup.scope}
                      </p>
                    </div>
                    <div>
                      <p className="text-caption font-medium text-[var(--color-text-secondary)]">
                        Category
                      </p>
                      <p
                        className="text-body text-[var(--color-text-primary)]"
                        data-testid="group-category"
                      >
                        {selectedGroup.category}
                      </p>
                    </div>
                    <div>
                      <p className="text-caption font-medium text-[var(--color-text-secondary)]">
                        Member Count
                      </p>
                      <p className="text-body text-[var(--color-text-primary)]">
                        {selectedGroup.memberCount}
                      </p>
                    </div>
                    <div>
                      <p className="text-caption font-medium text-[var(--color-text-secondary)]">
                        Organizational Unit
                      </p>
                      <p className="text-body text-[var(--color-text-primary)]">
                        {selectedGroup.organizationalUnit || "-"}
                      </p>
                    </div>
                  </div>

                  <div data-testid="group-members-section">
                    <h3 className="mb-2 text-body font-semibold text-[var(--color-text-primary)]">
                      Members ({members.length})
                    </h3>
                    {membersLoading ? (
                      <LoadingSpinner message="Loading members..." />
                    ) : members.length > 0 ? (
                      <DataTable
                        columns={memberColumns}
                        data={memberRows}
                        rowKey={(row) => row.dn}
                      />
                    ) : (
                      <p className="text-caption text-[var(--color-text-secondary)]">
                        No members found
                      </p>
                    )}
                  </div>
                </div>
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
