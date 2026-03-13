import { useState, useCallback, useEffect, useRef } from "react";
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
  type DirectoryComputer,
  mapEntryToComputer,
} from "@/types/directory";
import { parseCnFromDn } from "@/utils/dn";
import { Search, MonitorX, AlertCircle, Monitor } from "lucide-react";

type LookupState = "initial" | "loading" | "results" | "empty" | "error";

export function ComputerLookup() {
  const [searchValue, setSearchValue] = useState("");
  const [lastQuery, setLastQuery] = useState("");
  const [lookupState, setLookupState] = useState<LookupState>("initial");
  const [errorMessage, setErrorMessage] = useState("");
  const [searchResults, setSearchResults] = useState<DirectoryComputer[]>([]);
  const [selectedComputer, setSelectedComputer] =
    useState<DirectoryComputer | null>(null);

  const handleSearch = useCallback(async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;

    setLastQuery(trimmed);
    setLookupState("loading");
    setErrorMessage("");
    setSelectedComputer(null);

    try {
      const entries = await invoke<DirectoryEntry[]>("search_computers", {
        query: trimmed,
      });
      const computers = entries.map(mapEntryToComputer);
      setSearchResults(computers);
      setLookupState(computers.length > 0 ? "results" : "empty");

      if (computers.length === 1) {
        setSelectedComputer(computers[0]);
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

  return (
    <div className="flex h-full flex-col" data-testid="computer-lookup">
      <div className="border-b border-[var(--color-border-subtle)] p-3">
        <SearchBar
          value={searchValue}
          onChange={setSearchValue}
          onSearch={handleSearch}
          placeholder="Search by computer name..."
          debounceMs={0}
        />
      </div>

      <div className="flex flex-1 overflow-hidden">
        {lookupState === "initial" && (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon={<Search size={48} />}
              title="Search for a computer"
              description="Enter a computer name to get started."
            />
          </div>
        )}

        {lookupState === "loading" && (
          <div
            className="flex flex-1 items-center justify-center"
            data-testid="computer-lookup-loading"
          >
            <LoadingSpinner message="Searching..." />
          </div>
        )}

        {lookupState === "empty" && (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon={<MonitorX size={48} />}
              title="No computers found"
              description={`No computers match "${lastQuery}".`}
            />
          </div>
        )}

        {lookupState === "error" && (
          <div
            className="flex flex-1 items-center justify-center"
            data-testid="computer-lookup-error"
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
              data-testid="computer-results-list"
            >
              {searchResults.map((computer) => (
                <button
                  key={computer.distinguishedName}
                  className={`flex w-full items-center gap-2 border-b border-[var(--color-border-subtle)] px-3 py-2 text-left transition-colors hover:bg-[var(--color-surface-hover)] ${
                    selectedComputer?.distinguishedName ===
                    computer.distinguishedName
                      ? "bg-[var(--color-surface-selected)]"
                      : ""
                  }`}
                  onClick={() => setSelectedComputer(computer)}
                  data-testid={`computer-result-${computer.name}`}
                >
                  <Monitor
                    size={16}
                    className="shrink-0 text-[var(--color-text-secondary)]"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body font-medium text-[var(--color-text-primary)]">
                      {computer.name}
                    </p>
                    <p className="truncate text-caption text-[var(--color-text-secondary)]">
                      {computer.operatingSystem || "Unknown OS"}
                    </p>
                  </div>
                  <StatusBadge
                    text={computer.enabled ? "Active" : "Disabled"}
                    variant={computer.enabled ? "success" : "error"}
                  />
                </button>
              ))}
            </div>

            <div
              className="flex-1 overflow-auto p-4"
              data-testid="computer-detail-panel"
            >
              {selectedComputer ? (
                <ComputerDetail computer={selectedComputer} />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <p className="text-body text-[var(--color-text-secondary)]">
                    Select a computer to view details
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

function ComputerDetail({ computer }: { computer: DirectoryComputer }) {
  const [groupFilterText, setGroupFilterText] = useState("");
  const [groupFilters, setGroupFilters] = useState<FilterChip[]>([]);
  const [pingResult, setPingResult] = useState<string | null>(null);
  const [isPinging, setIsPinging] = useState(false);
  const [resolvedAddresses, setResolvedAddresses] = useState<string[]>([]);
  const [isResolvingDns, setIsResolvingDns] = useState(false);
  const dnsCacheRef = useRef<Map<string, string[]>>(new Map());

  useEffect(() => {
    if (!computer.dnsHostName) {
      setResolvedAddresses([]);
      setPingResult(null);
      return;
    }

    const cached = dnsCacheRef.current.get(computer.dnsHostName);
    if (cached) {
      setResolvedAddresses(cached);
      setPingResult(null);
      return;
    }

    setIsResolvingDns(true);
    setResolvedAddresses([]);
    setPingResult(null);

    invoke<string[]>("resolve_dns", { hostname: computer.dnsHostName })
      .then((addrs) => {
        dnsCacheRef.current.set(computer.dnsHostName!, addrs);
        setResolvedAddresses(addrs);
      })
      .catch(() => setResolvedAddresses(["DNS resolution failed"]))
      .finally(() => setIsResolvingDns(false));
  }, [computer.dnsHostName]);

  const handlePing = async () => {
    if (!computer.dnsHostName) return;
    setIsPinging(true);
    try {
      const result = await invoke<string>("ping_host", {
        hostname: computer.dnsHostName,
      });
      setPingResult(result);
    } catch {
      setPingResult("Unreachable (ping failed)");
    } finally {
      setIsPinging(false);
    }
  };

  const filteredGroups = computer.memberOf.filter((dn) =>
    parseCnFromDn(dn).toLowerCase().includes(groupFilterText.toLowerCase()),
  );

  const groupColumns: Column<{ name: string; dn: string }>[] = [
    { key: "name", header: "Group Name", sortable: true },
    { key: "dn", header: "Distinguished Name", sortable: true },
  ];

  const groupRows = filteredGroups.map((dn) => ({
    name: parseCnFromDn(dn),
    dn,
  }));

  const propertyGroups: PropertyGroup[] = [
    {
      category: "Identity",
      items: [
        { label: "Computer Name", value: computer.name },
        { label: "DNS Hostname", value: computer.dnsHostName },
        { label: "Operating System", value: computer.operatingSystem },
        { label: "OS Version", value: computer.osVersion },
      ],
    },
    {
      category: "Status",
      items: [
        {
          label: "Account Status",
          value: computer.enabled ? "Enabled" : "Disabled",
        },
        { label: "Last Logon", value: computer.lastLogon ?? "Never" },
      ],
    },
    {
      category: "Location",
      items: [
        { label: "OU Path", value: computer.organizationalUnit },
        {
          label: "Distinguished Name",
          value: computer.distinguishedName,
        },
      ],
    },
    {
      category: "Network",
      items: [
        {
          label: "IP Address(es)",
          value: isResolvingDns
            ? "Resolving..."
            : resolvedAddresses.length > 0
              ? resolvedAddresses.join(", ")
              : "N/A",
        },
        { label: "Ping", value: pingResult ?? "Not tested" },
      ],
    },
  ];

  return (
    <div className="space-y-4" data-testid="computer-detail">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
          {computer.name}
        </h2>
        <div className="flex items-center gap-2">
          <StatusBadge
            text={computer.enabled ? "Enabled" : "Disabled"}
            variant={computer.enabled ? "success" : "error"}
          />
        </div>
      </div>

      <div className="flex items-center gap-1 text-caption text-[var(--color-text-secondary)]">
        <span>{computer.dnsHostName}</span>
        {computer.dnsHostName && <CopyButton text={computer.dnsHostName} />}
      </div>

      <PropertyGrid groups={propertyGroups} />

      <div className="flex gap-2">
        <button
          className="btn-secondary"
          onClick={handlePing}
          disabled={isPinging || !computer.dnsHostName}
          data-testid="ping-button"
        >
          {isPinging ? "Pinging..." : "Ping"}
        </button>
        {pingResult && (
          <span
            className={`text-caption ${
              pingResult.startsWith("Reachable")
                ? "text-[var(--color-success)]"
                : "text-[var(--color-error)]"
            }`}
            data-testid="ping-result"
          >
            {pingResult}
          </span>
        )}
      </div>

      <div data-testid="computer-groups-section">
        <h3 className="mb-2 text-body font-semibold text-[var(--color-text-primary)]">
          Group Memberships ({computer.memberOf.length})
        </h3>
        <FilterBar
          filters={groupFilters}
          onFilterChange={setGroupFilters}
          onTextFilter={setGroupFilterText}
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
