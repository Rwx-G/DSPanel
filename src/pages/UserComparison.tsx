import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Search,
  GitCompareArrows,
  RotateCcw,
  Users,
  UserPlus,
  Info,
} from "lucide-react";
import { useComparison } from "@/hooks/useComparison";
import { useDebounce } from "@/hooks/useDebounce";
import { useNavigation } from "@/contexts/NavigationContext";
import { type DirectoryEntry } from "@/types/directory";
import { type GroupCategory, type GroupDisplayItem } from "@/types/comparison";
import { formatOuPath } from "@/utils/dn";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import {
  ContextMenu,
  type ContextMenuItem,
} from "@/components/common/ContextMenu";
import { GroupMembersDialog } from "@/components/dialogs/GroupMembersDialog";
import { UncPermissionsAudit } from "@/components/comparison/UncPermissionsAudit";
import { useNotifications } from "@/contexts/NotificationContext";

function parseDnOu(dn: string): string {
  const ou = formatOuPath(dn);
  return ou || "-";
}

function formatAccountStatus(entry: DirectoryEntry): string {
  const uac = parseInt(entry.attributes?.userAccountControl?.[0] ?? "0", 10);
  const disabled = (uac & 0x0002) !== 0;
  const locked =
    entry.attributes?.lockoutTime?.[0] !== undefined &&
    entry.attributes.lockoutTime[0] !== "" &&
    entry.attributes.lockoutTime[0] !== "0";
  if (disabled && locked) return "Disabled, Locked";
  if (disabled) return "Disabled";
  if (locked) return "Locked";
  return "Active";
}

const CATEGORY_STYLES: Record<
  GroupCategory,
  { bg: string; text: string; label: string }
> = {
  shared: {
    bg: "bg-[var(--color-success-bg)]",
    text: "text-[var(--color-success)]",
    label: "Shared",
  },
  onlyA: {
    bg: "bg-[var(--color-error-bg)]",
    text: "text-[var(--color-error)]",
    label: "Only A",
  },
  onlyB: {
    bg: "bg-[var(--color-primary-subtle)]",
    text: "text-[var(--color-primary)]",
    label: "Only B",
  },
};

function UserSearchField({
  label,
  onSelect,
  selectedUser,
  testId,
}: {
  label: string;
  onSelect: (sam: string) => void;
  selectedUser: DirectoryEntry | null;
  testId: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DirectoryEntry[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const debouncedQuery = useDebounce(query, 300);

  const search = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const entries = await invoke<DirectoryEntry[]>("search_users", {
        query: q,
      });
      setResults(entries);
      setShowDropdown(true);
    } catch {
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  // Trigger search on debounced query change
  useState(() => {
    if (debouncedQuery.length >= 2) {
      search(debouncedQuery);
    }
  });

  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <label className="text-caption font-medium text-[var(--color-text-secondary)]">
        {label}
      </label>
      <div className="relative">
        <div className="flex items-center gap-2 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-1.5">
          <Search
            size={16}
            className="shrink-0 text-[var(--color-text-secondary)]"
            aria-hidden="true"
          />
          <input
            type="text"
            className="flex-1 bg-transparent text-body text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-secondary)]"
            placeholder="Search by name or SAM..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (e.target.value.length >= 2) {
                search(e.target.value);
              } else {
                setResults([]);
                setShowDropdown(false);
              }
            }}
            onFocus={() => {
              if (results.length > 0) setShowDropdown(true);
            }}
            onBlur={() => {
              setTimeout(() => setShowDropdown(false), 200);
            }}
            data-testid={`${testId}-input`}
          />
          {isSearching && <LoadingSpinner size="sm" />}
        </div>
        {showDropdown && results.length > 0 && (
          <div
            className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-elevated)] shadow-lg"
            data-testid={`${testId}-dropdown`}
          >
            {results.map((entry) => (
              <button
                key={entry.distinguishedName}
                className="flex w-full items-baseline gap-2 px-3 py-2 text-left text-body hover:bg-[var(--color-surface-hover)] transition-colors"
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (entry.samAccountName) {
                    onSelect(entry.samAccountName);
                    setQuery(entry.displayName ?? entry.samAccountName);
                    setShowDropdown(false);
                  }
                }}
                data-testid={`${testId}-result-${entry.samAccountName}`}
              >
                <span className="font-medium text-[var(--color-text-primary)]">
                  {entry.displayName ?? entry.samAccountName}
                </span>
                <span className="text-caption text-[var(--color-text-secondary)]">
                  ({entry.samAccountName})
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      {selectedUser && (
        <div
          className="rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-3"
          data-testid={`${testId}-selected`}
        >
          <div className="text-body font-medium text-[var(--color-text-primary)]">
            {selectedUser.displayName ?? selectedUser.samAccountName}
          </div>
          <div className="mt-1 space-y-0.5 text-caption text-[var(--color-text-secondary)]">
            <div>SAM: {selectedUser.samAccountName}</div>
            <div>Title: {selectedUser.attributes?.title?.[0] ?? "-"}</div>
            <div>
              Department: {selectedUser.attributes?.department?.[0] ?? "-"}
            </div>
            <div>
              OU:{" "}
              {selectedUser.distinguishedName
                ? parseDnOu(selectedUser.distinguishedName)
                : "-"}
            </div>
            <div>
              Last Logon: {selectedUser.attributes?.lastLogon?.[0] ?? "-"}
            </div>
            <div>Status: {formatAccountStatus(selectedUser)}</div>
            <div>Groups: {selectedUser.attributes?.memberOf?.length ?? 0}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function UncPermissionsSection({
  userA,
  userB,
}: {
  userA: DirectoryEntry;
  userB: DirectoryEntry;
}) {
  const [showInfo, setShowInfo] = useState(false);

  return (
    <div
      className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-4"
      data-testid="unc-permissions-section"
    >
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-body font-semibold text-[var(--color-text-primary)]">
          UNC Path Permissions Audit
        </h2>
        <div className="relative" data-testid="unc-info">
          <button
            className="flex h-6 w-6 items-center justify-center rounded-full text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
            onClick={() => setShowInfo(!showInfo)}
            onBlur={() => setTimeout(() => setShowInfo(false), 150)}
            aria-label="About UNC permissions audit"
            data-testid="unc-info-button"
          >
            <Info size={14} />
          </button>
          {showInfo && (
            <div
              className="absolute bottom-full left-1/2 z-50 mb-2 w-80 -translate-x-1/2 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-3 shadow-lg"
              data-testid="unc-info-popup"
            >
              <p className="text-caption font-semibold text-[var(--color-text-primary)] mb-1">
                Permissions Cross-Reference
              </p>
              <p className="text-caption text-[var(--color-text-secondary)]">
                Enter a UNC path to see its NTFS permissions cross-referenced
                with both users. Each ACE shows whether User A and User B have
                access through their group memberships, helping you quickly
                identify why one user can access a resource and the other
                cannot.
              </p>
            </div>
          )}
        </div>
      </div>
      <UncPermissionsAudit userA={userA} userB={userB} />
    </div>
  );
}

export function UserComparison() {
  const {
    userA,
    userB,
    comparisonResult,
    isComparing,
    error,
    filter,
    sortField,
    sortDirection,
    filteredGroups,
    selectUserA,
    selectUserB,
    compare,
    setFilter,
    setSortField,
    setSortDirection,
    reset,
    prefill,
  } = useComparison();

  const { notify } = useNotifications();
  const { openTabs, activeTabId, clearTabData } = useNavigation();

  // React to prefill data passed via tab navigation
  useEffect(() => {
    const tab = openTabs.find(
      (t) => t.id === activeTabId && t.moduleId === "user-comparison",
    );
    if (tab?.data?.compareSamA && tab?.data?.compareSamB) {
      const samA = tab.data.compareSamA as string;
      const samB = tab.data.compareSamB as string;
      // Clear data immediately so it doesn't re-trigger
      clearTabData(tab.id);
      prefill(samA, samB);
    }
  }, [activeTabId, openTabs, prefill, clearTabData]);

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

  const handleGroupContextMenu = useCallback(
    (e: React.MouseEvent, group: GroupDisplayItem) => {
      e.preventDefault();
      const items: ContextMenuItem[] = [
        {
          label: "View group members",
          icon: <Users size={14} />,
          onClick: () =>
            setGroupMembersDialog({ dn: group.dn, name: group.name }),
        },
      ];

      if (group.category === "onlyB" && userA) {
        items.push({
          label: `Add ${userA.displayName ?? userA.samAccountName} to this group`,
          icon: <UserPlus size={14} />,
          onClick: async () => {
            try {
              await invoke("add_user_to_group", {
                userDn: userA.distinguishedName,
                groupDn: group.dn,
              });
              notify(
                `${userA.displayName ?? userA.samAccountName} added to ${group.name}`,
                "success",
              );
              compare();
            } catch (err) {
              notify(`Failed to add to group: ${err}`, "error");
            }
          },
        });
      }

      if (group.category === "onlyA" && userB) {
        items.push({
          label: `Add ${userB.displayName ?? userB.samAccountName} to this group`,
          icon: <UserPlus size={14} />,
          onClick: async () => {
            try {
              await invoke("add_user_to_group", {
                userDn: userB.distinguishedName,
                groupDn: group.dn,
              });
              notify(
                `${userB.displayName ?? userB.samAccountName} added to ${group.name}`,
                "success",
              );
              compare();
            } catch (err) {
              notify(`Failed to add to group: ${err}`, "error");
            }
          },
        });
      }

      setContextMenuItems(items);
      setContextMenuPos({ x: e.clientX, y: e.clientY });
    },
    [userA, userB, compare, notify],
  );

  const userAName = userA?.displayName ?? userA?.samAccountName ?? "User A";
  const userBName = userB?.displayName ?? userB?.samAccountName ?? "User B";

  const canCompare = userA !== null && userB !== null && !isComparing;

  return (
    <div
      className="flex h-full flex-col gap-4 overflow-y-auto p-4"
      data-testid="user-comparison-page"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">
          User Comparison
        </h1>
        <button
          className="btn btn-outline btn-sm flex items-center gap-1.5"
          onClick={reset}
          data-testid="comparison-reset"
        >
          <RotateCcw size={14} />
          Reset
        </button>
      </div>

      {/* User selection panels */}
      <div className="grid grid-cols-2 gap-4">
        <UserSearchField
          label="User A"
          onSelect={selectUserA}
          selectedUser={userA}
          testId="user-a"
        />
        <UserSearchField
          label="User B"
          onSelect={selectUserB}
          selectedUser={userB}
          testId="user-b"
        />
      </div>

      {/* Compare button */}
      <div className="flex justify-center">
        <button
          className="btn btn-primary btn-sm flex items-center gap-1.5"
          onClick={compare}
          disabled={!canCompare}
          data-testid="compare-button"
        >
          {isComparing ? (
            <LoadingSpinner size="sm" />
          ) : (
            <GitCompareArrows size={16} />
          )}
          Compare Groups
        </button>
      </div>

      {/* Error */}
      {error && (
        <div
          className="rounded-md border border-[var(--color-error)] bg-[var(--color-error-bg)] px-4 py-2 text-body text-[var(--color-error)]"
          data-testid="comparison-error"
        >
          {error}
        </div>
      )}

      {/* Results */}
      {comparisonResult && (
        <div className="flex flex-col gap-3" data-testid="comparison-results">
          {/* Delta summary */}
          <div
            className="flex items-center gap-4 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-4 py-3"
            data-testid="delta-summary"
          >
            <div className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-full bg-[var(--color-success)]" />
              <span className="text-body text-[var(--color-text-primary)]">
                <strong>{comparisonResult.sharedGroups.length}</strong> shared
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-full bg-[var(--color-error)]" />
              <span className="text-body text-[var(--color-text-primary)]">
                <strong>{comparisonResult.onlyAGroups.length}</strong>{" "}
                {userAName} only
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-full bg-[var(--color-primary)]" />
              <span className="text-body text-[var(--color-text-primary)]">
                <strong>{comparisonResult.onlyBGroups.length}</strong>{" "}
                {userBName} only
              </span>
            </div>
            <div className="ml-auto text-caption text-[var(--color-text-secondary)]">
              {userAName}: {comparisonResult.totalA} groups | {userBName}:{" "}
              {comparisonResult.totalB} groups
            </div>
          </div>

          {/* Filter & sort */}
          <div className="flex items-center gap-3">
            <div className="flex flex-1 items-center gap-2 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-1.5">
              <Search
                size={16}
                className="shrink-0 text-[var(--color-text-secondary)]"
                aria-hidden="true"
              />
              <input
                type="text"
                className="flex-1 bg-transparent text-body text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-secondary)]"
                placeholder="Filter groups..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                data-testid="group-filter"
              />
            </div>
            <select
              className="rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-bg)] px-3 py-1.5 text-body text-[var(--color-text-primary)]"
              value={sortField}
              onChange={(e) =>
                setSortField(e.target.value as "name" | "category")
              }
              data-testid="sort-field"
            >
              <option value="name">Sort by Name</option>
              <option value="category">Sort by Type</option>
            </select>
            <button
              className="btn btn-ghost px-2 py-1.5 text-caption"
              onClick={() =>
                setSortDirection(sortDirection === "asc" ? "desc" : "asc")
              }
              data-testid="sort-direction"
            >
              {sortDirection === "asc" ? "A-Z" : "Z-A"}
            </button>
          </div>

          {/* Group list - fixed height with internal scroll */}
          <div className="max-h-[360px] overflow-y-auto rounded-lg border border-[var(--color-border-default)]">
            {filteredGroups.length === 0 ? (
              <div className="py-8 text-center text-caption text-[var(--color-text-secondary)]">
                No groups to display
              </div>
            ) : (
              <div>
                {filteredGroups.map((group, idx) => {
                  const style = CATEGORY_STYLES[group.category];
                  return (
                    <div
                      key={`${group.dn}-${group.category}-${idx}`}
                      className={`flex cursor-context-menu items-center gap-3 border-b border-[var(--color-border-subtle)] px-4 py-2 last:border-b-0 ${style.bg}`}
                      data-testid={`group-item-${idx}`}
                      data-category={group.category}
                      onContextMenu={(e) => handleGroupContextMenu(e, group)}
                    >
                      <span
                        className={`inline-flex min-w-[60px] items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-medium ${style.text} ${style.bg}`}
                      >
                        {group.category === "shared"
                          ? "Shared"
                          : group.category === "onlyA"
                            ? userAName
                            : userBName}
                      </span>
                      <span className="flex-1 text-body text-[var(--color-text-primary)]">
                        {group.name}
                      </span>
                      <span className="text-caption text-[var(--color-text-secondary)] truncate max-w-[300px]">
                        {group.dn}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* UNC Permissions Audit */}
      {comparisonResult && userA && userB && (
        <UncPermissionsSection userA={userA} userB={userB} />
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
