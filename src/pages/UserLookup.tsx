import { useState, useCallback, useEffect } from "react";
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
import { evaluateHealth } from "@/services/healthcheck";
import { parseCnFromDn } from "@/utils/dn";
import { useUserBrowse } from "@/hooks/useUserBrowse";
import { UserDetail } from "@/pages/UserDetail";
import { UserX, AlertCircle, User } from "lucide-react";

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
    refresh,
  } = useUserBrowse();

  const [groupFilterText, setGroupFilterText] = useState("");
  const [healthMap, setHealthMap] = useState<Map<string, AccountHealthStatus>>(
    new Map(),
  );

  useEffect(() => {
    if (users.length === 0) return;
    let cancelled = false;

    const computeHealth = async () => {
      const CONCURRENCY = 3;
      const map = new Map<string, AccountHealthStatus>();

      for (let i = 0; i < users.length; i += CONCURRENCY) {
        if (cancelled) return;
        const batch = users.slice(i, i + CONCURRENCY);
        const entries = await Promise.allSettled(
          batch.map(async (user) => {
            const status = await evaluateHealth(user);
            return [user.samAccountName, status] as const;
          }),
        );
        for (const entry of entries) {
          if (entry.status === "fulfilled") {
            const [key, value] = entry.value;
            map.set(key, value);
          }
        }
        if (!cancelled) {
          setHealthMap(new Map(map));
        }
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
  }, [selectedUser, setSelectedUser]);

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

  const renderUserItem = useCallback(
    (user: DirectoryUser) => (
      <button
        className={`flex w-full items-center gap-2 border-b border-[var(--color-border-subtle)] px-3 py-2 text-left transition-colors hover:bg-[var(--color-surface-hover)] ${
          selectedUser?.samAccountName === user.samAccountName
            ? "bg-[var(--color-surface-selected)]"
            : ""
        }`}
        onClick={() => setSelectedUser(user)}
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
          <HealthBadge healthStatus={healthMap.get(user.samAccountName)!} />
        )}
      </button>
    ),
    [selectedUser, setSelectedUser, healthMap],
  );

  return (
    <div className="flex h-full flex-col" data-testid="user-lookup">
      <div className="border-b border-[var(--color-border-subtle)] p-3">
        <SearchBar
          value={filterText}
          onChange={handleFilterChange}
          onSearch={handleFilterChange}
          placeholder="Search by name, username, or email..."
          debounceMs={300}
        />
      </div>

      <div
        className="sr-only"
        aria-live="polite"
        data-testid="user-lookup-status"
      >
        {loading && "Loading users..."}
        {!loading &&
          users.length > 0 &&
          `${users.length} user${users.length > 1 ? "s" : ""} found`}
        {!loading && users.length === 0 && !error && "No users found"}
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

        {!loading && !error && users.length === 0 && (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon={<UserX size={48} />}
              title="No users found"
              description={
                filterText
                  ? `No users match "${filterText}".`
                  : "No users available."
              }
            />
          </div>
        )}

        {!loading && !error && users.length > 0 && (
          <>
            <div
              className="w-64 shrink-0 border-r border-[var(--color-border-subtle)]"
              data-testid="user-results-list"
            >
              <VirtualizedList
                items={users}
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
    </div>
  );
}
