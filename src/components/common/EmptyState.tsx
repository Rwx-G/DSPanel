import { type ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 py-12 text-center"
      data-testid="empty-state"
    >
      {icon && (
        <div
          className="text-[var(--color-text-secondary)]"
          data-testid="empty-state-icon"
        >
          {icon}
        </div>
      )}
      <h3
        className="text-body font-medium text-[var(--color-text-primary)]"
        data-testid="empty-state-title"
      >
        {title}
      </h3>
      {description && (
        <p
          className="max-w-sm text-caption text-[var(--color-text-secondary)]"
          data-testid="empty-state-description"
        >
          {description}
        </p>
      )}
      {action && (
        <button
          className="btn btn-sm btn-primary mt-2"
          onClick={action.onClick}
          data-testid="empty-state-action"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
