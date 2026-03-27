import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { EmptyState } from "./EmptyState";
import { LoadingSpinner } from "./LoadingSpinner";
import {
  History,
  RotateCcw,
  Trash2,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
} from "lucide-react";
import { useNotifications } from "@/contexts/NotificationContext";
import { useDialog } from "@/contexts/DialogContext";
import { extractErrorMessage } from "@/utils/errorMapping";
import { ExportToolbar, type ExportColumn } from "./ExportToolbar";
import { useTranslation } from "react-i18next";

interface ObjectSnapshot {
  id: number;
  objectDn: string;
  operationType: string;
  timestamp: string;
  operator: string;
  attributesJson: string;
}

interface SnapshotDiff {
  attribute: string;
  snapshotValue: string | null;
  currentValue: string | null;
  changed: boolean;
}

interface SnapshotHistoryProps {
  objectDn: string;
  canRestore: boolean;
  refreshTrigger?: number;
  onRestored?: () => void;
}

export function SnapshotHistory({ objectDn, canRestore, refreshTrigger = 0, onRestored }: SnapshotHistoryProps) {
  const { t } = useTranslation(["components", "common"]);
  const [snapshots, setSnapshots] = useState<ObjectSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [diffs, setDiffs] = useState<SnapshotDiff[] | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const { notify } = useNotifications();
  const { showConfirmation } = useDialog();

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const result = await invoke<ObjectSnapshot[]>("get_snapshot_history", {
        objectDn,
      });
      setSnapshots(result);
    } catch {
      setSnapshots([]);
    } finally {
      setLoading(false);
    }
  }, [objectDn]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory, refreshTrigger]);

  const handleToggle = useCallback(
    async (id: number) => {
      if (expandedId === id) {
        setExpandedId(null);
        setDiffs(null);
        return;
      }
      setExpandedId(id);
      setDiffLoading(true);
      try {
        const result = await invoke<SnapshotDiff[]>("compute_snapshot_diff", {
          snapshotId: id,
        });
        setDiffs(result);
      } catch {
        setDiffs(null);
      } finally {
        setDiffLoading(false);
      }
    },
    [expandedId],
  );

  const handleRestore = useCallback(
    async (snapshot: ObjectSnapshot) => {
      const objectName = snapshot.objectDn.split(",")[0]?.replace("CN=", "") || snapshot.objectDn;
      const confirmed = await showConfirmation(
        t("components:snapshotHistory.restoreTitle"),
        t("components:snapshotHistory.restoreConfirm", { name: objectName, timestamp: formatTimestamp(snapshot.timestamp) }),
        t("components:snapshotHistory.restoreNote"),
      );

      if (!confirmed) return;

      setRestoring(true);
      try {
        await invoke("restore_from_snapshot", { snapshotId: snapshot.id });
        // Delete the consumed snapshot
        try {
          await invoke("delete_snapshot", { snapshotId: snapshot.id });
        } catch {
          // Non-blocking: snapshot stays if delete fails
        }
        notify(t("components:snapshotHistory.restoreSuccess"), "success");
        setExpandedId(null);
        setDiffs(null);
        await fetchHistory();
        onRestored?.();
      } catch (err) {
        notify(extractErrorMessage(err), "error");
      } finally {
        setRestoring(false);
      }
    },
    [showConfirmation, notify, fetchHistory, onRestored],
  );

  if (loading) {
    return <LoadingSpinner message={t("components:snapshotHistory.loading")} />;
  }

  if (snapshots.length === 0) {
    return (
      <EmptyState
        icon={<History size={32} />}
        title={t("components:snapshotHistory.noSnapshots")}
        description={t("components:snapshotHistory.snapshotsDescription")}
      />
    );
  }

  const exportColumns: ExportColumn[] = [
    { key: "timestamp", header: t("components:snapshotHistory.timestamp") },
    { key: "operationType", header: t("components:snapshotHistory.operation") },
    { key: "operator", header: t("components:snapshotHistory.operator") },
    { key: "objectDn", header: t("components:snapshotHistory.objectDn") },
  ];

  return (
    <div className="space-y-2" data-testid="snapshot-history">
      <div className="flex items-center justify-end">
        <ExportToolbar
          columns={exportColumns}
          data={snapshots}
          rowMapper={(s) => [
            formatTimestamp(s.timestamp),
            s.operationType,
            s.operator,
            s.objectDn,
          ]}
          title={`Snapshot History - ${objectDn}`}
          filenameBase="snapshot_history"
        />
      </div>
      <ul className="space-y-1">
        {snapshots.map((snap) => (
          <li
            key={snap.id}
            className="rounded border border-[var(--color-border-default)] bg-[var(--color-surface-card)]"
            data-testid={`snapshot-item-${snap.id}`}
          >
            <div className="flex items-center justify-between px-3 py-2">
              <button
                className="flex flex-1 items-center gap-2 text-left"
                onClick={() => handleToggle(snap.id)}
                data-testid={`snapshot-toggle-${snap.id}`}
              >
                {expandedId === snap.id ? (
                  <ChevronUp size={14} className="text-[var(--color-text-secondary)]" />
                ) : (
                  <ChevronDown size={14} className="text-[var(--color-text-secondary)]" />
                )}
                <span className="text-caption font-medium text-[var(--color-text-primary)]">
                  {snap.operationType}
                </span>
                <span className="text-caption text-[var(--color-text-secondary)]">
                  {formatTimestamp(snap.timestamp)}
                </span>
                {snap.operator && (
                  <span className="text-caption text-[var(--color-text-secondary)]">
                    by {snap.operator}
                  </span>
                )}
              </button>
              <div className="flex items-center gap-1">
                {canRestore && (
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => handleRestore(snap)}
                    disabled={restoring}
                    title={t("components:snapshotHistory.restoreButton")}
                    data-testid={`snapshot-restore-${snap.id}`}
                  >
                    <RotateCcw size={14} />
                  </button>
                )}
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={async (e) => {
                    e.stopPropagation();
                    const confirmed = await showConfirmation(
                      t("components:snapshotHistory.deleteTitle"),
                      t("components:snapshotHistory.deleteConfirm", { operation: snap.operationType, timestamp: formatTimestamp(snap.timestamp) }),
                      t("components:snapshotHistory.deleteNote"),
                    );
                    if (!confirmed) return;
                    try {
                      await invoke("delete_snapshot", { snapshotId: snap.id });
                      await fetchHistory();
                    } catch {
                      notify(t("components:snapshotHistory.deleteFailed"), "error");
                    }
                  }}
                  title={t("components:snapshotHistory.deleteButton")}
                  data-testid={`snapshot-delete-${snap.id}`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            {expandedId === snap.id && (
              <div
                className="border-t border-[var(--color-border-subtle)] px-3 py-2"
                data-testid={`snapshot-details-${snap.id}`}
              >
                {diffLoading ? (
                  <LoadingSpinner message={t("components:snapshotHistory.computingDiff")} />
                ) : diffs ? (
                  <div className="space-y-1">
                    {diffs.filter((d) => d.changed).length === 0 ? (
                      <p className="text-caption text-[var(--color-text-secondary)]">
                        {t("components:snapshotHistory.noDifferences")}
                      </p>
                    ) : (
                      <>
                        <div className="flex items-center gap-1 text-caption text-[var(--color-warning)]">
                          <AlertTriangle size={12} />
                          <span>
                            {t("components:snapshotHistory.attributesDiffer", { count: diffs.filter((d) => d.changed).length })}
                          </span>
                        </div>
                        <table className="w-full text-caption">
                          <thead>
                            <tr className="text-left text-[var(--color-text-secondary)]">
                              <th className="py-1 pr-2">{t("components:snapshotHistory.attribute")}</th>
                              <th className="py-1 pr-2">{t("components:snapshotHistory.snapshot")}</th>
                              <th className="py-1">{t("components:snapshotHistory.current")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {diffs
                              .filter((d) => d.changed)
                              .map((d) => (
                                <tr
                                  key={d.attribute}
                                  className="border-t border-[var(--color-border-subtle)]"
                                >
                                  <td className="py-1 pr-2 font-medium text-[var(--color-text-primary)]">
                                    {d.attribute}
                                  </td>
                                  <td className="py-1 pr-2 text-[var(--color-text-secondary)]">
                                    {d.snapshotValue ?? "-"}
                                  </td>
                                  <td className="py-1 text-[var(--color-text-secondary)]">
                                    {d.currentValue ?? "-"}
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </>
                    )}
                  </div>
                ) : (
                  <p className="text-caption text-[var(--color-text-secondary)]">
                    {t("components:snapshotHistory.diffFailed")}
                  </p>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}
