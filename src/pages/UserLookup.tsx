import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SearchBar } from "@/components/common/SearchBar";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { EmptyState } from "@/components/common/EmptyState";
import { HealthBadge } from "@/components/common/HealthBadge";
import { VirtualizedList } from "@/components/data/VirtualizedList";
import { type Column } from "@/components/data/DataTable";
import {
  type DirectoryEntry,
  type DirectoryUser,
  mapEntryToUser,
} from "@/types/directory";
import type { AccountHealthStatus } from "@/types/health";
import { evaluateHealth, evaluateHealthBatch } from "@/services/healthcheck";
import { parseCnFromDn } from "@/utils/dn";
import { useUserBrowse } from "@/hooks/useUserBrowse";
import { useNavigation } from "@/contexts/NavigationContext";
import {
  ContextMenu,
  type ContextMenuItem,
} from "@/components/common/ContextMenu";
import { UserDetail } from "@/pages/UserDetail";
import { UserX, UserMinus, AlertCircle, User, GitCompareArrows, FolderInput } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import {
  MoveObjectDialog,
  type MoveTarget,
} from "@/components/dialogs/MoveObjectDialog";

type HealthFilter = "all" | "healthy" | "warning" | "critical";

export function UserLookup() {
  const {
    items: users,
    loading,
    loadingMore,
    error,
    hasMore,
    filterText,
    setFilterText,
    loadMore,
    selectedItem: selectedUser,
    setSelectedItem: setSelectedUser,
    updateItem,
    refresh,
  } = useUserBrowse();

  const [healthFilter, setHealthFilter] = useState<HealthFilter>("all");
  const [schemaAttributes, setSchemaAttributes] = useState<string[]>([]);
  const { hasPermission } = usePermissions();
  const canMove = hasPermission("AccountOperator");
  const [moveTargets, setMoveTargets] = useState<MoveTarget[] | null>(null);

  useEffect(() => {
    invoke<string[]>("get_schema_attributes")
      .then(setSchemaAttributes)
      .catch((e) => console.warn("Failed to load schema attributes:", e));
  }, []);

  const { openTab, openTabs, activeTabId, clearTabData } = useNavigation();

  // Deep-link: select a user by SAM account name from another module
  const deepLinkHandled = useRef<string | null>(null);
  const activeTab = openTabs.find((t) => t.id === activeTabId);
  const selectedUserSam = activeTab?.data?.selectedUserSam as
    | string
    | undefined;

  useEffect(() => {
    if (!selectedUserSam || deepLinkHandled.current === selectedUserSam) return;

    // Try to find in loaded users first
    const found = users.find((u) => u.samAccountName === selectedUserSam);
    if (found) {
      setSelectedUser(found);
      deepLinkHandled.current = selectedUserSam;
      if (activeTabId) clearTabData(activeTabId);
      return;
    }

    // Otherwise fetch via get_user command
    if (!loading) {
      invoke<DirectoryEntry | null>("get_user", {
        samAccountName: selectedUserSam,
      })
        .then((entry) => {
          if (entry) {
            setSelectedUser(mapEntryToUser(entry));
          }
        })
        .catch((err) => console.warn("Deep-link user lookup failed:", err))
        .finally(() => {
          deepLinkHandled.current = selectedUserSam;
          if (activeTabId) clearTabData(activeTabId);
        });
    }
  }, [
    selectedUserSam,
    users,
    loading,
    setSelectedUser,
    activeTabId,
    clearTabData,
  ]);

  const [contextMenuPos, setContextMenuPos] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [contextMenuItems, setContextMenuItems] = useState<ContextMenuItem[]>(
    [],
  );
  const [groupFilterText, setGroupFilterText] = useState("");
  const [healthMap, setHealthMap] = useState<Map<string, AccountHealthStatus>>(
    new Map(),
  );

  useEffect(() => {
    if (users.length === 0) return;
    let cancelled = false;

    const computeHealth = async () => {
      try {
        const map = await evaluateHealthBatch(users);
        if (!cancelled) {
          setHealthMap(map);
        }
      } catch (e) {
        console.warn("Health batch evaluation failed:", e);
      }
    };

    computeHealth();
    return () => {
      cancelled = true;
    };
  }, [users]);

  const handleFilterChange = useCallback(
    async (query: string) => {
      // Only reset health map when the filter actually changes the user list
      if (query.length >= 3) {
        setHealthMap(new Map());
      }
      setFilterText(query);
    },
    [setFilterText],
  );

  const refreshSelectedUser = useCallback(async () => {
    if (!selectedUser) return;
    try {
      const entry = await invoke<DirectoryEntry | null>("get_user", {
        samAccountName: selectedUser.samAccountName,
      });
      if (entry) {
        const updated = mapEntryToUser(entry);
        setSelectedUser(updated);
        updateItem(updated.samAccountName, updated);
        const health = await evaluateHealth(updated);
        setHealthMap((prev) => {
          const next = new Map(prev);
          next.set(updated.samAccountName, health);
          return next;
        });
      }
    } catch (e) {
      console.warn("Failed to refresh user:", e);
    }
  }, [selectedUser, setSelectedUser, updateItem]);

  const filteredGroups = selectedUser
    ? selectedUser.memberOf.filter((dn) =>
        parseCnFromDn(dn).toLowerCase().includes(groupFilterText.toLowerCase()),
      )
    : [];

  const groupColumns: Column<{ name: string; dn: string }>[] = [
    { key: "name", header: "Group Name", sortable: true },
    { key: "dn", header: "Distinguished Name", sortable: true },
  ];

  const groupRows = filteredGroups.map((dn) => ({
    name: parseCnFromDn(dn),
    dn,
  }));

  const handleUserContextMenu = useCallback(
    (e: React.MouseEvent, user: DirectoryUser) => {
      e.preventDefault();

      const targetName = user.displayName || user.samAccountName;

      const offboardItem: ContextMenuItem = {
        label: `Start Offboarding for ${targetName}`,
        icon: <UserMinus size={14} />,
        onClick: () => {
          openTab("Offboarding", "offboarding", "user", {
            offboardSam: user.samAccountName,
          });
        },
      };

      const moveItem: ContextMenuItem | null = canMove
        ? {
            label: "Move to OU",
            icon: <FolderInput size={14} />,
            onClick: () => {
              setMoveTargets([
                {
                  distinguishedName: user.distinguishedName,
                  displayName: user.displayName || user.samAccountName,
                },
              ]);
            },
          }
        : null;

      if (!selectedUser) {
        setContextMenuItems([
          {
            label: "Select a user first to compare",
            icon: <GitCompareArrows size={14} />,
            onClick: () => {},
            disabled: true,
          },
          offboardItem,
          ...(moveItem ? [moveItem] : []),
        ]);
        setContextMenuPos({ x: e.clientX, y: e.clientY });
        return;
      }

      if (selectedUser.samAccountName === user.samAccountName) {
        setContextMenuItems([
          {
            label: "Cannot compare a user with itself",
            icon: <GitCompareArrows size={14} />,
            onClick: () => {},
            disabled: true,
          },
          offboardItem,
          ...(moveItem ? [moveItem] : []),
        ]);
        setContextMenuPos({ x: e.clientX, y: e.clientY });
        return;
      }

      const selectedName =
        selectedUser.displayName || selectedUser.samAccountName;

      setContextMenuItems([
        {
          label: `Compare ${selectedName} with ${targetName}`,
          icon: <GitCompareArrows size={14} />,
          onClick: () => {
            openTab("User Comparison", "user-comparison", "compare", {
              compareSamA: selectedUser.samAccountName,
              compareSamB: user.samAccountName,
            });
          },
        },
        offboardItem,
        ...(moveItem ? [moveItem] : []),
      ]);
      setContextMenuPos({ x: e.clientX, y: e.clientY });
    },
    [selectedUser, openTab, canMove],
  );

  const filteredUsers = useMemo(() => {
    if (healthFilter === "all") return users;
    return users.filter((u) => {
      const health = healthMap.get(u.samAccountName);
      if (!health) return false;
      if (healthFilter === "healthy") return health.level === "Healthy";
      if (healthFilter === "warning") return health.level === "Warning";
      if (healthFilter === "critical") return health.level === "Critical";
      return true;
    });
  }, [users, healthMap, healthFilter]);

  const healthCounts = useMemo(() => {
    let healthy = 0,
      warning = 0,
      critical = 0;
    for (const [, status] of healthMap) {
      if (status.level === "Healthy") healthy++;
      else if (status.level === "Warning") warning++;
      else if (status.level === "Critical") critical++;
    }
    return { healthy, warning, critical };
  }, [healthMap]);

  const renderUserItem = useCallback(
    (user: DirectoryUser) => (
      <button
        className={`flex w-full items-center gap-2 border-b border-[var(--color-border-subtle)] px-3 py-2 text-left transition-colors hover:bg-[var(--color-surface-hover)] ${
          selectedUser?.samAccountName === user.samAccountName
            ? "bg-[var(--color-surface-selected)]"
            : ""
        }`}
        onClick={() => {
          setSelectedUser(user);
          // Fetch full attributes for detail view
          invoke<DirectoryEntry | null>("get_user", {
            samAccountName: user.samAccountName,
          }).then((entry) => {
            if (entry) setSelectedUser(mapEntryToUser(entry));
          }).catch(() => {});
        }}
        onContextMenu={(e) => handleUserContextMenu(e, user)}
        data-testid={`user-result-${user.samAccountName}`}
      >
        <User
          size={16}
          className="shrink-0 text-[var(--color-text-secondary)]"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-medium text-[var(--color-text-primary)]">
            {user.displayName || user.samAccountName}
          </p>
          <p className="truncate text-caption text-[var(--color-text-secondary)]">
            {user.samAccountName}
            {user.department ? ` - ${user.department}` : ""}
          </p>
        </div>
        {healthMap.get(user.samAccountName) && (
          <HealthBadge
            healthStatus={healthMap.get(user.samAccountName)!}
            compact={healthMap.get(user.samAccountName)!.level === "Healthy"}
          />
        )}
      </button>
    ),
    [selectedUser, setSelectedUser, healthMap, handleUserContextMenu],
  );

  return (
    <div className="flex h-full flex-col" data-testid="user-lookup">
      <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] px-3 py-2">
        <div className="flex-1">
          <SearchBar
            value={filterText}
            onChange={handleFilterChange}
            onSearch={handleFilterChange}
            placeholder="Search by name, username, or email..."
            debounceMs={300}
          />
        </div>
        <div className="flex items-center gap-1">
          {(
            [
              { key: "all", label: "All" },
              { key: "healthy", label: "Healthy" },
              { key: "warning", label: "Warning" },
              { key: "critical", label: "Critical" },
            ] as const
          ).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setHealthFilter(key)}
              className={`btn btn-sm ${
                healthFilter === key ? "btn-outline" : "btn-ghost"
              }`}
            >
              {label}
              {key !== "all" && healthCounts[key] > 0 && (
                <span className="ml-1 opacity-70">({healthCounts[key]})</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div
        className="sr-only"
        aria-live="polite"
        data-testid="user-lookup-status"
      >
        {loading && "Loading users..."}
        {!loading &&
          filteredUsers.length > 0 &&
          `${filteredUsers.length} user${filteredUsers.length > 1 ? "s" : ""} found`}
        {!loading && filteredUsers.length === 0 && !error && "No users found"}
        {error && `Error: ${error}`}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {loading && (
          <div
            className="flex flex-1 items-center justify-center"
            data-testid="user-lookup-loading"
          >
            <LoadingSpinner message="Loading users..." />
          </div>
        )}

        {!loading && error && (
          <div
            className="flex flex-1 items-center justify-center"
            data-testid="user-lookup-error"
          >
            <EmptyState
              icon={<AlertCircle size={48} />}
              title="Failed to load users"
              description={error}
              action={{ label: "Retry", onClick: refresh }}
            />
          </div>
        )}

        {!loading && !error && filteredUsers.length === 0 && (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon={<UserX size={48} />}
              title="No users found"
              description={
                healthFilter !== "all"
                  ? `No users with "${healthFilter}" health status.`
                  : filterText
                    ? `No users match "${filterText}".`
                    : "No users available."
              }
            />
          </div>
        )}

        {!loading && !error && filteredUsers.length > 0 && (
          <>
            <div
              className="w-64 shrink-0 border-r border-[var(--color-border-subtle)]"
              data-testid="user-results-list"
            >
              <VirtualizedList
                items={filteredUsers}
                renderItem={renderUserItem}
                estimateSize={52}
                itemKey={(user) => user.samAccountName}
                loadingMore={loadingMore}
                onEndReached={hasMore ? loadMore : undefined}
                className="h-full"
              />
            </div>

            <div
              className="flex-1 overflow-auto p-4"
              data-testid="user-detail-panel"
            >
              {selectedUser ? (
                <UserDetail
                  user={selectedUser}
                  healthStatus={healthMap.get(selectedUser.samAccountName)}
                  groupColumns={groupColumns}
                  groupRows={groupRows}
                  groupFilterText={groupFilterText}
                  onGroupFilterText={setGroupFilterText}
                  onRefresh={refreshSelectedUser}
                  onDeleted={() => {
                    setSelectedUser(null);
                    refresh();
                  }}
                  schemaAttributes={schemaAttributes}
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <p className="text-body text-[var(--color-text-secondary)]">
                    Select a user to view details
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
