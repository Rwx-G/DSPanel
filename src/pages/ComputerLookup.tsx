import { useState, useCallback, useMemo, useEffect } from "react";
import { SearchBar } from "@/components/common/SearchBar";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { EmptyState } from "@/components/common/EmptyState";
import { TruncatedBanner } from "@/components/common/TruncatedBanner";
import { StatusBadge } from "@/components/common/StatusBadge";
import { SecurityIndicatorDot } from "@/components/common/SecurityIndicatorDot";
import { VirtualizedList } from "@/components/data/VirtualizedList";
import {
  ContextMenu,
  type ContextMenuItem,
} from "@/components/common/ContextMenu";
import { type DirectoryComputer, mapEntryToComputer } from "@/types/directory";
import type { SecurityIndicatorSet } from "@/types/securityIndicators";
import { evaluateComputerSecurityIndicatorsBatch } from "@/services/securityIndicators";
import { useBrowse } from "@/hooks/useBrowse";
import { usePermissions } from "@/hooks/usePermissions";
import { ComputerDetail } from "@/pages/ComputerDetail";
import {
  MoveObjectDialog,
  type MoveTarget,
} from "@/components/dialogs/MoveObjectDialog";
import { MonitorX, AlertCircle, Monitor, FolderInput } from "lucide-react";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation(["computerLookup", "common"]);
  const {
    items: computers,
    loading,
    loadingMore,
    error,
    hasMore,
    truncated,
    filterText,
    setFilterText,
    loadMore,
    selectedItem: selectedComputer,
    setSelectedItem: setSelectedComputer,
    refresh,
  } = useComputerBrowse();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [osFilter, setOsFilter] = useState<OsFilter>("all");
  const { hasPermission } = usePermissions();
  const canMove = hasPermission("AccountOperator");
  const [moveTargets, setMoveTargets] = useState<MoveTarget[] | null>(null);
  const [indicatorMap, setIndicatorMap] = useState<
    Map<string, SecurityIndicatorSet>
  >(new Map());

  useEffect(() => {
    if (computers.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const map = await evaluateComputerSecurityIndicatorsBatch(computers);
        if (!cancelled) setIndicatorMap(map);
      } catch (e) {
        console.warn("Computer security indicators batch failed:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [computers]);
  const [contextMenuPos, setContextMenuPos] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [contextMenuItems, setContextMenuItems] = useState<ContextMenuItem[]>(
    [],
  );

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

  const handleComputerContextMenu = useCallback(
    (e: React.MouseEvent, computer: DirectoryComputer) => {
      e.preventDefault();
      const items: ContextMenuItem[] = [];
      if (canMove) {
        items.push({
          label: t("common:moveToOu"),
          icon: <FolderInput size={14} />,
          onClick: () => {
            setMoveTargets([
              {
                distinguishedName: computer.distinguishedName,
                displayName: computer.name,
              },
            ]);
          },
        });
      }
      if (items.length > 0) {
        setContextMenuItems(items);
        setContextMenuPos({ x: e.clientX, y: e.clientY });
      }
    },
    [canMove],
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
        onContextMenu={(e) => handleComputerContextMenu(e, computer)}
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
            {computer.operatingSystem || t("unknownOs")}
          </p>
        </div>
        <StatusBadge
          text={computer.enabled ? t("common:active") : t("common:disabled")}
          variant={computer.enabled ? "success" : "error"}
        />
        {indicatorMap.get(computer.distinguishedName) && (
          <SecurityIndicatorDot
            indicators={indicatorMap.get(computer.distinguishedName)!}
          />
        )}
      </button>
    ),
    [
      selectedComputer,
      setSelectedComputer,
      handleComputerContextMenu,
      indicatorMap,
      t,
    ],
  );

  return (
    <div className="flex h-full flex-col" data-testid="computer-lookup">
      <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] px-3 py-2">
        <div className="flex-1">
          <SearchBar
            value={filterText}
            onChange={handleFilterChange}
            onSearch={handleFilterChange}
            placeholder={t("searchPlaceholder")}
            debounceMs={300}
          />
        </div>
        <div className="flex items-center gap-1">
          {(
            [
              { key: "all", label: t("all") },
              { key: "enabled", label: t("common:enabled") },
              { key: "disabled", label: t("common:disabled") },
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
              { key: "all", label: t("allOs") },
              { key: "windows", label: t("windows") },
              { key: "other", label: t("otherOs") },
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
        {loading && t("loadingComputers")}
        {!loading &&
          filteredComputers.length > 0 &&
          t("found", { count: filteredComputers.length })}
        {!loading && filteredComputers.length === 0 && !error && t("noComputersFound")}
        {error && `${t("common:error")}: ${error}`}
      </div>

      {truncated && (
        <div className="px-3 pt-2">
          <TruncatedBanner truncated={truncated} />
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {loading && (
          <div
            className="flex flex-1 items-center justify-center"
            data-testid="computer-lookup-loading"
          >
            <LoadingSpinner message={t("loadingComputers")} />
          </div>
        )}

        {!loading && error && (
          <div
            className="flex flex-1 items-center justify-center"
            data-testid="computer-lookup-error"
          >
            <EmptyState
              icon={<AlertCircle size={48} />}
              title={t("failedToLoad")}
              description={error}
              action={{ label: t("common:retry"), onClick: refresh }}
            />
          </div>
        )}

        {!loading && !error && filteredComputers.length === 0 && (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon={<MonitorX size={48} />}
              title={t("noComputersFound")}
              description={
                statusFilter !== "all" || osFilter !== "all"
                  ? t("noFilterResults")
                  : filterText
                    ? t("noComputersMatch", { query: filterText })
                    : t("noComputersFound")
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
                <ComputerDetail
                  computer={selectedComputer}
                  securityIndicators={indicatorMap.get(
                    selectedComputer.distinguishedName,
                  )}
                  onDeleted={() => {
                    setSelectedComputer(null);
                    refresh();
                  }}
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <p className="text-body text-[var(--color-text-secondary)]">
                    {t("selectComputer")}
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
