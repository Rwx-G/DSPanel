import { useEffect } from "react";

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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-surface-overlay)]"
      data-testid="progress-overlay"
    >
      <div
        className="mx-4 w-full max-w-sm rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-4 shadow-lg"
        role="dialog"
        aria-modal="true"
        data-testid="progress-dialog"
      >
        <p
          className="mb-3 text-body text-[var(--color-text-primary)]"
          data-testid="progress-message"
        >
          {statusMessage}
        </p>

        <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-bg)]">
          <div
            className={`h-full rounded-full bg-[var(--color-primary)] transition-all ${
              isIndeterminate ? "animate-pulse w-full" : ""
            }`}
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
    </div>
  );
}
