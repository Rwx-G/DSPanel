import { useState, useCallback, useEffect } from "react";
import { SearchBar } from "@/components/common/SearchBar";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { EmptyState } from "@/components/common/EmptyState";
import { HealthBadge } from "@/components/common/HealthBadge";
import { type Column } from "@/components/data/DataTable";
import { type DirectoryUser, mapEntryToUser } from "@/types/directory";
import type { AccountHealthStatus } from "@/types/health";
import { evaluateHealth } from "@/services/healthcheck";
import { parseCnFromDn } from "@/utils/dn";
import { useLookupState } from "@/hooks/useLookupState";
import { UserDetail } from "@/pages/UserDetail";
import { Search, UserX, AlertCircle, User } from "lucide-react";

export function UserLookup() {
  const {
    lookupState,
    errorMessage,
    searchResults,
    lastQuery,
    searchValue,
    setSearchValue,
    handleSearch,
    handleRetry,
    selectedItem: selectedUser,
    setSelectedItem: setSelectedUser,
  } = useLookupState<DirectoryUser>({
    command: "search_users",
    mapEntry: mapEntryToUser,
  });

  const [groupFilterText, setGroupFilterText] = useState("");
  const [healthMap, setHealthMap] = useState<
    Map<string, AccountHealthStatus>
  >(new Map());

  useEffect(() => {
    if (searchResults.length === 0) return;
    let cancelled = false;

    const computeHealth = async () => {
      const CONCURRENCY = 3;
      const map = new Map<string, AccountHealthStatus>();

      for (let i = 0; i < searchResults.length; i += CONCURRENCY) {
        if (cancelled) return;
        const batch = searchResults.slice(i, i + CONCURRENCY);
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
  }, [searchResults]);

  const handleSearchWithHealthReset = useCallback(
    async (query: string) => {
      setHealthMap(new Map());
      await handleSearch(query);
    },
    [handleSearch],
  );

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

  return (
    <div className="flex h-full flex-col" data-testid="user-lookup">
      <div className="border-b border-[var(--color-border-subtle)] p-3">
        <SearchBar
          value={searchValue}
          onChange={setSearchValue}
          onSearch={handleSearchWithHealthReset}
          placeholder="Search by name, username, or email..."
          debounceMs={0}
        />
      </div>

      <div className="sr-only" aria-live="polite" data-testid="user-lookup-status">
        {lookupState === "loading" && "Searching users..."}
        {lookupState === "results" && `${searchResults.length} user${searchResults.length > 1 ? "s" : ""} found for "${lastQuery}"`}
        {lookupState === "empty" && `No results for "${lastQuery}"`}
        {lookupState === "error" && `Search failed: ${errorMessage}`}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {lookupState === "initial" && (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon={<Search size={48} />}
              title="Search for a user"
              description="Enter a username, display name, or email to get started."
            />
          </div>
        )}

        {lookupState === "loading" && (
          <div
            className="flex flex-1 items-center justify-center"
            data-testid="user-lookup-loading"
          >
            <LoadingSpinner message="Searching..." />
          </div>
        )}

        {lookupState === "empty" && (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon={<UserX size={48} />}
              title="No users found"
              description={`No users match "${lastQuery}".`}
            />
          </div>
        )}

        {lookupState === "error" && (
          <div
            className="flex flex-1 items-center justify-center"
            data-testid="user-lookup-error"
          >
            <EmptyState
              icon={<AlertCircle size={48} />}
              title="Search failed"
              description={errorMessage}
              action={{ label: "Retry", onClick: handleRetry }}
            />
          </div>
        )}

        {lookupState === "results" && (
          <>
            <div
              className="w-64 shrink-0 overflow-auto border-r border-[var(--color-border-subtle)]"
              data-testid="user-results-list"
            >
              {searchResults.map((user) => (
                <button
                  key={user.samAccountName}
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
                    <HealthBadge
                      healthStatus={healthMap.get(user.samAccountName)!}
                    />
                  )}
                </button>
              ))}
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
