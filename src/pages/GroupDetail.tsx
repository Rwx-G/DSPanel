import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CopyButton } from "@/components/common/CopyButton";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import {
  PropertyGrid,
  type PropertyGroup,
} from "@/components/data/PropertyGrid";
import { type DirectoryEntry, type DirectoryGroup } from "@/types/directory";
import { parseCnFromDn } from "@/utils/dn";
import {
  type MemberChange,
  MemberChangePreviewDialog,
} from "@/components/dialogs/MemberChangePreviewDialog";
import {
  ContextMenu,
  type ContextMenuItem,
} from "@/components/common/ContextMenu";
import { StateInTimeView } from "@/components/comparison/StateInTimeView";
import { useNavigation } from "@/contexts/NavigationContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { extractErrorMessage } from "@/utils/errorMapping";
import {
  UserPlus,
  UserMinus,
  Eye,
  Search,
  Info,
  ChevronDown,
  ChevronRight,
  Users,
  User,
  Shield,
  Mail,
  FolderOpen,
  Trash2,
  X,
} from "lucide-react";
import { useDialog } from "@/contexts/DialogContext";
import { useErrorHandler } from "@/hooks/useErrorHandler";
import { ExportToolbar } from "@/components/common/ExportToolbar";

interface NestedMemberItemProps {
  entry: DirectoryEntry;
  depth: number;
  ancestors: Set<string>;
  expandedGroups: Set<string>;
  nestedGroupMembers: Record<string, DirectoryEntry[]>;
  nestedGroupLoading: Set<string>;
  selectedMembers?: Set<string>;
  onToggleExpand: (dn: string) => void;
  onToggleSelect?: (dn: string, checked: boolean) => void;
  onRowContextMenu?: (e: React.MouseEvent, entry: DirectoryEntry) => void;
}

function NestedMemberItem({
  entry,
  depth,
  ancestors,
  expandedGroups,
  nestedGroupMembers,
  nestedGroupLoading,
  selectedMembers,
  onToggleExpand,
  onToggleSelect,
  onRowContextMenu,
}: NestedMemberItemProps) {
  const name =
    entry.displayName ??
    entry.samAccountName ??
    parseCnFromDn(entry.distinguishedName);
  const isGroup = entry.objectClass === "group";
  const isExpanded = expandedGroups.has(entry.distinguishedName);
  const isCircular = ancestors.has(entry.distinguishedName);
  const subMembers = nestedGroupMembers[entry.distinguishedName];
  const isLoading = nestedGroupLoading.has(entry.distinguishedName);
  const isSelected = selectedMembers?.has(entry.distinguishedName) ?? false;
  const canSelect = !!onToggleSelect;

  // Ancestors for children: current ancestors + this group
  const childAncestors = useMemo(() => {
    if (!isGroup) return ancestors;
    return new Set([...ancestors, entry.distinguishedName]);
  }, [ancestors, entry.distinguishedName, isGroup]);

  // Sort sub-members: groups first
  const sortedSubs = useMemo(() => {
    if (!subMembers) return [];
    const groups = subMembers.filter((m) => m.objectClass === "group");
    const others = subMembers.filter((m) => m.objectClass !== "group");
    return [...groups, ...others];
  }, [subMembers]);

  const iconSize = depth === 0 ? 14 : 12;
  const paddingLeft = depth === 0 ? 12 : 8 + depth * 20;

  return (
    <div
      className="border-b border-[var(--color-border-subtle)] last:border-b-0"
      data-testid={
        isGroup ? `nested-group-${name}` : `member-row-${name}`
      }
    >
      {/* Row */}
      <div
        className={`flex items-center gap-2 py-1.5 pr-3 transition-colors hover:bg-[var(--color-surface-hover)] ${
          isSelected ? "bg-[var(--color-surface-selected)]" : ""
        } ${canSelect ? "cursor-pointer" : ""}`}
        style={{ paddingLeft }}
        onClick={() => {
          if (canSelect) {
            onToggleSelect(entry.distinguishedName, !isSelected);
          }
        }}
        onContextMenu={(e) => {
          if (onRowContextMenu) {
            e.preventDefault();
            onRowContextMenu(e, entry);
          }
        }}
      >
        {canSelect && depth === 0 && (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(e) => {
              e.stopPropagation();
              onToggleSelect(entry.distinguishedName, e.target.checked);
            }}
            onClick={(e) => e.stopPropagation()}
            data-testid={`member-checkbox-${name}`}
            aria-label={`Select ${name}`}
          />
        )}
        {isGroup ? (
          <button
            className="shrink-0 rounded-sm p-0.5 hover:bg-[var(--color-surface-hover)] transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              if (!isCircular || isExpanded) {
                onToggleExpand(entry.distinguishedName);
              }
            }}
            disabled={isCircular && !isExpanded}
            title={
              isCircular && !isExpanded
                ? "Circular reference detected"
                : isExpanded
                  ? "Collapse"
                  : "Expand"
            }
            data-testid={`expand-${name}`}
          >
            {isExpanded ? (
              <ChevronDown size={iconSize} />
            ) : (
              <ChevronRight
                size={iconSize}
                className={
                  isCircular ? "text-[var(--color-text-disabled)]" : ""
                }
              />
            )}
          </button>
        ) : (
          <span style={{ width: iconSize + 4 }} />
        )}
        {isGroup ? (
          <Users
            size={iconSize}
            className="shrink-0 text-[var(--color-primary)]"
          />
        ) : (
          <span
            className="shrink-0 rounded-full bg-[var(--color-text-secondary)] opacity-40"
            style={{ width: iconSize, height: iconSize }}
          />
        )}
        <span className={`flex-1 truncate text-[var(--color-text-primary)] ${depth === 0 ? "text-body" : "text-caption"}`}>
          {name}
        </span>
        <span className="shrink-0 text-caption text-[var(--color-text-secondary)]">
          {isGroup ? "group" : entry.objectClass ?? "user"}
        </span>
        {isGroup && subMembers && !isCircular && (
          <span className="shrink-0 text-caption text-[var(--color-text-secondary)]">
            ({subMembers.length})
          </span>
        )}
        {isGroup && isCircular && !isExpanded && (
          <span className="shrink-0 text-caption text-[var(--color-warning)]">
            circular
          </span>
        )}
      </div>

      {/* Expanded children (recursive) */}
      {isGroup && isExpanded && (
        <div
          className="border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-bg)]"
          data-testid={`nested-group-members-${name}`}
        >
          {isLoading ? (
            <div className="py-2 pl-8">
              <LoadingSpinner message="Loading..." />
            </div>
          ) : sortedSubs.length > 0 ? (
            sortedSubs.map((sub) => (
              <NestedMemberItem
                key={sub.distinguishedName}
                entry={sub}
                depth={depth + 1}
                ancestors={childAncestors}
                expandedGroups={expandedGroups}
                nestedGroupMembers={nestedGroupMembers}
                nestedGroupLoading={nestedGroupLoading}
                onToggleExpand={onToggleExpand}
                onRowContextMenu={onRowContextMenu}
              />
            ))
          ) : (
            <p className="py-2 pl-8 text-caption text-[var(--color-text-secondary)]">
              No members
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export interface GroupDetailProps {
  group: DirectoryGroup;
  members: DirectoryEntry[];
  membersLoading: boolean;
  canManageMembers: boolean;
  onMembersRefresh: () => void;
  onDeleted?: () => void;
}

export function GroupDetail({
  group,
  members,
  membersLoading,
  canManageMembers,
  onMembersRefresh,
  onDeleted,
}: GroupDetailProps) {
  const { notify } = useNotifications();
  const { showConfirmation } = useDialog();
  const { handleError } = useErrorHandler();

  const handleDeleteGroup = useCallback(async () => {
    const confirmed = await showConfirmation(
      "Delete Group",
      `Are you sure you want to delete "${group.displayName || group.samAccountName}"?`,
      "This action cannot be undone.",
    );
    if (!confirmed) return;
    try {
      await invoke("delete_ad_object", { dn: group.distinguishedName });
      notify("Group deleted successfully", "success");
      onDeleted?.();
    } catch (err) {
      handleError(err, "deleting group");
    }
  }, [group, showConfirmation, onDeleted, notify, handleError]);

  // Member management state
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(
    new Set(),
  );
  const [pendingChanges, setPendingChanges] = useState<MemberChange[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [applying, setApplying] = useState(false);
  const [showAddDropdown, setShowAddDropdown] = useState(false);
  const [memberSearchText, setMemberSearchText] = useState("");
  const [memberSearchResults, setMemberSearchResults] = useState<
    DirectoryEntry[]
  >([]);
  const [memberSearchLoading, setMemberSearchLoading] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [contextMenuItems, setContextMenuItems] = useState<ContextMenuItem[]>(
    [],
  );
  const addDropdownRef = useRef<HTMLDivElement>(null);
  const { openTab } = useNavigation();

  // Nested group expansion state
  const [expandedNestedGroups, setExpandedNestedGroups] = useState<Set<string>>(new Set());
  const [nestedGroupMembers, setNestedGroupMembers] = useState<Record<string, DirectoryEntry[]>>({});
  const [nestedGroupLoading, setNestedGroupLoading] = useState<Set<string>>(new Set());

  // Split members into nested groups and direct members
  const nestedGroups = members.filter((m) => m.objectClass === "group");
  const directMembers = members.filter((m) => m.objectClass !== "group");
  // Sorted: groups first, then others
  const sortedMembers = useMemo(
    () => [...nestedGroups, ...directMembers],
    [nestedGroups, directMembers],
  );
  // The root group DN is always an ancestor for circular detection
  const rootAncestors = useMemo(
    () => new Set([group.distinguishedName]),
    [group.distinguishedName],
  );

  const toggleNestedGroup = useCallback(
    (dn: string) => {
      setExpandedNestedGroups((prev) => {
        const next = new Set(prev);
        if (next.has(dn)) {
          next.delete(dn);
        } else {
          next.add(dn);
          // Load members if not already loaded
          if (!nestedGroupMembers[dn]) {
            setNestedGroupLoading((p) => new Set(p).add(dn));
            invoke<DirectoryEntry[]>("get_group_members", { groupDn: dn })
              .then((result) => {
                setNestedGroupMembers((p) => ({ ...p, [dn]: result }));
              })
              .catch(() => {
                setNestedGroupMembers((p) => ({ ...p, [dn]: [] }));
              })
              .finally(() => {
                setNestedGroupLoading((p) => {
                  const n = new Set(p);
                  n.delete(dn);
                  return n;
                });
              });
          }
        }
        return next;
      });
    },
    [nestedGroupMembers],
  );

  const closeAddDropdown = useCallback(() => {
    setShowAddDropdown(false);
    setMemberSearchText("");
    setMemberSearchResults([]);
  }, []);

  const handleMemberContextMenu = useCallback(
    (e: React.MouseEvent, entry: DirectoryEntry) => {
      const entryName =
        entry.displayName ??
        entry.samAccountName ??
        parseCnFromDn(entry.distinguishedName);
      const isGroup = entry.objectClass === "group";

      const items: ContextMenuItem[] = isGroup
        ? [
            {
              label: `Open "${entryName}" in Group Management`,
              icon: <FolderOpen size={14} />,
              onClick: () => {
                openTab("Group Management", "groups", "users-group", {
                  selectedGroupDn: entry.distinguishedName,
                });
              },
            },
          ]
        : [
            {
              label: `Open "${entryName}" in User Lookup`,
              icon: <User size={14} />,
              onClick: () => {
                openTab("User Lookup", "users", "user", {
                  selectedUserSam: entry.samAccountName,
                });
              },
            },
          ];

      setContextMenuItems(items);
      setContextMenuPos({ x: e.clientX, y: e.clientY });
    },
    [openTab],
  );

  // Close dropdown on click outside
  useEffect(() => {
    if (!showAddDropdown) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        addDropdownRef.current &&
        !addDropdownRef.current.contains(e.target as Node)
      ) {
        closeAddDropdown();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showAddDropdown, closeAddDropdown]);

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
        setSelectedMembers(new Set(sortedMembers.map((m) => m.distinguishedName)));
      } else {
        setSelectedMembers(new Set());
      }
    },
    [directMembers],
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
      const member = directMembers.find((m) => m.distinguishedName === dn);
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
  }, [selectedMembers, directMembers]);

  // Member search for adding (searches both users and groups)
  const handleMemberSearch = useCallback((query: string) => {
    setMemberSearchText(query);
    if (!query.trim()) {
      setMemberSearchResults([]);
      return;
    }

    setMemberSearchLoading(true);
    Promise.all([
      invoke<DirectoryEntry[]>("search_users", { query }),
      invoke<DirectoryEntry[]>("search_groups", { query }),
    ])
      .then(([users, groups]) => {
        setMemberSearchResults([...groups, ...users]);
      })
      .catch((err) => {
        console.warn("Failed to search:", err);
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
      const successes = results.length - failures.length;

      if (failures.length > 0 && successes > 0) {
        const firstErr = (failures[0] as PromiseRejectedResult).reason;
        notify(
          `${successes} change(s) applied, ${failures.length} failed: ${extractErrorMessage(firstErr)}`,
          "warning",
        );
      } else if (failures.length > 0) {
        const firstErr = (failures[0] as PromiseRejectedResult).reason;
        notify(extractErrorMessage(firstErr), "error");
      } else {
        notify(
          `${successes} member change(s) applied successfully`,
          "success",
        );
      }

      setPendingChanges([]);
      setSelectedMembers(new Set());
      setShowPreview(false);
      closeAddDropdown();
      onMembersRefresh();
    } catch (err) {
      notify(extractErrorMessage(err), "error");
    } finally {
      setApplying(false);
    }
  }, [group.distinguishedName, pendingChanges, onMembersRefresh, closeAddDropdown]);

  return (
    <div className="space-y-4" data-testid="group-detail">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
          {group.displayName || group.samAccountName}
        </h2>
        <div className="flex items-center gap-2">
          {canManageMembers && (
            <button
              className="btn btn-sm flex items-center gap-1"
              style={{ color: "var(--color-error)", borderColor: "var(--color-error)" }}
              onClick={handleDeleteGroup}
              data-testid="group-delete-btn"
            >
              <Trash2 size={14} />
              Delete
            </button>
          )}
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
            group.category === "Security"
              ? "bg-[var(--color-info)]/10 text-[var(--color-info)]"
              : "bg-[var(--color-warning)]/10 text-[var(--color-warning)]"
          }`}>
            {group.category === "Security" ? <Shield size={12} /> : <Mail size={12} />}
            {group.category}
          </span>
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
            group.scope === "Global"
              ? "bg-[var(--color-success)]/10 text-[var(--color-success)]"
              : group.scope === "Universal"
                ? "bg-[var(--color-primary-subtle)] text-[var(--color-primary)]"
                : "bg-[var(--color-surface-hover)] text-[var(--color-text-primary)]"
          }`}>
            {group.scope === "DomainLocal" ? "Domain Local" : group.scope}
          </span>
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
        {/* Action bar: title + buttons */}
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3
              className="text-body font-semibold text-[var(--color-text-primary)]"
              data-testid="members-title"
            >
              Members ({directMembers.length})
              {nestedGroups.length > 0 && ` and ${nestedGroups.length} nested group(s)`}
            </h3>
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
                      Click "+ Add" to search and stage new users or groups
                      as members. Select existing members or nested groups
                      with checkboxes and click "Remove" to stage removals.
                      Click "Preview" to review all pending changes, then
                      "Apply" to execute them. Nested groups can be expanded
                      with the chevron to inspect their content.
                    </p>
                  </div>
                )}
              </div>
          </div>
          <div
            className="flex items-center gap-2"
            data-testid="member-management-controls"
          >
              <ExportToolbar<DirectoryEntry>
                columns={[
                  { key: "displayName", header: "Display Name" },
                  { key: "samAccountName", header: "SAM Account" },
                  { key: "objectClass", header: "Type" },
                  { key: "distinguishedName", header: "DN" },
                ]}
                data={members}
                rowMapper={(m) => [
                  m.displayName ?? "",
                  m.samAccountName ?? "",
                  m.objectClass ?? "",
                  m.distinguishedName,
                ]}
                title={`${group.displayName || group.samAccountName} - Members`}
                filenameBase={`${group.samAccountName}_members`}
              />
              <div className="relative" ref={addDropdownRef}>
                <button
                  className={`btn btn-outline btn-sm flex items-center gap-1 ${showAddDropdown ? "bg-[var(--color-primary-subtle)] border-[var(--color-primary)]" : ""}`}
                  onClick={() =>
                    setShowAddDropdown((prev) => {
                      if (prev) {
                        setMemberSearchText("");
                        setMemberSearchResults([]);
                      }
                      return !prev;
                    })
                  }
                  disabled={!canManageMembers}
                  title={!canManageMembers ? "Requires AccountOperator permission" : undefined}
                  data-testid="add-member-btn"
                >
                  <UserPlus size={14} />
                  Add
                </button>
                {showAddDropdown && (
                  <div
                    className="absolute right-0 top-full z-50 mt-1 w-80 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-elevated)] shadow-lg"
                    data-testid="add-member-section"
                  >
                    <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] px-3 py-2">
                      <Search
                        size={14}
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
                        placeholder="Search users or groups to add..."
                        aria-label="Search users or groups to add"
                        className="flex-1 bg-transparent text-body text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)]"
                        style={{ outline: "none", boxShadow: "none" }}
                        data-testid="member-search-input"
                        autoFocus
                      />
                      <button
                        onClick={closeAddDropdown}
                        className="rounded-sm p-0.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
                        aria-label="Close"
                      >
                        <X size={14} />
                      </button>
                    </div>

                    {memberSearchLoading && (
                      <div className="px-3 py-3">
                        <LoadingSpinner message="Searching..." />
                      </div>
                    )}

                    {!memberSearchLoading &&
                      memberSearchText.length > 0 &&
                      memberSearchResults.length === 0 && (
                        <div className="px-3 py-3 text-center text-caption text-[var(--color-text-secondary)]">
                          No results found
                        </div>
                      )}

                    {memberSearchResults.length > 0 && (
                      <div
                        className="max-h-52 overflow-auto"
                        data-testid="member-search-results"
                      >
                        {memberSearchResults.map((entry) => {
                          const name =
                            entry.displayName ??
                            entry.samAccountName ??
                            parseCnFromDn(entry.distinguishedName);
                          const isAlreadyMember = members.some(
                            (m) =>
                              m.distinguishedName === entry.distinguishedName,
                          );
                          const isPending = pendingChanges.some(
                            (c) =>
                              c.memberDn === entry.distinguishedName &&
                              c.action === "add",
                          );
                          return (
                            <button
                              key={entry.distinguishedName}
                              className="flex w-full items-center justify-between border-b border-[var(--color-border-subtle)] px-3 py-2 text-left transition-colors hover:bg-[var(--color-surface-hover)] last:border-b-0 disabled:opacity-50"
                              onClick={() => handleAddToGroup(entry)}
                              disabled={isAlreadyMember || isPending}
                              data-testid={`add-member-btn-${name}`}
                            >
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-body text-[var(--color-text-primary)]">
                                  {name}
                                </p>
                                <p className="truncate text-caption text-[var(--color-text-secondary)]">
                                  {entry.samAccountName}
                                </p>
                              </div>
                              <span className="ml-2 shrink-0 text-caption text-[var(--color-text-secondary)]">
                                {isAlreadyMember
                                  ? "Member"
                                  : isPending
                                    ? "Pending"
                                    : ""}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {!memberSearchText && (
                      <div className="px-3 py-3 text-center text-caption text-[var(--color-text-secondary)]">
                        Type to search for users or groups
                      </div>
                    )}
                  </div>
                )}
              </div>
              <button
                className="btn btn-outline btn-sm flex items-center gap-1"
                onClick={handleRemoveSelected}
                disabled={!canManageMembers || selectedMembers.size === 0}
                title={!canManageMembers ? "Requires AccountOperator permission" : undefined}
                data-testid="remove-selected-btn"
              >
                <UserMinus size={14} />
                Remove
                {selectedMembers.size > 0 && ` (${selectedMembers.size})`}
              </button>
              <button
                className="btn btn-primary btn-sm flex items-center gap-1"
                onClick={() => setShowPreview(true)}
                disabled={!canManageMembers || pendingChanges.length === 0}
                title={!canManageMembers ? "Requires AccountOperator permission" : undefined}
                data-testid="preview-changes-btn"
              >
                <Eye size={14} />
                Preview
                {pendingChanges.length > 0 && ` (${pendingChanges.length})`}
              </button>
            </div>
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

        {/* Select all */}
        {canManageMembers && members.length > 0 && !membersLoading && (
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

        {/* Unified member list: groups first (with chevron), then users */}
        {membersLoading ? (
          <LoadingSpinner message="Loading members..." />
        ) : members.length > 0 ? (
          <div
            className="rounded-lg border border-[var(--color-border-default)] overflow-hidden"
            data-testid="member-list"
          >
            {sortedMembers.map((m) => (
              <NestedMemberItem
                key={m.distinguishedName}
                entry={m}
                depth={0}
                ancestors={rootAncestors}
                expandedGroups={expandedNestedGroups}
                nestedGroupMembers={nestedGroupMembers}
                nestedGroupLoading={nestedGroupLoading}
                selectedMembers={canManageMembers ? selectedMembers : undefined}
                onToggleExpand={toggleNestedGroup}
                onToggleSelect={canManageMembers ? handleMemberSelect : undefined}
                onRowContextMenu={handleMemberContextMenu}
              />
            ))}
          </div>
        ) : (
          <p className="text-caption text-[var(--color-text-secondary)]">
            No members found
          </p>
        )}
      </div>

      <div className="border-t border-[var(--color-border-default)]" />

      <div data-testid="group-history-section">
        <h3 className="mb-2 text-body font-semibold text-[var(--color-text-primary)]">
          Replication History
        </h3>
        <StateInTimeView objectDn={group.distinguishedName} objectType="group" />
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

      <ContextMenu
        items={contextMenuItems}
        position={contextMenuPos}
        onClose={() => setContextMenuPos(null)}
      />
    </div>
  );
}
