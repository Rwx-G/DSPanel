import { SearchBar } from "@/components/common/SearchBar";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { EmptyState } from "@/components/common/EmptyState";
import { StatusBadge } from "@/components/common/StatusBadge";
import {
  type DirectoryComputer,
  mapEntryToComputer,
} from "@/types/directory";
import { useLookupState } from "@/hooks/useLookupState";
import { ComputerDetail } from "@/pages/ComputerDetail";
import { Search, MonitorX, AlertCircle, Monitor } from "lucide-react";

export function ComputerLookup() {
  const {
    lookupState,
    errorMessage,
    searchResults,
    lastQuery,
    searchValue,
    setSearchValue,
    handleSearch,
    handleRetry,
    selectedItem: selectedComputer,
    setSelectedItem: setSelectedComputer,
  } = useLookupState<DirectoryComputer>({
    command: "search_computers",
    mapEntry: mapEntryToComputer,
  });

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

      <div className="sr-only" aria-live="polite" data-testid="computer-lookup-status">
        {lookupState === "loading" && "Searching computers..."}
        {lookupState === "results" && `${searchResults.length} computer${searchResults.length > 1 ? "s" : ""} found for "${lastQuery}"`}
        {lookupState === "empty" && `No results for "${lastQuery}"`}
        {lookupState === "error" && `Search failed: ${errorMessage}`}
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
