import { useEffect } from "react";
import { DialogShell } from "@/components/dialogs/DialogShell";

interface ProgressDialogProps {
  statusMessage: string;
  percentage?: number;
  isIndeterminate?: boolean;
  cancellable?: boolean;
  onCancel?: () => void;
}

export function ProgressDialog({
  statusMessage,
  percentage = 0,
  isIndeterminate = false,
  cancellable = false,
  onCancel,
}: ProgressDialogProps) {
  useEffect(() => {
    if (!cancellable || !onCancel) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cancellable, onCancel]);

  return (
    <DialogShell
      maxWidth="sm"
      ariaLabel={statusMessage}
      overlayTestId="progress-overlay"
      dialogTestId="progress-dialog"
    >
      <div className="p-4">
        <p
          className="mb-3 text-body text-[var(--color-text-primary)]"
          aria-live="polite"
          data-testid="progress-message"
        >
          {statusMessage}
        </p>

        <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-bg)]">
          <div
            className={`h-full rounded-full bg-[var(--color-primary)] transition-all ${
              isIndeterminate ? "animate-pulse w-full" : ""
            }`}
            role="progressbar"
            aria-valuenow={isIndeterminate ? undefined : Math.round(Math.min(100, Math.max(0, percentage)))}
            aria-valuemin={0}
            aria-valuemax={100}
            style={
              isIndeterminate
                ? undefined
                : { width: `${Math.min(100, Math.max(0, percentage))}%` }
            }
            data-testid="progress-bar"
          />
        </div>

        {!isIndeterminate && (
          <p
            className="mt-1 text-right text-caption text-[var(--color-text-secondary)]"
            data-testid="progress-percentage"
          >
            {Math.round(percentage)}%
          </p>
        )}

        {cancellable && onCancel && (
          <div className="mt-3 flex justify-end">
            <button
              className="btn btn-outline btn-sm"
              onClick={onCancel}
              data-testid="progress-cancel"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </DialogShell>
  );
}
