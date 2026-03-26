import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SearchBar } from "@/components/common/SearchBar";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { EmptyState } from "@/components/common/EmptyState";
import { VirtualizedList } from "@/components/data/VirtualizedList";
import {
  PropertyGrid,
  type PropertyGroup,
} from "@/components/data/PropertyGrid";
import {
  ContextMenu,
  type ContextMenuItem,
} from "@/components/common/ContextMenu";
import {
  MoveObjectDialog,
  type MoveTarget,
} from "@/components/dialogs/MoveObjectDialog";
import { usePermissions } from "@/hooks/usePermissions";
import { useErrorHandler } from "@/hooks/useErrorHandler";
import { useNotifications } from "@/contexts/NotificationContext";
import { useDialog } from "@/contexts/DialogContext";
import { useBrowse } from "@/hooks/useBrowse";
import { useModifyAttribute } from "@/hooks/useModifyAttribute";
import { type PrinterInfo, mapEntryToPrinter } from "@/types/printer";
import { Printer, AlertCircle, Trash2, FolderInput } from "lucide-react";
import { useTranslation } from "react-i18next";

function usePrinterBrowse() {
  return useBrowse<PrinterInfo>({
    browseCommand: "browse_printers",
    searchCommand: "search_printers",
    mapEntry: mapEntryToPrinter,
    clientFilter: (p, lower) =>
      p.name.toLowerCase().includes(lower) ||
      p.location.toLowerCase().includes(lower) ||
      p.serverName.toLowerCase().includes(lower) ||
      p.sharePath.toLowerCase().includes(lower),
    itemKey: (p) => p.dn,
    preloadAll: true,
  });
}

export function PrinterLookup() {
  const { t } = useTranslation(["printerLookup", "common"]);
  const {
    items: printers,
    loading,
    loadingMore,
    error,
    hasMore,
    filterText,
    setFilterText,
    loadMore,
    selectedItem: selectedPrinter,
    setSelectedItem: setSelectedPrinter,
    refresh,
  } = usePrinterBrowse();

  const { hasPermission } = usePermissions();
  const canEdit = hasPermission("AccountOperator");
  const canDelete = hasPermission("AccountOperator");
  const canMove = hasPermission("AccountOperator");
  const { handleError } = useErrorHandler();
  const { notify } = useNotifications();
  const { showConfirmation } = useDialog();
  const { pendingChanges, saving, stageChange, clearChanges, submitChanges } =
    useModifyAttribute();

  const [contextMenuPos, setContextMenuPos] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [contextMenuItems, setContextMenuItems] = useState<ContextMenuItem[]>(
    [],
  );
  const [moveTargets, setMoveTargets] = useState<MoveTarget[] | null>(null);

  const handleEdit = useCallback(
    (attributeName: string, oldValue: string, newValue: string) => {
      stageChange(attributeName, oldValue, newValue);
    },
    [stageChange],
  );

  const handleSaveChanges = useCallback(async () => {
    if (!selectedPrinter) return;
    const confirmed = await showConfirmation(
      "Save Changes",
      `Apply ${pendingChanges.length} change(s) to "${selectedPrinter.name}"?`,
      pendingChanges.map((c) => `${c.attributeName}: ${c.newValue}`).join("\n"),
    );
    if (!confirmed) return;
    const success = await submitChanges(selectedPrinter.dn);
    if (success) {
      notify("Printer updated successfully", "success");
      refresh();
    }
  }, [selectedPrinter, pendingChanges, showConfirmation, submitChanges, notify, refresh]);

  const handleDelete = useCallback(
    async (printer: PrinterInfo) => {
      const confirmed = await showConfirmation(
        "Delete Printer",
        `Are you sure you want to delete "${printer.name}"?`,
        "This action cannot be undone.",
      );
      if (!confirmed) return;
      try {
        await invoke("delete_printer", { dn: printer.dn });
        notify("Printer deleted successfully", "success");
        refresh();
        if (selectedPrinter?.dn === printer.dn) {
          setSelectedPrinter(null);
        }
      } catch (err) {
        handleError(err, "deleting printer");
      }
    },
    [selectedPrinter, setSelectedPrinter, handleError, notify, refresh, showConfirmation],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, printer: PrinterInfo) => {
      e.preventDefault();
      const items: ContextMenuItem[] = [];
      if (canMove) {
        items.push({
          label: t("common:moveToOu"),
          icon: <FolderInput size={14} />,
          onClick: () => {
            setMoveTargets([
              {
                distinguishedName: printer.dn,
                displayName: printer.name,
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

  const buildPropertyGroups = useCallback(
    (printer: PrinterInfo): PropertyGroup[] => [
      {
        category: t("general"),
        items: [
          { label: t("common:name"), value: printer.name, editable: canEdit, attributeName: "printerName" },
          { label: t("common:location"), value: printer.location, editable: canEdit, attributeName: "location" },
          { label: t("common:description"), value: printer.description, editable: canEdit, attributeName: "description" },
          { label: t("common:distinguishedName"), value: printer.dn },
        ],
      },
      {
        category: t("serverInfo"),
        items: [
          { label: t("server"), value: printer.serverName, editable: canEdit, attributeName: "serverName" },
          { label: t("sharePath"), value: printer.sharePath, editable: canEdit, attributeName: "uNCName" },
          { label: t("driver"), value: printer.driverName, editable: canEdit, attributeName: "driverName" },
        ],
      },
    ],
    [canEdit],
  );

  const renderPrinterItem = useCallback(
    (printer: PrinterInfo) => (
      <button
        className={`flex w-full items-center gap-2 border-b border-[var(--color-border-subtle)] px-3 py-2 text-left transition-colors hover:bg-[var(--color-surface-hover)] ${
          selectedPrinter?.dn === printer.dn
            ? "bg-[var(--color-surface-selected)]"
            : ""
        }`}
        onClick={() => setSelectedPrinter(printer)}
        onContextMenu={(e) => handleContextMenu(e, printer)}
        data-testid={`printer-result-${printer.dn}`}
      >
        <Printer
          size={16}
          className="shrink-0 text-[var(--color-text-secondary)]"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-medium text-[var(--color-text-primary)]">
            {printer.name}
          </p>
          <p className="truncate text-caption text-[var(--color-text-secondary)]">
            {printer.location || printer.serverName || t("noLocation")}
          </p>
        </div>
      </button>
    ),
    [selectedPrinter, setSelectedPrinter, handleContextMenu],
  );

  return (
    <div className="flex h-full flex-col" data-testid="printer-lookup">
      <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] px-3 py-2">
        <div className="flex-1">
          <SearchBar
            value={filterText}
            onChange={setFilterText}
            onSearch={setFilterText}
            placeholder={t("searchPlaceholder")}
            debounceMs={300}
          />
        </div>
      </div>

      <div
        className="sr-only"
        aria-live="polite"
        data-testid="printer-lookup-status"
      >
        {loading && t("loadingPrinters")}
        {!loading &&
          printers.length > 0 &&
          t("found", { count: printers.length })}
        {!loading && printers.length === 0 && !error && t("noPrintersFound")}
        {error && `${t("common:error")}: ${error}`}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {loading && (
          <div
            className="flex flex-1 items-center justify-center"
            data-testid="printer-lookup-loading"
          >
            <LoadingSpinner message={t("loadingPrinters")} />
          </div>
        )}

        {!loading && error && (
          <div
            className="flex flex-1 items-center justify-center"
            data-testid="printer-lookup-error"
          >
            <EmptyState
              icon={<AlertCircle size={48} />}
              title={t("failedToLoad")}
              description={error}
              action={{ label: t("common:retry"), onClick: refresh }}
            />
          </div>
        )}

        {!loading && !error && printers.length === 0 && (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon={<Printer size={48} />}
              title={t("noPrintersFound")}
              description={
                filterText
                  ? t("noPrintersMatch", { filter: filterText })
                  : t("noPrintersAvailable")
              }
            />
          </div>
        )}

        {!loading && !error && printers.length > 0 && (
          <>
            <div
              className="w-64 shrink-0 border-r border-[var(--color-border-subtle)]"
              data-testid="printer-results-list"
            >
              <VirtualizedList
                items={printers}
                renderItem={renderPrinterItem}
                estimateSize={52}
                itemKey={(printer) => printer.dn}
                loadingMore={loadingMore}
                onEndReached={hasMore ? loadMore : undefined}
                className="h-full"
              />
            </div>

            <div
              className="flex-1 overflow-auto p-4"
              data-testid="printer-detail-panel"
            >
              {selectedPrinter ? (
                <div data-testid="printer-detail">
                  <div className="mb-4">
                    <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
                      {selectedPrinter.name}
                    </h2>
                  </div>

                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    {canDelete && (
                      <button
                        className="btn btn-sm flex items-center gap-1"
                        style={{ color: "var(--color-error)", borderColor: "var(--color-error)" }}
                        onClick={() => handleDelete(selectedPrinter)}
                        data-testid="printer-delete-btn"
                      >
                        <Trash2 size={14} />
                        {t("common:delete")}
                      </button>
                    )}

                    {pendingChanges.length > 0 && (
                      <>
                        <div className="mx-1 h-6 w-px bg-[var(--color-border-default)]" />
                        <div
                          className="flex items-center gap-2 rounded-lg border border-[var(--color-primary)] bg-[var(--color-primary-subtle)] px-3 py-1"
                          data-testid="pending-changes-bar"
                        >
                          <span className="text-caption text-[var(--color-text-primary)]">
                            {t("common:change", { count: pendingChanges.length })}
                            {pendingChanges.map((c) => (
                              <span
                                key={c.attributeName}
                                className="ml-1.5 inline-block rounded bg-[var(--color-surface-card)] px-1.5 py-0.5 text-[10px] font-mono"
                              >
                                {c.attributeName}
                              </span>
                            ))}
                          </span>
                          <button
                            onClick={clearChanges}
                            className="btn btn-sm btn-ghost"
                          >
                            {t("common:discard")}
                          </button>
                          <button
                            onClick={handleSaveChanges}
                            disabled={saving}
                            className="btn btn-sm btn-primary"
                          >
                            {saving ? t("common:saving") : t("common:save")}
                          </button>
                        </div>
                      </>
                    )}
                  </div>

                  <PropertyGrid
                    groups={buildPropertyGroups(selectedPrinter)}
                    onEdit={canEdit ? handleEdit : undefined}
                  />
                </div>
              ) : (
                <div className="flex h-full items-center justify-center">
                  <p className="text-body text-[var(--color-text-secondary)]">
                    {t("selectPrinter")}
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
