import { useEffect, useRef } from "react";
import { AlertCircle, AlertTriangle, Info } from "lucide-react";

type DialogSeverity = "info" | "warning" | "error";

interface ConfirmationDialogProps {
  title: string;
  message: string;
  detail?: string;
  severity?: DialogSeverity;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const SEVERITY_ICON: Record<DialogSeverity, typeof Info> = {
  info: Info,
  warning: AlertTriangle,
  error: AlertCircle,
};

const SEVERITY_COLOR: Record<DialogSeverity, string> = {
  info: "text-[var(--color-info)]",
  warning: "text-[var(--color-warning)]",
  error: "text-[var(--color-error)]",
};

export function ConfirmationDialog({
  title,
  message,
  detail,
  severity = "info",
  confirmLabel = "OK",
  cancelLabel,
  onConfirm,
  onCancel,
}: ConfirmationDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onConfirm();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onConfirm, onCancel]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const IconComp = SEVERITY_ICON[severity];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-surface-overlay)]"
      onClick={onCancel}
      data-testid="dialog-overlay"
    >
      <div
        ref={dialogRef}
        className="mx-4 w-full max-w-md rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] shadow-lg"
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmation-dialog-title"
        data-testid="confirmation-dialog"
      >
        <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] px-4 py-3">
          <IconComp size={20} className={SEVERITY_COLOR[severity]} aria-hidden="true" />
          <h2
            id="confirmation-dialog-title"
            className="text-body font-semibold text-[var(--color-text-primary)]"
            data-testid="dialog-title"
          >
            {title}
          </h2>
        </div>

        <div className="px-4 py-3">
          <p
            className="text-body text-[var(--color-text-primary)]"
            data-testid="dialog-message"
          >
            {message}
          </p>
          {detail && (
            <details className="mt-2" data-testid="dialog-detail">
              <summary className="cursor-pointer text-caption text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
                Details
              </summary>
              <pre className="mt-1 max-h-32 overflow-auto rounded bg-[var(--color-surface-bg)] p-2 text-caption text-[var(--color-text-secondary)]">
                {detail}
              </pre>
            </details>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--color-border-subtle)] px-4 py-3">
          {cancelLabel && (
            <button
              className="btn-secondary"
              onClick={onCancel}
              data-testid="dialog-cancel"
            >
              {cancelLabel}
            </button>
          )}
          <button
            className="btn-primary"
            onClick={onConfirm}
            data-testid="dialog-confirm"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
