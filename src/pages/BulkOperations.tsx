import { useState, useCallback, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { GroupPicker, type GroupOption } from "@/components/form/GroupPicker";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { useGroupSearch } from "@/hooks/useGroupSearch";
import { usePermissions } from "@/hooks/usePermissions";
import { parseCnFromDn } from "@/utils/dn";
import { type DirectoryEntry } from "@/types/directory";
import {
  Trash2,
  UserPlus,
  ArrowRightLeft,
  CheckSquare,
  Eye,
  Play,
  AlertCircle,
  CheckCircle,
  RotateCcw,
} from "lucide-react";

export type BulkOperationType = "delete" | "add" | "transfer";

export interface PlannedChange {
  memberDn: string;
  memberName: string;
  groupDn: string;
  groupName: string;
  action: "add" | "remove";
}

export interface BulkProgress {
  current: number;
  total: number;
  status: "idle" | "running" | "completed" | "failed" | "rolling-back";
  message: string;
}

const OP_LABELS: Record<BulkOperationType, string> = {
  delete: "Delete",
  add: "Add",
  transfer: "Transfer",
};

const OP_ICONS: Record<BulkOperationType, typeof Trash2> = {
  delete: Trash2,
  add: UserPlus,
  transfer: ArrowRightLeft,
};

export function BulkOperations() {
  const { hasPermission } = usePermissions();
  const canExecute = hasPermission("AccountOperator");
  const searchGroups = useGroupSearch();

  const [operationType, setOperationType] =
    useState<BulkOperationType>("delete");
  const [sourceGroups, setSourceGroups] = useState<GroupOption[]>([]);
  const [targetGroups, setTargetGroups] = useState<GroupOption[]>([]);
  const [members, setMembers] = useState<DirectoryEntry[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(
    new Set(),
  );
  const [plannedChanges, setPlannedChanges] = useState<PlannedChange[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [progress, setProgress] = useState<BulkProgress>({
    current: 0,
    total: 0,
    status: "idle",
    message: "",
  });

  // Load members when source group changes
  useEffect(() => {
    if (sourceGroups.length === 0) {
      setMembers([]);
      setSelectedMembers(new Set());
      return;
    }

    // Load members from the first source group
    const sourceGroup = sourceGroups[0];
    let cancelled = false;
    setMembersLoading(true);
    setSelectedMembers(new Set());

    invoke<DirectoryEntry[]>("get_group_members", {
      groupDn: sourceGroup.distinguishedName,
    })
      .then((result) => {
        if (!cancelled) {
          setMembers(result);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn("Failed to load group members:", err);
          setMembers([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setMembersLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sourceGroups]);

  // Reset target groups and planned changes when operation type changes
  useEffect(() => {
    setTargetGroups([]);
    setPlannedChanges([]);
    setShowPreview(false);
    setProgress({ current: 0, total: 0, status: "idle", message: "" });
  }, [operationType]);

  const handleMemberSelect = useCallback((dn: string, checked: boolean) => {
    setSelectedMembers((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(dn);
      } else {
        next.delete(dn);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(
    (checked: boolean) => {
      if (checked) {
        setSelectedMembers(new Set(members.map((m) => m.distinguishedName)));
      } else {
        setSelectedMembers(new Set());
      }
    },
    [members],
  );

  const allSelected =
    members.length > 0 && selectedMembers.size === members.length;

  const getMemberName = useCallback(
    (dn: string): string => {
      const member = members.find((m) => m.distinguishedName === dn);
      return member?.displayName ?? member?.samAccountName ?? parseCnFromDn(dn);
    },
    [members],
  );

  // Generate planned changes based on operation type
  const handlePreview = useCallback(() => {
    const changes: PlannedChange[] = [];
    const selectedDns = Array.from(selectedMembers);

    if (operationType === "delete") {
      for (const source of sourceGroups) {
        for (const dn of selectedDns) {
          changes.push({
            memberDn: dn,
            memberName: getMemberName(dn),
            groupDn: source.distinguishedName,
            groupName: source.name,
            action: "remove",
          });
        }
      }
    } else if (operationType === "add") {
      for (const target of targetGroups) {
        for (const dn of selectedDns) {
          changes.push({
            memberDn: dn,
            memberName: getMemberName(dn),
            groupDn: target.distinguishedName,
            groupName: target.name,
            action: "add",
          });
        }
      }
    } else if (operationType === "transfer") {
      // Transfer: add to target, then remove from source (per member)
      for (const dn of selectedDns) {
        for (const target of targetGroups) {
          changes.push({
            memberDn: dn,
            memberName: getMemberName(dn),
            groupDn: target.distinguishedName,
            groupName: target.name,
            action: "add",
          });
        }
        for (const source of sourceGroups) {
          changes.push({
            memberDn: dn,
            memberName: getMemberName(dn),
            groupDn: source.distinguishedName,
            groupName: source.name,
            action: "remove",
          });
        }
      }
    }

    setPlannedChanges(changes);
    setShowPreview(true);
  }, [
    operationType,
    sourceGroups,
    targetGroups,
    selectedMembers,
    getMemberName,
  ]);

  // Execute planned changes with rollback on failure
  const handleExecute = useCallback(async () => {
    if (plannedChanges.length === 0) return;

    const completedOps: PlannedChange[] = [];
    const total = plannedChanges.length;

    setProgress({
      current: 0,
      total,
      status: "running",
      message: "Starting...",
    });
    setShowPreview(false);

    for (let i = 0; i < plannedChanges.length; i++) {
      const change = plannedChanges[i];
      const actionLabel = change.action === "add" ? "Adding" : "Removing";
      setProgress({
        current: i,
        total,
        status: "running",
        message: `${actionLabel} ${change.memberName} ${change.action === "add" ? "to" : "from"} ${change.groupName}...`,
      });

      try {
        if (change.action === "add") {
          await invoke("add_user_to_group", {
            userDn: change.memberDn,
            groupDn: change.groupDn,
          });
        } else {
          await invoke("remove_group_member", {
            memberDn: change.memberDn,
            groupDn: change.groupDn,
          });
        }
        completedOps.push(change);
      } catch (err) {
        console.warn(`Bulk operation failed at step ${i + 1}:`, err);

        // Rollback completed operations in LIFO order
        setProgress({
          current: i,
          total,
          status: "rolling-back",
          message: `Rolling back ${completedOps.length} completed operations...`,
        });

        for (let j = completedOps.length - 1; j >= 0; j--) {
          const completed = completedOps[j];
          try {
            // Reverse the operation
            if (completed.action === "add") {
              await invoke("remove_group_member", {
                memberDn: completed.memberDn,
                groupDn: completed.groupDn,
              });
            } else {
              await invoke("add_user_to_group", {
                userDn: completed.memberDn,
                groupDn: completed.groupDn,
              });
            }
          } catch (rollbackErr) {
            console.warn(`Rollback failed for step ${j}:`, rollbackErr);
          }
        }

        setProgress({
          current: i,
          total,
          status: "failed",
          message: `Failed at step ${i + 1}. Rolled back ${completedOps.length} operations.`,
        });
        return;
      }
    }

    setProgress({
      current: total,
      total,
      status: "completed",
      message: `Successfully completed ${total} operations.`,
    });
    setPlannedChanges([]);
    setSelectedMembers(new Set());

    // Reload members if source group is selected
    if (sourceGroups.length > 0) {
      try {
        const refreshed = await invoke<DirectoryEntry[]>("get_group_members", {
          groupDn: sourceGroups[0].distinguishedName,
        });
        setMembers(refreshed);
      } catch {
        // Ignore refresh errors
      }
    }
  }, [plannedChanges, sourceGroups]);

  const canPreview = useMemo(() => {
    if (selectedMembers.size === 0) return false;
    if (sourceGroups.length === 0) return false;
    if (operationType !== "delete" && targetGroups.length === 0) return false;
    return true;
  }, [selectedMembers, sourceGroups, targetGroups, operationType]);

  const isRunning =
    progress.status === "running" || progress.status === "rolling-back";

  const progressPercent =
    progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0;

  return (
    <div
      className="flex h-full flex-col gap-4 overflow-auto p-4"
      data-testid="bulk-operations"
    >
      <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
        Bulk Operations
      </h2>

      {/* Operation Type Selector */}
      <div data-testid="operation-type-selector">
        <label className="mb-2 block text-caption font-medium text-[var(--color-text-secondary)]">
          Operation Type
        </label>
        <div className="flex gap-1">
          {(["delete", "add", "transfer"] as BulkOperationType[]).map((op) => {
            const Icon = OP_ICONS[op];
            const isActive = operationType === op;
            return (
              <button
                key={op}
                className={`btn flex items-center gap-1.5 px-3 py-1.5 text-caption ${
                  isActive
                    ? "bg-[var(--color-primary)] text-white"
                    : "btn-ghost"
                }`}
                onClick={() => setOperationType(op)}
                disabled={isRunning}
                data-testid={`op-type-${op}`}
              >
                <Icon size={14} />
                {OP_LABELS[op]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Group Selectors */}
      <div className="grid grid-cols-2 gap-4">
        <div data-testid="source-group-section">
          <label className="mb-2 block text-caption font-medium text-[var(--color-text-secondary)]">
            Source Group
          </label>
          <GroupPicker
            selectedGroups={sourceGroups}
            onSelectionChange={setSourceGroups}
            onSearch={searchGroups}
            placeholder="Search source group..."
            disabled={isRunning}
          />
        </div>
        <div data-testid="target-group-section">
          <label className="mb-2 block text-caption font-medium text-[var(--color-text-secondary)]">
            Target Group
          </label>
          <GroupPicker
            selectedGroups={targetGroups}
            onSelectionChange={setTargetGroups}
            onSearch={searchGroups}
            placeholder="Search target group..."
            disabled={operationType === "delete" || isRunning}
          />
        </div>
      </div>

      {/* Member Selection */}
      <div data-testid="member-selection-section">
        <div className="mb-2 flex items-center justify-between">
          <label className="text-caption font-medium text-[var(--color-text-secondary)]">
            Members{members.length > 0 ? ` (${members.length})` : ""}
          </label>
          {members.length > 0 && (
            <span className="text-caption text-[var(--color-text-secondary)]">
              {selectedMembers.size} selected
            </span>
          )}
        </div>

        {membersLoading && <LoadingSpinner message="Loading members..." />}

        {!membersLoading && sourceGroups.length === 0 && (
          <p className="text-caption text-[var(--color-text-secondary)]">
            Select a source group to load members
          </p>
        )}

        {!membersLoading && sourceGroups.length > 0 && members.length === 0 && (
          <p className="text-caption text-[var(--color-text-secondary)]">
            No members in selected group
          </p>
        )}

        {!membersLoading && members.length > 0 && (
          <div className="rounded-lg border border-[var(--color-border-default)] overflow-hidden">
            <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-hover)] px-3 py-1.5">
              <label className="flex items-center gap-1.5 text-caption text-[var(--color-text-secondary)]">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => handleSelectAll(e.target.checked)}
                  disabled={isRunning}
                  data-testid="bulk-select-all"
                />
                <CheckSquare size={14} />
                Select all
              </label>
            </div>
            <div className="max-h-60 overflow-auto" data-testid="member-list">
              {members.map((member) => {
                const name =
                  member.displayName ??
                  member.samAccountName ??
                  parseCnFromDn(member.distinguishedName);
                const isSelected = selectedMembers.has(
                  member.distinguishedName,
                );
                return (
                  <label
                    key={member.distinguishedName}
                    className={`flex cursor-pointer items-center gap-2 border-b border-[var(--color-border-subtle)] px-3 py-1.5 last:border-b-0 transition-colors hover:bg-[var(--color-surface-hover)] ${
                      isSelected ? "bg-[var(--color-primary-subtle)]" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) =>
                        handleMemberSelect(
                          member.distinguishedName,
                          e.target.checked,
                        )
                      }
                      disabled={isRunning}
                      data-testid={`bulk-member-${name}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body text-[var(--color-text-primary)]">
                        {name}
                      </p>
                      <p className="truncate text-caption text-[var(--color-text-secondary)]">
                        {member.samAccountName}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      {canExecute && (
        <div
          className="flex items-center gap-2"
          data-testid="bulk-action-buttons"
        >
          <button
            className="btn btn-ghost flex items-center gap-1.5"
            onClick={handlePreview}
            disabled={!canPreview || isRunning}
            data-testid="bulk-preview-btn"
          >
            <Eye size={14} />
            Preview
          </button>
          <button
            className="btn btn-primary flex items-center gap-1.5"
            onClick={handleExecute}
            disabled={plannedChanges.length === 0 || isRunning}
            data-testid="bulk-execute-btn"
          >
            <Play size={14} />
            Execute
          </button>
        </div>
      )}

      {!canExecute && (
        <p
          className="text-caption text-[var(--color-text-secondary)]"
          data-testid="bulk-no-permission"
        >
          AccountOperator or higher permission required to execute bulk
          operations.
        </p>
      )}

      {/* Preview Dialog */}
      {showPreview && plannedChanges.length > 0 && (
        <div
          className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-3"
          data-testid="bulk-preview-panel"
        >
          <h3 className="mb-2 text-body font-semibold text-[var(--color-text-primary)]">
            Planned Changes ({plannedChanges.length})
          </h3>
          <div className="max-h-48 overflow-auto">
            {plannedChanges.map((change, index) => (
              <div
                key={`${change.action}-${change.memberDn}-${change.groupDn}`}
                className="flex items-start gap-2 border-b border-[var(--color-border-subtle)] py-1.5 last:border-b-0"
                data-testid={`planned-change-${index}`}
              >
                <span
                  className={`mt-0.5 shrink-0 text-caption font-medium ${
                    change.action === "add"
                      ? "text-[var(--color-success)]"
                      : "text-[var(--color-error)]"
                  }`}
                >
                  {change.action === "add" ? "ADD" : "REMOVE"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-body text-[var(--color-text-primary)]">
                    {change.memberName}
                  </p>
                  <p className="text-caption text-[var(--color-text-secondary)]">
                    {change.action === "add" ? "to" : "from"} {change.groupName}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Progress Indicator */}
      {progress.status !== "idle" && (
        <div
          className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-3"
          data-testid="bulk-progress"
        >
          <div className="mb-2 flex items-center gap-2">
            {progress.status === "running" && <LoadingSpinner size={16} />}
            {progress.status === "completed" && (
              <CheckCircle size={16} className="text-[var(--color-success)]" />
            )}
            {progress.status === "failed" && (
              <AlertCircle size={16} className="text-[var(--color-error)]" />
            )}
            {progress.status === "rolling-back" && (
              <RotateCcw
                size={16}
                className="animate-spin text-[var(--color-warning)]"
              />
            )}
            <span className="text-body text-[var(--color-text-primary)]">
              {progress.current} / {progress.total}
            </span>
          </div>
          <div className="mb-2 h-2 overflow-hidden rounded-full bg-[var(--color-surface-hover)]">
            <div
              className={`h-full rounded-full transition-all ${
                progress.status === "failed"
                  ? "bg-[var(--color-error)]"
                  : progress.status === "rolling-back"
                    ? "bg-[var(--color-warning)]"
                    : "bg-[var(--color-primary)]"
              }`}
              style={{ width: `${progressPercent}%` }}
              data-testid="bulk-progress-bar"
            />
          </div>
          <p
            className="text-caption text-[var(--color-text-secondary)]"
            data-testid="bulk-progress-message"
          >
            {progress.message}
          </p>
        </div>
      )}
    </div>
  );
}
