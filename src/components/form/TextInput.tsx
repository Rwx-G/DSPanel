import { forwardRef, type InputHTMLAttributes } from "react";

interface TextInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type"
> {
  error?: boolean;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  ({ error = false, className = "", disabled, ...props }, ref) => {
    return (
      <input
        ref={ref}
        type="text"
        disabled={disabled}
        className={`w-full rounded-md border px-3 py-1.5 text-body text-[var(--color-text-primary)] bg-[var(--color-surface-card)] outline-none transition-colors placeholder:text-[var(--color-text-secondary)] ${
          error
            ? "border-[var(--color-error)] focus:border-[var(--color-error)] focus:ring-1 focus:ring-[var(--color-error)]"
            : "border-[var(--color-border-default)] focus:border-[var(--color-border-focus)] focus:ring-1 focus:ring-[var(--color-border-focus)]"
        } ${disabled ? "cursor-not-allowed opacity-50" : ""} ${className}`}
        aria-invalid={error || undefined}
        data-testid="text-input"
        {...props}
      />
    );
  },
);

TextInput.displayName = "TextInput";
