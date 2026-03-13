interface LoadingSpinnerProps {
  message?: string;
  active?: boolean;
  size?: number;
}

export function LoadingSpinner({
  message,
  active = true,
  size = 24,
}: LoadingSpinnerProps) {
  if (!active) return null;

  return (
    <div
      className="flex flex-col items-center justify-center gap-2"
      data-testid="loading-spinner"
    >
      <div
        className="animate-spin rounded-full border-2 border-[var(--color-border-default)] border-t-[var(--color-primary)]"
        style={{ width: size, height: size }}
        role="status"
        aria-label="Loading"
      />
      {message && (
        <p
          className="text-caption text-[var(--color-text-secondary)]"
          data-testid="loading-message"
        >
          {message}
        </p>
      )}
    </div>
  );
}
