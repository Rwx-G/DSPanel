import { useState, forwardRef, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";

interface PasswordInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type"
> {
  error?: boolean;
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ error = false, className = "", disabled, ...props }, ref) => {
    const [visible, setVisible] = useState(false);

    return (
      <div className="relative" data-testid="password-input-wrapper">
        <input
          ref={ref}
          type={visible ? "text" : "password"}
          disabled={disabled}
          className={`w-full rounded-md border px-3 py-1.5 pr-9 text-body text-[var(--color-text-primary)] bg-[var(--color-surface-card)] outline-none transition-colors placeholder:text-[var(--color-text-secondary)] ${
            error
              ? "border-[var(--color-error)] focus:border-[var(--color-error)] focus:ring-1 focus:ring-[var(--color-error)]"
              : "border-[var(--color-border-default)] focus:border-[var(--color-border-focus)] focus:ring-1 focus:ring-[var(--color-border-focus)]"
          } ${disabled ? "cursor-not-allowed opacity-50" : ""} ${className}`}
          aria-invalid={error || undefined}
          data-testid="password-input"
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible(!visible)}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          aria-label={visible ? "Hide password" : "Show password"}
          tabIndex={-1}
          data-testid="password-toggle"
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    );
  },
);

PasswordInput.displayName = "PasswordInput";
