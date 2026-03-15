import { useState, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { StatusBadge } from "@/components/common/StatusBadge";
import { CopyButton } from "@/components/common/CopyButton";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import {
  PropertyGrid,
  type PropertyGroup,
} from "@/components/data/PropertyGrid";
import { DataTable, type Column } from "@/components/data/DataTable";
import { type DirectoryEntry, type DirectoryGroup } from "@/types/directory";
import { parseCnFromDn } from "@/utils/dn";
import {
  type MemberChange,
  MemberChangePreviewDialog,
} from "@/components/dialogs/MemberChangePreviewDialog";
import { UserPlus, UserMinus, Eye, Search, Info } from "lucide-react";

export interface GroupDetailProps {
  group: DirectoryGroup;
  members: DirectoryEntry[];
  membersLoading: boolean;
  canManageMembers: boolean;
  onMembersRefresh: () => void;
}

export function GroupDetail({
  group,
  members,
  membersLoading,
  canManageMembers,
  onMembersRefresh,
}: GroupDetailProps) {
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
  const [showHelp, setShowHelp] = useState(false);

  const propertyGroups: PropertyGroup[] = [
    {
      category: "Identity",
      items: [
        { label: "Display Name", value: group.displayName },
        { label: "SAM Account Name", value: group.samAccountName },
        { label: "Description", value: group.description || "-" },
      ],
    },
    {
      category: "Location",
      items: [
        { label: "Distinguished Name", value: group.distinguishedName },
        {
          label: "Organizational Unit",
          value: group.organizationalUnit || "-",
        },
      ],
    },
    {
      category: "Group Type",
      items: [
        { label: "Scope", value: group.scope },
        { label: "Category", value: group.category },
        { label: "Member Count", value: String(group.memberCount) },
      ],
    },
  ];

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

  const pendingAdds = pendingChanges.filter((c) => c.action === "add").length;
  const pendingRemoves = pendingChanges.filter(
    (c) => c.action === "remove",
  ).length;

  // Remove selected members (add to pending changes)
  const handleRemoveSelected = useCallback(() => {
    const removals: MemberChange[] = Array.from(selectedMembers).map((dn) => {
      const member = members.find((m) => m.distinguishedName === dn);
      const name =
        member?.displayName ?? member?.samAccountName ?? parseCnFromDn(dn);
      return { memberDn: dn, memberName: name, action: "remove" as const };
    });

    setPendingChanges((prev) => {
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

      const alreadyMember = members.some(
        (m) => m.distinguishedName === entry.distinguishedName,
      );
      if (alreadyMember) return;

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
    if (pendingChanges.length === 0) return;

    setApplying(true);
    try {
      const results = await Promise.allSettled(
        pendingChanges.map((change) => {
          if (change.action === "add") {
            return invoke("add_user_to_group", {
              userDn: change.memberDn,
              groupDn: group.distinguishedName,
            });
          } else {
            return invoke("remove_group_member", {
              memberDn: change.memberDn,
              groupDn: group.distinguishedName,
            });
          }
        }),
      );

      const failures = results.filter((r) => r.status === "rejected");
      if (failures.length > 0) {
        console.warn(`${failures.length} member changes failed`);
      }

      setPendingChanges([]);
      setSelectedMembers(new Set());
      setShowPreview(false);
      onMembersRefresh();
    } catch (err) {
      console.warn("Failed to apply member changes:", err);
    } finally {
      setApplying(false);
    }
  }, [group.distinguishedName, pendingChanges, onMembersRefresh]);

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

  return (
    <div className="space-y-4" data-testid="group-detail">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
          {group.displayName || group.samAccountName}
        </h2>
        <div className="flex items-center gap-2">
          <StatusBadge text={group.scope} variant="info" />
          <StatusBadge
            text={group.category}
            variant={group.category === "Security" ? "neutral" : "warning"}
          />
        </div>
      </div>

      <div className="flex items-center gap-1 text-caption text-[var(--color-text-secondary)]">
        <span>{group.samAccountName}</span>
        <CopyButton text={group.samAccountName} />
      </div>

      <div className="border-t border-[var(--color-border-default)]" />

      <PropertyGrid groups={propertyGroups} />

      <div className="border-t border-[var(--color-border-default)]" />

      <div data-testid="group-members-section">
        {/* Header: title + action buttons (always visible) */}
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-body font-semibold text-[var(--color-text-primary)]">
              Members ({members.length})
            </h3>
            {canManageMembers && (
              <div className="relative">
                <button
                  className="flex h-5 w-5 items-center justify-center rounded-full text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
                  onClick={() => setShowHelp(!showHelp)}
                  onBlur={() => setTimeout(() => setShowHelp(false), 150)}
                  aria-label="Member management help"
                  data-testid="member-help-btn"
                >
                  <Info size={13} />
                </button>
                {showHelp && (
                  <div
                    className="absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-3 shadow-lg"
                    data-testid="member-help-popup"
                  >
                    <p className="text-caption font-semibold text-[var(--color-text-primary)] mb-1">
                      Member Management
                    </p>
                    <p className="text-caption text-[var(--color-text-secondary)]">
                      Use the search bar to find and add members, or select
                      existing members with checkboxes and click "Remove
                      Selected" to stage removals. Click "Preview" to review all
                      pending changes, then "Apply" to execute them.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
          {canManageMembers && (
            <div
              className="flex items-center gap-2"
              data-testid="member-management-controls"
            >
              <button
                className="btn btn-sm flex items-center gap-1"
                onClick={handleRemoveSelected}
                disabled={selectedMembers.size === 0}
                data-testid="remove-selected-btn"
              >
                <UserMinus size={14} />
                Remove Selected
                {selectedMembers.size > 0 && ` (${selectedMembers.size})`}
              </button>
              <button
                className="btn btn-sm flex items-center gap-1"
                onClick={() => setShowPreview(true)}
                disabled={pendingChanges.length === 0}
                data-testid="preview-changes-btn"
              >
                <Eye size={14} />
                Preview
                {pendingChanges.length > 0 && ` (${pendingChanges.length})`}
              </button>
            </div>
          )}
        </div>

        {/* Pending changes summary */}
        {canManageMembers && pendingChanges.length > 0 && (
          <div className="mb-3 flex items-center gap-3 rounded-md border border-[var(--color-primary)] bg-[var(--color-primary-subtle)] px-3 py-1.5 text-caption text-[var(--color-primary)]">
            <span>
              {pendingAdds > 0 && `${pendingAdds} to add`}
              {pendingAdds > 0 && pendingRemoves > 0 && ", "}
              {pendingRemoves > 0 && `${pendingRemoves} to remove`}
            </span>
            <button
              className="ml-auto text-caption underline hover:no-underline"
              onClick={() => setPendingChanges([])}
              data-testid="clear-pending-btn"
            >
              Clear
            </button>
          </div>
        )}

        {/* Add members section - above current members */}
        {canManageMembers && (
          <div
            className="mb-3 rounded-lg border border-[var(--color-border-default)] p-3"
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
                    (m) => m.distinguishedName === entry.distinguishedName,
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

        {/* Select all + member list */}
        {canManageMembers && members.length > 0 && (
          <div className="mb-2 flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-caption text-[var(--color-text-secondary)]">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(e) => handleSelectAll(e.target.checked)}
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
      </div>

      {showPreview && (
        <MemberChangePreviewDialog
          open={showPreview}
          changes={pendingChanges}
          groupName={group.displayName || group.samAccountName}
          onConfirm={handleApplyChanges}
          onCancel={() => setShowPreview(false)}
          loading={applying}
        />
      )}
    </div>
  );
}
