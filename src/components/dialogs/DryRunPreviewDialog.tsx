import { useEffect } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";

export type ChangeType = "add" | "modify" | "delete";

export interface DryRunChange {
  type: ChangeType;
  targetName: string;
  description: string;
}

interface DryRunPreviewDialogProps {
  changes: DryRunChange[];
  onExecute: () => void;
  onCancel: () => void;
}

const CHANGE_ICON = {
  add: Plus,
  modify: Pencil,
  delete: Trash2,
};

const CHANGE_COLOR = {
  add: "text-[var(--color-success)]",
  modify: "text-[var(--color-info)]",
  delete: "text-[var(--color-error)]",
};

export function DryRunPreviewDialog({
  changes,
  onExecute,
  onCancel,
}: DryRunPreviewDialogProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-surface-overlay)]"
      onClick={onCancel}
      data-testid="dryrun-overlay"
    >
      <div
        className="mx-4 w-full max-w-lg rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dryrun-dialog-title"
        data-testid="dryrun-dialog"
      >
        <div className="border-b border-[var(--color-border-subtle)] px-4 py-3">
          <h2
            id="dryrun-dialog-title"
            className="text-body font-semibold text-[var(--color-text-primary)]"
            data-testid="dryrun-title"
          >
            Pending Changes ({changes.length})
          </h2>
        </div>

        <div className="max-h-64 overflow-auto px-4 py-2">
          {changes.map((change, index) => {
            const Icon = CHANGE_ICON[change.type];
            return (
              <div
                key={index}
                className="flex items-start gap-2 border-b border-[var(--color-border-subtle)] py-2 last:border-b-0"
                data-testid={`dryrun-change-${index}`}
              >
                <Icon
                  size={16}
                  className={`mt-0.5 shrink-0 ${CHANGE_COLOR[change.type]}`}
                />
                <div>
                  <span className="text-body font-medium text-[var(--color-text-primary)]">
                    {change.targetName}
                  </span>
                  <p className="text-caption text-[var(--color-text-secondary)]">
                    {change.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--color-border-subtle)] px-4 py-3">
          <button
            className="btn-secondary"
            onClick={onCancel}
            data-testid="dryrun-cancel"
          >
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={onExecute}
            data-testid="dryrun-execute"
          >
            Execute
          </button>
        </div>
      </div>
    </div>
  );
}
