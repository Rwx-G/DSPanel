import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DialogShell } from "@/components/dialogs/DialogShell";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";
import { EmptyState } from "@/components/common/EmptyState";
import { type DirectoryEntry } from "@/types/directory";
import { parseCnFromDn } from "@/utils/dn";
import { X, Users } from "lucide-react";
import { useTranslation } from "react-i18next";

interface GroupMembersDialogProps {
  groupDn: string;
  groupName: string;
  onClose: () => void;
}

export function GroupMembersDialog({
  groupDn,
  groupName,
  onClose,
}: GroupMembersDialogProps) {
  const { t } = useTranslation(["dialogs", "common"]);
  const [members, setMembers] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadMembers = async () => {
      try {
        const result = await invoke<DirectoryEntry[]>("get_group_members", {
          groupDn,
        });
        if (!cancelled) {
          setMembers(result);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load group members",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadMembers();
    return () => {
      cancelled = true;
    };
  }, [groupDn]);

  return (
    <DialogShell
      onClose={onClose}
      maxWidth="md"
      ariaLabel={`Members of ${groupName}`}
      dialogTestId="group-members-dialog"
    >
      <div className="p-4">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-[var(--color-text-secondary)]" />
            <h2
              className="text-lg font-semibold text-[var(--color-text-primary)]"
              id="group-members-title"
            >
              {groupName}
            </h2>
            {!loading && !error && (
              <span className="text-caption text-[var(--color-text-secondary)]">
                ({t("dialogs:groupMembers.memberCount", { count: members.length })})
              </span>
            )}
          </div>
          <button
            className="btn btn-sm btn-secondary"
            onClick={onClose}
            aria-label="Close"
            data-testid="group-members-close"
          >
            <X size={14} />
          </button>
        </div>

        {loading && (
          <div
            className="flex justify-center py-8"
            data-testid="group-members-loading"
          >
            <LoadingSpinner message={t("dialogs:groupMembers.loadingMembers")} />
          </div>
        )}

        {error && (
          <div data-testid="group-members-error">
            <EmptyState title={t("dialogs:groupMembers.failedToLoad")} description={error} />
          </div>
        )}

        {!loading && !error && members.length === 0 && (
          <div data-testid="group-members-empty">
            <EmptyState
              title={t("dialogs:groupMembers.noMembers")}
              description={t("dialogs:groupMembers.noMembersDescription")}
            />
          </div>
        )}

        {!loading && !error && members.length > 0 && (
          <div
            className="max-h-80 overflow-auto rounded-lg border border-[var(--color-border-default)]"
            data-testid="group-members-list"
          >
            <table className="w-full border-collapse text-body">
              <thead>
                <tr className="bg-[var(--color-surface-card)] text-left">
                  <th className="border-b border-[var(--color-border-default)] px-3 py-2 font-medium text-[var(--color-text-secondary)]">
                    {t("common:displayName")}
                  </th>
                  <th className="border-b border-[var(--color-border-default)] px-3 py-2 font-medium text-[var(--color-text-secondary)]">
                    {t("dialogs:groupMembers.accountName")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr
                    key={member.distinguishedName}
                    className="border-b border-[var(--color-border-subtle)] even:bg-[var(--color-surface-bg)] hover:bg-[var(--color-surface-hover)] transition-colors"
                    data-testid="group-member-row"
                  >
                    <td className="px-3 py-2 text-[var(--color-text-primary)]">
                      {member.displayName ??
                        parseCnFromDn(member.distinguishedName)}
                    </td>
                    <td className="px-3 py-2 text-[var(--color-text-secondary)]">
                      {member.samAccountName ?? "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DialogShell>
  );
}
