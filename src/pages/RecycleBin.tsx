import { useState, useCallback, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SearchBar } from "@/components/common/SearchBar";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { EmptyState } from "@/components/common/EmptyState";
import { StatusBadge } from "@/components/common/StatusBadge";
import { OUPicker } from "@/components/form/OUPicker";
import { useOUTree } from "@/hooks/useOUTree";
import { useErrorHandler } from "@/hooks/useErrorHandler";
import { useNotifications } from "@/contexts/NotificationContext";
import { DialogShell } from "@/components/dialogs/DialogShell";
import {
  Trash2,
  AlertTriangle,
  RefreshCw,
  User,
  Monitor,
  Users,
  Contact,
  Printer,
  FileQuestion,
} from "lucide-react";

interface DeletedObject {
  distinguishedName: string;
  name: string;
  objectType: string;
  deletionDate: string;
  originalOu: string;
}

type ObjectTypeFilter = "all" | "user" | "computer" | "group" | "contact" | "printQueue";

const TYPE_LABELS: Record<string, string> = {
  user: "User",
  computer: "Computer",
  group: "Group",
  contact: "Contact",
  printQueue: "Printer",
  other: "Other",
};

const TYPE_BADGE_VARIANT: Record<string, "info" | "success" | "warning" | "error" | "neutral"> = {
  user: "info",
  computer: "success",
  group: "warning",
  contact: "neutral",
  printQueue: "error",
  other: "neutral",
};

const TYPE_ICONS: Record<string, typeof User> = {
  user: User,
  computer: Monitor,
  group: Users,
  contact: Contact,
  printQueue: Printer,
  other: FileQuestion,
};

export function RecycleBin() {
  const [objects, setObjects] = useState<DeletedObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recycleBinEnabled, setRecycleBinEnabled] = useState<boolean | null>(
    null,
  );
  const [filterText, setFilterText] = useState("");
  const [typeFilter, setTypeFilter] = useState<ObjectTypeFilter>("all");
  const [restoreTarget, setRestoreTarget] = useState<DeletedObject | null>(
    null,
  );
  const [restoreOU, setRestoreOU] = useState<string | undefined>();
  const [restoring, setRestoring] = useState(false);
  const { handleError } = useErrorHandler();
  const { notify } = useNotifications();

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const enabled = await invoke<boolean>("is_recycle_bin_enabled");
      setRecycleBinEnabled(enabled);
      if (enabled) {
        const deleted = await invoke<DeletedObject[]>("get_deleted_objects");
        setObjects(deleted);
      }
    } catch (err) {
      handleError(err, "loading Recycle Bin");
      setError("Failed to load Recycle Bin data.");
    } finally {
      setLoading(false);
    }
  }, [handleError]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredObjects = useMemo(() => {
    let result = objects;
    if (typeFilter !== "all") {
      result = result.filter((o) => o.objectType === typeFilter);
    }
    if (filterText.trim()) {
      const lower = filterText.toLowerCase();
      result = result.filter((o) => o.name.toLowerCase().includes(lower));
    }
    return result;
  }, [objects, typeFilter, filterText]);

  const typeCounts = useMemo(() => {
    const counts = { user: 0, computer: 0, group: 0, contact: 0, printQueue: 0, other: 0 };
    for (const o of objects) {
      const key = o.objectType as keyof typeof counts;
      if (key in counts) counts[key]++;
      else counts.other++;
    }
    return counts;
  }, [objects]);

  const handleRestore = useCallback(
    async (ou: string) => {
      if (!restoreTarget) return;
      setRestoring(true);
      try {
        await invoke("restore_deleted_object", {
          deletedDn: restoreTarget.distinguishedName,
          targetOuDn: ou,
        });
        notify(`Restored "${restoreTarget.name}" successfully.`, "success");
        setRestoreTarget(null);
        setRestoreOU(undefined);
        loadData();
      } catch (err) {
        handleError(err, "restoring object");
      } finally {
        setRestoring(false);
      }
    },
    [restoreTarget, handleError, notify, loadData],
  );

  if (loading) {
    return (
      <div
        className="flex h-full items-center justify-center"
        data-testid="recycle-bin-loading"
      >
        <LoadingSpinner message="Loading Recycle Bin..." />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="flex h-full items-center justify-center"
        data-testid="recycle-bin-error"
      >
        <EmptyState
          icon={<Trash2 size={48} />}
          title="Failed to load Recycle Bin"
          description={error}
          action={{ label: "Retry", onClick: loadData }}
        />
      </div>
    );
  }

  if (recycleBinEnabled === false) {
    return (
      <div
        className="flex h-full items-center justify-center"
        data-testid="recycle-bin-disabled"
      >
        <EmptyState
          icon={<AlertTriangle size={48} />}
          title="AD Recycle Bin Not Enabled"
          description="The Active Directory Recycle Bin optional feature is not enabled on this domain. Contact your domain administrator to enable it."
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" data-testid="recycle-bin">
      <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] px-3 py-2">
        <div className="flex-1">
          <SearchBar
            value={filterText}
            onChange={setFilterText}
            onSearch={setFilterText}
            placeholder="Search deleted objects by name..."
            debounceMs={300}
          />
        </div>
        <div className="flex items-center gap-1">
          {(
            [
              { key: "all", label: "All" },
              { key: "user", label: "Users" },
              { key: "computer", label: "Computers" },
              { key: "group", label: "Groups" },
              { key: "contact", label: "Contacts" },
              { key: "printQueue", label: "Printers" },
            ] as const
          ).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTypeFilter(key)}
              className={`btn btn-sm ${typeFilter === key ? "btn-outline" : "btn-ghost"}`}
            >
              {label}
              {key !== "all" && (
                <span className="ml-1 opacity-70">
                  ({typeCounts[key as keyof typeof typeCounts] ?? 0})
                </span>
              )}
            </button>
          ))}
        </div>
        <button
          className="btn btn-sm btn-ghost"
          onClick={loadData}
          title="Refresh"
          data-testid="recycle-bin-refresh"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {filteredObjects.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={<Trash2 size={48} />}
              title="No deleted objects"
              description={
                filterText || typeFilter !== "all"
                  ? "No objects match the current filters."
                  : "The Recycle Bin is empty."
              }
            />
          </div>
        ) : (
          <table
            className="w-full text-body"
            data-testid="recycle-bin-table"
          >
            <thead className="sticky top-0 bg-[var(--color-surface-card)]">
              <tr className="border-b border-[var(--color-border-subtle)] text-left text-caption text-[var(--color-text-secondary)]">
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Deleted</th>
                <th className="px-3 py-2 font-medium">Original OU</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredObjects.map((obj) => {
                const TypeIcon =
                  TYPE_ICONS[obj.objectType] || TYPE_ICONS.other;
                return (
                  <tr
                    key={obj.distinguishedName}
                    className="border-b border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-hover)]"
                    data-testid="recycle-bin-row"
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <TypeIcon
                          size={14}
                          className="shrink-0 text-[var(--color-text-secondary)]"
                        />
                        <span className="text-[var(--color-text-primary)]">
                          {obj.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge
                        text={TYPE_LABELS[obj.objectType] || obj.objectType}
                        variant={TYPE_BADGE_VARIANT[obj.objectType] || "neutral"}
                      />
                    </td>
                    <td className="px-3 py-2 text-[var(--color-text-secondary)]">
                      {obj.deletionDate}
                    </td>
                    <td
                      className="max-w-[200px] truncate px-3 py-2 text-[var(--color-text-secondary)]"
                      title={obj.originalOu}
                    >
                      {obj.originalOu}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        className="btn btn-sm btn-primary py-0.5"
                        onClick={() => {
                          setRestoreTarget(obj);
                          setRestoreOU(obj.originalOu);
                        }}
                        data-testid="restore-btn"
                      >
                        Restore
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {restoreTarget && (
        <RestoreDialog
          object={restoreTarget}
          initialOU={restoreTarget.originalOu}
          selectedOU={restoreOU}
          onSelectOU={setRestoreOU}
          onRestore={handleRestore}
          onClose={() => {
            setRestoreTarget(null);
            setRestoreOU(undefined);
          }}
          restoring={restoring}
        />
      )}
    </div>
  );
}

function RestoreDialog({
  object,
  selectedOU,
  onSelectOU,
  onRestore,
  onClose,
  restoring,
}: {
  object: DeletedObject;
  initialOU: string;
  selectedOU?: string;
  onSelectOU: (dn: string) => void;
  onRestore: (ou: string) => void;
  onClose: () => void;
  restoring: boolean;
}) {
  const { nodes, loading, error } = useOUTree({ silent: true });

  return (
    <DialogShell
      onClose={restoring ? undefined : onClose}
      maxWidth="md"
      ariaLabel="Restore deleted object"
      overlayTestId="restore-dialog-overlay"
      dialogTestId="restore-dialog"
    >
      <div className="border-b border-[var(--color-border-subtle)] px-4 py-3">
        <h2 className="text-body font-semibold text-[var(--color-text-primary)]">
          Restore "{object.name}"
        </h2>
      </div>

      <div className="px-4 py-3">
        <p className="mb-3 text-caption text-[var(--color-text-secondary)]">
          Select the target OU for restoration:
        </p>
        <OUPicker
          nodes={nodes}
          selectedOU={selectedOU}
          onSelect={onSelectOU}
          loading={loading}
          error={error}
        />
      </div>

      <div className="flex justify-end gap-2 border-t border-[var(--color-border-subtle)] px-4 py-3">
        <button
          className="btn btn-sm"
          onClick={onClose}
          disabled={restoring}
          data-testid="restore-cancel"
        >
          Cancel
        </button>
        <button
          className="btn btn-sm btn-primary"
          onClick={() => selectedOU && onRestore(selectedOU)}
          disabled={!selectedOU || restoring}
          data-testid="restore-confirm"
        >
          {restoring ? "Restoring..." : "Restore"}
        </button>
      </div>
    </DialogShell>
  );
}
