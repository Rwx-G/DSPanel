type BadgeVariant = "success" | "warning" | "error" | "info" | "neutral";

interface StatusBadgeProps {
  text: string;
  variant?: BadgeVariant;
}

const VARIANT_STYLES: Record<BadgeVariant, string> = {
  neutral: "bg-[var(--color-surface-hover)] text-[var(--color-text-primary)]",
  success: "bg-[var(--color-success)]/10 text-[var(--color-success)]",
  warning: "bg-[var(--color-warning)]/10 text-[var(--color-warning)]",
  error: "bg-[var(--color-error)]/10 text-[var(--color-error)]",
  info: "bg-[var(--color-info)]/10 text-[var(--color-info)]",
};

export function StatusBadge({ text, variant = "neutral" }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${VARIANT_STYLES[variant]}`}
      data-testid="status-badge"
      data-variant={variant}
    >
      {text}
    </span>
  );
}
