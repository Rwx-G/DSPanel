import { type ReactNode } from "react";
import { useFocusTrap } from "@/hooks/useFocusTrap";

interface DialogShellProps {
  children: ReactNode;
  onClose?: () => void;
  maxWidth?: "sm" | "md" | "lg";
  ariaLabelledBy?: string;
  ariaLabel?: string;
  overlayTestId?: string;
  dialogTestId?: string;
}

const MAX_WIDTH_CLASS = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
};

export function DialogShell({
  children,
  onClose,
  maxWidth = "md",
  ariaLabelledBy,
  ariaLabel,
  overlayTestId = "dialog-overlay",
  dialogTestId = "dialog",
}: DialogShellProps) {
  const dialogRef = useFocusTrap<HTMLDivElement>();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-surface-overlay)]"
      onClick={onClose}
      data-testid={overlayTestId}
    >
      <div
        ref={dialogRef}
        className={`mx-4 w-full ${MAX_WIDTH_CLASS[maxWidth]} rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] shadow-lg`}
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabelledBy}
        aria-label={ariaLabel}
        data-testid={dialogTestId}
      >
        {children}
      </div>
    </div>
  );
}
