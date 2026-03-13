interface InlineProgressProps {
  active?: boolean;
  progress?: number;
  statusMessage?: string;
}

export function InlineProgress({
  active = true,
  progress,
  statusMessage,
}: InlineProgressProps) {
  if (!active) return null;

  const isIndeterminate = progress === undefined;

  return (
    <div className="flex items-center gap-2" data-testid="inline-progress">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--color-surface-bg)]">
        <div
          className={`h-full rounded-full bg-[var(--color-primary)] transition-all ${
            isIndeterminate ? "animate-pulse w-full" : ""
          }`}
          style={
            isIndeterminate
              ? undefined
              : { width: `${Math.min(100, Math.max(0, progress))}%` }
          }
          data-testid="inline-progress-bar"
        />
      </div>
      {statusMessage && (
        <span
          className="text-caption text-[var(--color-text-secondary)]"
          data-testid="inline-progress-message"
        >
          {statusMessage}
        </span>
      )}
    </div>
  );
}
