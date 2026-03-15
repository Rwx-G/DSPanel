import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SearchBar } from "@/components/common/SearchBar";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { EmptyState } from "@/components/common/EmptyState";
import { VirtualizedList } from "@/components/data/VirtualizedList";
import { TreeView, type TreeNode } from "@/components/data/TreeView";
import { DataTable, type Column } from "@/components/data/DataTable";
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
import {
  MemberChangePreviewDialog,
  type MemberChange,
} from "@/components/dialogs/MemberChangePreviewDialog";
import { type OUNode } from "@/components/form/OUPicker";
import { BulkOperations } from "@/pages/BulkOperations";
import { GroupHygiene } from "@/pages/GroupHygiene";
import {
  Users,
  AlertCircle,
  FolderTree,
  List,
  UserPlus,
  UserMinus,
  Eye,
  Search,
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

  // Member management state
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(
    new Set(),
  );
  const [pendingChanges, setPendingChanges] = useState<MemberChange[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [applying, setApplying] = useState(false);
  const [memberSearchText, setMemberSearchText] = useState("");
  const [memberSearchResults, setMemberSearchResults] = useState<
    DirectoryEntry[]
  >([]);
  const [memberSearchLoading, setMemberSearchLoading] = useState(false);

  const { nodes: ouNodes, loading: ouLoading, error: ouError } = useOUTree();

  const treeNodes = useMemo(() => ouNodesToTreeNodes(ouNodes), [ouNodes]);

  // Handle cross-module deep-linking: select group by DN
  const deepLinkHandled = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedGroupDn || deepLinkHandled.current === selectedGroupDn) return;

    // First try to find in already-loaded groups
    const found = groups.find((g) => g.distinguishedName === selectedGroupDn);
    if (found) {
      setSelectedGroup(found);
      deepLinkHandled.current = selectedGroupDn;
      if (activeTabId) clearTabData(activeTabId);
      return;
    }

    // Otherwise search by CN extracted from the DN
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
  useEffect(() => {
    if (!selectedGroup) {
      setMembers([]);
      return;
    }

    let cancelled = false;
    setMembersLoading(true);
    // Reset member management state when group changes
    setSelectedMembers(new Set());
    setPendingChanges([]);
    setMemberSearchText("");
    setMemberSearchResults([]);

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

  // Member selection handlers
  const handleMemberSelect = useCallback((dn: string, checked: boolean) => {
    setSelectedMembers((prev) => {
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
        setSelectedMembers(new Set(members.map((m) => m.distinguishedName)));
      } else {
        setSelectedMembers(new Set());
      }
    },
    [members],
  );

  const allSelected =
    members.length > 0 && selectedMembers.size === members.length;

  // Remove selected members (add to pending changes)
  const handleRemoveSelected = useCallback(() => {
    const removals: MemberChange[] = Array.from(selectedMembers).map((dn) => {
      const member = members.find((m) => m.distinguishedName === dn);
      const name =
        member?.displayName ?? member?.samAccountName ?? parseCnFromDn(dn);
      return { memberDn: dn, memberName: name, action: "remove" as const };
    });

    setPendingChanges((prev) => {
      // Avoid duplicates
      const existingDns = new Set(
        prev.filter((c) => c.action === "remove").map((c) => c.memberDn),
      );
      const newChanges = removals.filter((r) => !existingDns.has(r.memberDn));
      return [...prev, ...newChanges];
    });
    setSelectedMembers(new Set());
  }, [selectedMembers, members]);

  // Member search for adding
  const handleMemberSearch = useCallback((query: string) => {
    setMemberSearchText(query);
    if (!query.trim()) {
      setMemberSearchResults([]);
      return;
    }

    setMemberSearchLoading(true);
    invoke<DirectoryEntry[]>("search_users", { query })
      .then((results) => {
        setMemberSearchResults(results);
      })
      .catch((err) => {
        console.warn("Failed to search users:", err);
        setMemberSearchResults([]);
      })
      .finally(() => {
        setMemberSearchLoading(false);
      });
  }, []);

  // Add user to group (pending)
  const handleAddToGroup = useCallback(
    (entry: DirectoryEntry) => {
      const name =
        entry.displayName ??
        entry.samAccountName ??
        parseCnFromDn(entry.distinguishedName);

      // Check if already a member
      const alreadyMember = members.some(
        (m) => m.distinguishedName === entry.distinguishedName,
      );
      if (alreadyMember) return;

      // Check if already in pending adds
      const alreadyPending = pendingChanges.some(
        (c) => c.memberDn === entry.distinguishedName && c.action === "add",
      );
      if (alreadyPending) return;

      setPendingChanges((prev) => [
        ...prev,
        {
          memberDn: entry.distinguishedName,
          memberName: name,
          action: "add",
        },
      ]);
    },
    [members, pendingChanges],
  );

  // Apply all pending changes
  const handleApplyChanges = useCallback(async () => {
    if (!selectedGroup || pendingChanges.length === 0) return;

    setApplying(true);
    try {
      const results = await Promise.allSettled(
        pendingChanges.map((change) => {
          if (change.action === "add") {
            return invoke("add_user_to_group", {
              userDn: change.memberDn,
              groupDn: selectedGroup.distinguishedName,
            });
          } else {
            return invoke("remove_group_member", {
              memberDn: change.memberDn,
              groupDn: selectedGroup.distinguishedName,
            });
          }
        }),
      );

      const failures = results.filter((r) => r.status === "rejected");
      if (failures.length > 0) {
        console.warn(`${failures.length} member changes failed`);
      }

      // Refresh member list
      const refreshed = await invoke<DirectoryEntry[]>("get_group_members", {
        groupDn: selectedGroup.distinguishedName,
      });
      setMembers(refreshed);
      setPendingChanges([]);
      setSelectedMembers(new Set());
      setShowPreview(false);
    } catch (err) {
      console.warn("Failed to apply member changes:", err);
    } finally {
      setApplying(false);
    }
  }, [selectedGroup, pendingChanges]);

  const memberColumns: Column<{
    name: string;
    type: string;
    dn: string;
  }>[] = useMemo(() => {
    const cols: Column<{ name: string; type: string; dn: string }>[] = [];

    if (canManageMembers) {
      cols.push({
        key: "name" as const,
        header: "",
        sortable: false,
        width: 40,
        resizable: false,
        render: (_value, row) => (
          <input
            type="checkbox"
            checked={selectedMembers.has(row.dn)}
            onChange={(e) => handleMemberSelect(row.dn, e.target.checked)}
            onClick={(e) => e.stopPropagation()}
            data-testid={`member-checkbox-${row.name}`}
            aria-label={`Select ${row.name}`}
          />
        ),
      });
    }

    cols.push(
      { key: "name", header: "Name", sortable: true },
      { key: "type", header: "Type", sortable: true },
      { key: "dn", header: "Distinguished Name", sortable: true },
    );

    return cols;
  }, [canManageMembers, selectedMembers, handleMemberSelect]);

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
          {canManageMembers && (
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
          )}
          {canManageMembers && (
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
          )}
        </div>
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

        {viewMode !== "bulk" && viewMode !== "hygiene" && loading && (
          <div
            className="flex flex-1 items-center justify-center"
            data-testid="group-management-loading"
          >
            <LoadingSpinner message="Loading groups..." />
          </div>
        )}

        {viewMode !== "bulk" && viewMode !== "hygiene" && !loading && error && (
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

        {viewMode !== "bulk" &&
          viewMode !== "hygiene" &&
          !loading &&
          !error &&
          displayedGroups.length === 0 && (
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

        {viewMode !== "bulk" &&
          viewMode !== "hygiene" &&
          !loading &&
          !error &&
          displayedGroups.length > 0 && (
            <>
              <div className="w-64 shrink-0 border-r border-[var(--color-border-subtle)] overflow-hidden flex flex-col">
                {viewMode === "tree" && (
                  <div
                    className="overflow-auto border-b border-[var(--color-border-subtle)] p-2"
                    data-testid="group-tree-panel"
                    style={{ maxHeight: "40%" }}
                  >
                    {ouLoading && (
                      <LoadingSpinner message="Loading OU tree..." />
                    )}
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
                      {selectedGroup.displayName ||
                        selectedGroup.samAccountName}
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
                      <div className="mb-2 flex items-center justify-between">
                        <h3 className="text-body font-semibold text-[var(--color-text-primary)]">
                          Members ({members.length})
                        </h3>
                        {canManageMembers && (
                          <div
                            className="flex items-center gap-2"
                            data-testid="member-management-controls"
                          >
                            {selectedMembers.size > 0 && (
                              <button
                                className="btn btn-secondary flex items-center gap-1 text-caption"
                                onClick={handleRemoveSelected}
                                data-testid="remove-selected-btn"
                              >
                                <UserMinus size={14} />
                                Remove Selected ({selectedMembers.size})
                              </button>
                            )}
                            {pendingChanges.length > 0 && (
                              <button
                                className="btn btn-primary flex items-center gap-1 text-caption"
                                onClick={() => setShowPreview(true)}
                                data-testid="preview-changes-btn"
                              >
                                <Eye size={14} />
                                Preview ({pendingChanges.length})
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      {canManageMembers && members.length > 0 && (
                        <div className="mb-2 flex items-center gap-2">
                          <label className="flex items-center gap-1.5 text-caption text-[var(--color-text-secondary)]">
                            <input
                              type="checkbox"
                              checked={allSelected}
                              onChange={(e) =>
                                handleSelectAll(e.target.checked)
                              }
                              data-testid="select-all-checkbox"
                            />
                            Select all
                          </label>
                        </div>
                      )}

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

                      {canManageMembers && (
                        <div
                          className="mt-4 rounded-lg border border-[var(--color-border-default)] p-3"
                          data-testid="add-member-section"
                        >
                          <h4 className="mb-2 flex items-center gap-1.5 text-body font-medium text-[var(--color-text-primary)]">
                            <UserPlus size={16} />
                            Add Members
                          </h4>
                          <div className="flex items-center gap-2">
                            <div className="flex-1">
                              <div
                                className="flex items-center gap-2 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-1.5"
                                data-testid="member-search-bar"
                              >
                                <Search
                                  size={16}
                                  className="shrink-0 text-[var(--color-text-secondary)]"
                                  aria-hidden="true"
                                />
                                <input
                                  type="text"
                                  value={memberSearchText}
                                  onChange={(e) => {
                                    setMemberSearchText(e.target.value);
                                    handleMemberSearch(e.target.value);
                                  }}
                                  placeholder="Search users to add..."
                                  aria-label="Search users to add"
                                  className="flex-1 bg-transparent text-body text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-secondary)]"
                                  data-testid="member-search-input"
                                />
                              </div>
                            </div>
                          </div>

                          {memberSearchLoading && (
                            <div className="mt-2">
                              <LoadingSpinner message="Searching..." />
                            </div>
                          )}

                          {memberSearchResults.length > 0 && (
                            <div
                              className="mt-2 max-h-40 overflow-auto rounded border border-[var(--color-border-subtle)]"
                              data-testid="member-search-results"
                            >
                              {memberSearchResults.map((entry) => {
                                const name =
                                  entry.displayName ??
                                  entry.samAccountName ??
                                  parseCnFromDn(entry.distinguishedName);
                                const isAlreadyMember = members.some(
                                  (m) =>
                                    m.distinguishedName ===
                                    entry.distinguishedName,
                                );
                                const isPending = pendingChanges.some(
                                  (c) =>
                                    c.memberDn === entry.distinguishedName &&
                                    c.action === "add",
                                );
                                return (
                                  <div
                                    key={entry.distinguishedName}
                                    className="flex items-center justify-between border-b border-[var(--color-border-subtle)] px-3 py-1.5 last:border-b-0"
                                    data-testid={`search-result-${name}`}
                                  >
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-body text-[var(--color-text-primary)]">
                                        {name}
                                      </p>
                                      <p className="truncate text-caption text-[var(--color-text-secondary)]">
                                        {entry.samAccountName}
                                      </p>
                                    </div>
                                    <button
                                      className="btn btn-ghost flex items-center gap-1 text-caption"
                                      onClick={() => handleAddToGroup(entry)}
                                      disabled={isAlreadyMember || isPending}
                                      data-testid={`add-member-btn-${name}`}
                                    >
                                      <UserPlus size={14} />
                                      {isAlreadyMember
                                        ? "Member"
                                        : isPending
                                          ? "Pending"
                                          : "Add"}
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
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

      {showPreview && selectedGroup && (
        <MemberChangePreviewDialog
          open={showPreview}
          changes={pendingChanges}
          groupName={selectedGroup.displayName || selectedGroup.samAccountName}
          onConfirm={handleApplyChanges}
          onCancel={() => setShowPreview(false)}
          loading={applying}
        />
      )}
    </div>
  );
}
