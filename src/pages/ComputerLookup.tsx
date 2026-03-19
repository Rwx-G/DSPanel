import { useState, useCallback, useMemo } from "react";
import { SearchBar } from "@/components/common/SearchBar";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { EmptyState } from "@/components/common/EmptyState";
import { StatusBadge } from "@/components/common/StatusBadge";
import { VirtualizedList } from "@/components/data/VirtualizedList";
import { type DirectoryComputer, mapEntryToComputer } from "@/types/directory";
import { useBrowse } from "@/hooks/useBrowse";
import { ComputerDetail } from "@/pages/ComputerDetail";
import { MonitorX, AlertCircle, Monitor } from "lucide-react";

type StatusFilter = "all" | "enabled" | "disabled";
type OsFilter = "all" | "windows" | "other";

function useComputerBrowse() {
  return useBrowse<DirectoryComputer>({
    browseCommand: "browse_computers",
    searchCommand: "search_computers",
    mapEntry: mapEntryToComputer,
    clientFilter: (c, lower) =>
      c.name.toLowerCase().includes(lower) ||
      c.dnsHostName.toLowerCase().includes(lower),
    itemKey: (c) => c.distinguishedName,
    preloadAll: true,
  });
}

export function ComputerLookup() {
  const {
    items: computers,
    loading,
    loadingMore,
    error,
    hasMore,
    filterText,
    setFilterText,
    loadMore,
    selectedItem: selectedComputer,
    setSelectedItem: setSelectedComputer,
    refresh,
  } = useComputerBrowse();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [osFilter, setOsFilter] = useState<OsFilter>("all");

  const filteredComputers = useMemo(() => {
    let result = computers;
    if (statusFilter === "enabled") result = result.filter((c) => c.enabled);
    if (statusFilter === "disabled") result = result.filter((c) => !c.enabled);
    if (osFilter === "windows")
      result = result.filter((c) =>
        c.operatingSystem.toLowerCase().includes("windows"),
      );
    if (osFilter === "other")
      result = result.filter(
        (c) => !c.operatingSystem.toLowerCase().includes("windows"),
      );
    return result;
  }, [computers, statusFilter, osFilter]);

  const statusCounts = useMemo(() => {
    let enabled = 0, disabled = 0;
    for (const c of computers) {
      if (c.enabled) enabled++;
      else disabled++;
    }
    return { enabled, disabled };
  }, [computers]);

  const osCounts = useMemo(() => {
    let windows = 0, other = 0;
    for (const c of computers) {
      if (c.operatingSystem.toLowerCase().includes("windows")) windows++;
      else other++;
    }
    return { windows, other };
  }, [computers]);

  const handleFilterChange = useCallback(
    async (query: string) => {
      setFilterText(query);
    },
    [setFilterText],
  );

  const renderComputerItem = useCallback(
    (computer: DirectoryComputer) => (
      <button
        className={`flex w-full items-center gap-2 border-b border-[var(--color-border-subtle)] px-3 py-2 text-left transition-colors hover:bg-[var(--color-surface-hover)] ${
          selectedComputer?.distinguishedName === computer.distinguishedName
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
    ),
    [selectedComputer, setSelectedComputer],
  );

  return (
    <div className="flex h-full flex-col" data-testid="computer-lookup">
      <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] px-3 py-2">
        <div className="flex-1">
          <SearchBar
            value={filterText}
            onChange={handleFilterChange}
            onSearch={handleFilterChange}
            placeholder="Search by computer name..."
            debounceMs={300}
          />
        </div>
        <div className="flex items-center gap-1">
          {(
            [
              { key: "all", label: "All" },
              { key: "enabled", label: "Enabled" },
              { key: "disabled", label: "Disabled" },
            ] as const
          ).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setStatusFilter(key)}
              className={`btn btn-sm ${statusFilter === key ? "btn-outline" : "btn-ghost"}`}
            >
              {label}
              {key !== "all" && (
                <span className="ml-1 opacity-70">({statusCounts[key]})</span>
              )}
            </button>
          ))}
        </div>
        <span className="h-4 w-px bg-[var(--color-border-default)]" />
        <div className="flex items-center gap-1">
          {(
            [
              { key: "all", label: "All OS" },
              { key: "windows", label: "Windows" },
              { key: "other", label: "Other" },
            ] as const
          ).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setOsFilter(key)}
              className={`btn btn-sm ${osFilter === key ? "btn-outline" : "btn-ghost"}`}
            >
              {label}
              {key !== "all" && (
                <span className="ml-1 opacity-70">({osCounts[key]})</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div
        className="sr-only"
        aria-live="polite"
        data-testid="computer-lookup-status"
      >
        {loading && "Loading computers..."}
        {!loading &&
          filteredComputers.length > 0 &&
          `${filteredComputers.length} computer${filteredComputers.length > 1 ? "s" : ""} found`}
        {!loading && filteredComputers.length === 0 && !error && "No computers found"}
        {error && `Error: ${error}`}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {loading && (
          <div
            className="flex flex-1 items-center justify-center"
            data-testid="computer-lookup-loading"
          >
            <LoadingSpinner message="Loading computers..." />
          </div>
        )}

        {!loading && error && (
          <div
            className="flex flex-1 items-center justify-center"
            data-testid="computer-lookup-error"
          >
            <EmptyState
              icon={<AlertCircle size={48} />}
              title="Failed to load computers"
              description={error}
              action={{ label: "Retry", onClick: refresh }}
            />
          </div>
        )}

        {!loading && !error && filteredComputers.length === 0 && (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon={<MonitorX size={48} />}
              title="No computers found"
              description={
                statusFilter !== "all" || osFilter !== "all"
                  ? "No computers match the selected filters."
                  : filterText
                    ? `No computers match "${filterText}".`
                    : "No computers available."
              }
            />
          </div>
        )}

        {!loading && !error && filteredComputers.length > 0 && (
          <>
            <div
              className="w-64 shrink-0 border-r border-[var(--color-border-subtle)]"
              data-testid="computer-results-list"
            >
              <VirtualizedList
                items={filteredComputers}
                renderItem={renderComputerItem}
                estimateSize={52}
                itemKey={(computer) => computer.distinguishedName}
                loadingMore={loadingMore}
                onEndReached={hasMore ? loadMore : undefined}
                className="h-full"
              />
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
