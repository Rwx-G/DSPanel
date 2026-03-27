import { useEffect } from "react";
import { Plus, Minus } from "lucide-react";
import { DialogShell } from "@/components/dialogs/DialogShell";
import { useTranslation } from "react-i18next";

export interface MemberChange {
  memberDn: string;
  memberName: string;
  action: "add" | "remove";
}

interface MemberChangePreviewDialogProps {
  open: boolean;
  changes: MemberChange[];
  groupName: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

const ACTION_ICON = {
  add: Plus,
  remove: Minus,
};

const ACTION_COLOR = {
  add: "text-[var(--color-success)]",
  remove: "text-[var(--color-error)]",
};

export function MemberChangePreviewDialog({
  open,
  changes,
  groupName,
  onConfirm,
  onCancel,
  loading = false,
}: MemberChangePreviewDialogProps) {
  const { t } = useTranslation(["dialogs", "common"]);
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  const addCount = changes.filter((c) => c.action === "add").length;
  const removeCount = changes.filter((c) => c.action === "remove").length;

  const summaryParts: string[] = [];
  if (addCount > 0)
    summaryParts.push(t("dialogs:memberChangePreview.toAdd", { count: addCount }));
  if (removeCount > 0)
    summaryParts.push(t("dialogs:memberChangePreview.toRemove", { count: removeCount }));
  const summary = summaryParts.join(", ");

  return (
    <DialogShell
      onClose={onCancel}
      maxWidth="lg"
      ariaLabelledBy="member-change-preview-title"
      overlayTestId="member-change-overlay"
      dialogTestId="member-change-preview"
    >
      <div className="border-b border-[var(--color-border-subtle)] px-4 py-3">
        <h2
          id="member-change-preview-title"
          className="text-body font-semibold text-[var(--color-text-primary)]"
          data-testid="member-change-title"
        >
          {t("dialogs:memberChangePreview.title", { name: groupName })}
        </h2>
        <p
          className="mt-1 text-caption text-[var(--color-text-secondary)]"
          data-testid="member-change-summary"
        >
          {summary}
        </p>
      </div>

      <div className="max-h-64 overflow-auto px-4 py-2">
        {changes.map((change, index) => {
          const Icon = ACTION_ICON[change.action];
          return (
            <div
              key={`${change.action}-${change.memberDn}`}
              className="flex items-start gap-2 border-b border-[var(--color-border-subtle)] py-2 last:border-b-0"
              data-testid={`member-change-${index}`}
            >
              <Icon
                size={16}
                className={`mt-0.5 shrink-0 ${ACTION_COLOR[change.action]}`}
              />
              <div>
                <span className="text-body font-medium text-[var(--color-text-primary)]">
                  {change.memberName}
                </span>
                <p className="text-caption text-[var(--color-text-secondary)]">
                  {change.memberDn}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex justify-end gap-2 border-t border-[var(--color-border-subtle)] px-4 py-3">
        <button
          className="btn btn-secondary"
          onClick={onCancel}
          disabled={loading}
          data-testid="member-change-cancel"
        >
          {t("common:cancel")}
        </button>
        <button
          className="btn btn-primary"
          onClick={onConfirm}
          disabled={loading}
          data-testid="member-change-apply"
        >
          {loading ? t("dialogs:memberChangePreview.applying") : t("common:apply")}
        </button>
      </div>
    </DialogShell>
  );
}
