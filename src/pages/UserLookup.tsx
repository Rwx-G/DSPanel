import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SearchBar } from "@/components/common/SearchBar";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { EmptyState } from "@/components/common/EmptyState";
import { StatusBadge } from "@/components/common/StatusBadge";
import { CopyButton } from "@/components/common/CopyButton";
import {
  PropertyGrid,
  type PropertyGroup,
} from "@/components/data/PropertyGrid";
import { DataTable, type Column } from "@/components/data/DataTable";
import { FilterBar, type FilterChip } from "@/components/data/FilterBar";
import {
  type DirectoryEntry,
  type DirectoryUser,
  mapEntryToUser,
} from "@/types/directory";
import { parseCnFromDn } from "@/utils/dn";
import { Search, UserX, AlertCircle, User } from "lucide-react";

type LookupState = "initial" | "loading" | "results" | "empty" | "error";

export function UserLookup() {
  const [searchValue, setSearchValue] = useState("");
  const [lastQuery, setLastQuery] = useState("");
  const [lookupState, setLookupState] = useState<LookupState>("initial");
  const [errorMessage, setErrorMessage] = useState("");
  const [searchResults, setSearchResults] = useState<DirectoryUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<DirectoryUser | null>(null);
  const [groupFilterText, setGroupFilterText] = useState("");

  const handleSearch = useCallback(async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;

    setLastQuery(trimmed);
    setLookupState("loading");
    setErrorMessage("");
    setSelectedUser(null);

    try {
      const entries = await invoke<DirectoryEntry[]>("search_users", {
        query: trimmed,
      });
      const users = entries.map(mapEntryToUser);
      setSearchResults(users);
      setLookupState(users.length > 0 ? "results" : "empty");

      if (users.length === 1) {
        setSelectedUser(users[0]);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Search failed");
      setLookupState("error");
    }
  }, []);

  const handleRetry = useCallback(() => {
    if (lastQuery) {
      handleSearch(lastQuery);
    }
  }, [lastQuery, handleSearch]);

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
          onSearch={handleSearch}
          placeholder="Search by name, username, or email..."
          debounceMs={0}
        />
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
                  <StatusBadge
                    text={user.enabled ? "Active" : "Disabled"}
                    variant={user.enabled ? "success" : "error"}
                  />
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

interface UserDetailProps {
  user: DirectoryUser;
  groupColumns: Column<{ name: string; dn: string }>[];
  groupRows: { name: string; dn: string }[];
  groupFilterText: string;
  onGroupFilterText: (value: string) => void;
}

function UserDetail({
  user,
  groupColumns,
  groupRows,
  groupFilterText,
  onGroupFilterText,
}: UserDetailProps) {
  const [groupFilters, setGroupFilters] = useState<FilterChip[]>([]);

  const propertyGroups: PropertyGroup[] = [
    {
      category: "Identity",
      items: [
        { label: "Display Name", value: user.displayName },
        { label: "First Name", value: user.givenName },
        { label: "Last Name", value: user.surname },
        { label: "Email", value: user.email },
        { label: "Department", value: user.department },
        { label: "Title", value: user.title },
      ],
    },
    {
      category: "Location",
      items: [
        { label: "OU Path", value: user.organizationalUnit },
        { label: "Distinguished Name", value: user.distinguishedName },
      ],
    },
    {
      category: "Account Status",
      items: [
        { label: "Status", value: user.enabled ? "Enabled" : "Disabled" },
        { label: "Locked Out", value: user.lockedOut ? "Yes" : "No" },
        { label: "Account Expires", value: user.accountExpires ?? "Never" },
      ],
    },
    {
      category: "Authentication",
      items: [
        { label: "Bad Password Count", value: String(user.badPasswordCount) },
        { label: "Last Logon", value: user.lastLogon ?? "Never" },
        {
          label: "Last Logon Workstation",
          value: user.lastLogonWorkstation || "N/A",
        },
      ],
    },
    {
      category: "Dates",
      items: [
        { label: "Password Last Set", value: user.passwordLastSet ?? "Never" },
        {
          label: "Password Expired",
          value: user.passwordExpired ? "Yes" : "No",
        },
        {
          label: "Password Never Expires",
          value: user.passwordNeverExpires ? "Yes" : "No",
        },
        { label: "Created", value: user.whenCreated || "N/A" },
        { label: "Modified", value: user.whenChanged || "N/A" },
      ],
    },
  ];

  return (
    <div className="space-y-4" data-testid="user-detail">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
          {user.displayName || user.samAccountName}
        </h2>
        <div className="flex items-center gap-2">
          <StatusBadge
            text={user.enabled ? "Enabled" : "Disabled"}
            variant={user.enabled ? "success" : "error"}
          />
          {user.lockedOut && <StatusBadge text="Locked" variant="warning" />}
        </div>
      </div>

      <div className="flex items-center gap-1 text-caption text-[var(--color-text-secondary)]">
        <span>{user.samAccountName}</span>
        <CopyButton text={user.samAccountName} />
      </div>

      <PropertyGrid groups={propertyGroups} />

      <div data-testid="user-groups-section">
        <h3 className="mb-2 text-body font-semibold text-[var(--color-text-primary)]">
          Group Memberships ({user.memberOf.length})
        </h3>
        <FilterBar
          filters={groupFilters}
          onFilterChange={setGroupFilters}
          onTextFilter={onGroupFilterText}
          placeholder="Filter groups..."
        />
        <DataTable
          columns={groupColumns}
          data={groupRows}
          rowKey={(row) => row.dn}
        />
      </div>
    </div>
  );
}
