import { X } from "lucide-react";

interface TagChipProps {
  text: string;
  removable?: boolean;
  onRemove?: () => void;
}

export function TagChip({ text, removable = true, onRemove }: TagChipProps) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md bg-[var(--color-surface-hover)] px-2 py-0.5 text-caption text-[var(--color-text-primary)]"
      data-testid="tag-chip"
    >
      {text}
      {removable && onRemove && (
        <button
          onClick={onRemove}
          className="rounded-sm p-0.5 hover:bg-[var(--color-surface-card)] transition-colors"
          aria-label={`Remove ${text}`}
          data-testid="tag-chip-remove"
        >
          <X size={10} />
        </button>
      )}
    </span>
  );
}
