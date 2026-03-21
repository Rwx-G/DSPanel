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
import type { PrinterInfo } from "@/types/printer";
import { Printer, AlertCircle, Trash2, FolderInput } from "lucide-react";

export function PrinterLookup() {
  const [query, setQuery] = useState("");
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPrinter, setSelectedPrinter] = useState<PrinterInfo | null>(
    null,
  );

  const { hasPermission } = usePermissions();
  const canDelete = hasPermission("DomainAdmin");
  const canMove = hasPermission("AccountOperator");
  const { handleError } = useErrorHandler();
  const { notify } = useNotifications();

  const [contextMenuPos, setContextMenuPos] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [contextMenuItems, setContextMenuItems] = useState<ContextMenuItem[]>(
    [],
  );
  const [moveTargets, setMoveTargets] = useState<MoveTarget[] | null>(null);

  const searchPrinters = useCallback(
    async (searchQuery: string) => {
      setQuery(searchQuery);
      if (searchQuery.length < 2) {
        setPrinters([]);
        setError(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const results = await invoke<PrinterInfo[]>("search_printers", {
          query: searchQuery,
        });
        setPrinters(results);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setPrinters([]);
        handleError(err, "searching printers");
      } finally {
        setLoading(false);
      }
    },
    [handleError],
  );

  const handleDelete = useCallback(
    async (printer: PrinterInfo) => {
      if (
        !window.confirm(
          `Are you sure you want to delete printer "${printer.name || printer.dn}"?`,
        )
      ) {
        return;
      }
      try {
        await invoke("delete_printer", { dn: printer.dn });
        notify("Printer deleted successfully", "success");
        setPrinters((prev) => prev.filter((p) => p.dn !== printer.dn));
        if (selectedPrinter?.dn === printer.dn) {
          setSelectedPrinter(null);
        }
      } catch (err) {
        handleError(err, "deleting printer");
      }
    },
    [selectedPrinter, handleError, notify],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, printer: PrinterInfo) => {
      e.preventDefault();
      const items: ContextMenuItem[] = [];
      if (canMove) {
        items.push({
          label: "Move to OU",
          icon: <FolderInput size={14} />,
          onClick: () => {
            setMoveTargets([
              {
                distinguishedName: printer.dn,
                displayName: printer.name || printer.dn,
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
        category: "General",
        items: [
          { label: "Name", value: printer.name },
          { label: "Location", value: printer.location },
          { label: "Description", value: printer.description },
          { label: "Distinguished Name", value: printer.dn },
        ],
      },
      {
        category: "Server Info",
        items: [
          { label: "Server Name", value: printer.serverName },
          { label: "Share Path", value: printer.sharePath },
          { label: "Driver Name", value: printer.driverName },
        ],
      },
    ],
    [],
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
            {printer.name || printer.dn}
          </p>
          <p className="truncate text-caption text-[var(--color-text-secondary)]">
            {printer.location || printer.serverName || "No location"}
          </p>
        </div>
      </button>
    ),
    [selectedPrinter, handleContextMenu],
  );

  return (
    <div className="flex h-full flex-col" data-testid="printer-lookup">
      <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] px-3 py-2">
        <div className="flex-1">
          <SearchBar
            value={query}
            onChange={searchPrinters}
            onSearch={searchPrinters}
            placeholder="Search printers by name, location, or server..."
            debounceMs={300}
          />
        </div>
      </div>

      <div
        className="sr-only"
        aria-live="polite"
        data-testid="printer-lookup-status"
      >
        {loading && "Searching printers..."}
        {!loading &&
          printers.length > 0 &&
          `${printers.length} printer${printers.length > 1 ? "s" : ""} found`}
        {!loading &&
          printers.length === 0 &&
          !error &&
          query.length >= 2 &&
          "No printers found"}
        {error && `Error: ${error}`}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {loading && (
          <div
            className="flex flex-1 items-center justify-center"
            data-testid="printer-lookup-loading"
          >
            <LoadingSpinner message="Searching printers..." />
          </div>
        )}

        {!loading && error && (
          <div
            className="flex flex-1 items-center justify-center"
            data-testid="printer-lookup-error"
          >
            <EmptyState
              icon={<AlertCircle size={48} />}
              title="Failed to search printers"
              description={error}
              action={{
                label: "Retry",
                onClick: () => searchPrinters(query),
              }}
            />
          </div>
        )}

        {!loading && !error && query.length < 2 && (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon={<Printer size={48} />}
              title="Search for printers"
              description="Enter at least 2 characters to search."
            />
          </div>
        )}

        {!loading && !error && query.length >= 2 && printers.length === 0 && (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              icon={<Printer size={48} />}
              title="No printers found"
              description={`No printers match "${query}".`}
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
                className="h-full"
              />
            </div>

            <div
              className="flex-1 overflow-auto p-4"
              data-testid="printer-detail-panel"
            >
              {selectedPrinter ? (
                <div data-testid="printer-detail">
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
                      {selectedPrinter.name || selectedPrinter.dn}
                    </h2>
                    {canDelete && (
                      <button
                        className="btn btn-sm btn-ghost text-[var(--color-error)]"
                        onClick={() => handleDelete(selectedPrinter)}
                        data-testid="printer-delete-btn"
                      >
                        <Trash2 size={14} />
                        Delete
                      </button>
                    )}
                  </div>
                  <PropertyGrid
                    groups={buildPropertyGroups(selectedPrinter)}
                  />
                </div>
              ) : (
                <div className="flex h-full items-center justify-center">
                  <p className="text-body text-[var(--color-text-secondary)]">
                    Select a printer to view details
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
          onMoved={() => searchPrinters(query)}
        />
      )}
    </div>
  );
}
