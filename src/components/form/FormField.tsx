import { type ReactNode, useId, isValidElement, cloneElement } from "react";

interface FormFieldProps {
  label: string;
  error?: string;
  required?: boolean;
  htmlFor?: string;
  children: ReactNode;
}

export function FormField({
  label,
  error,
  required = false,
  htmlFor,
  children,
}: FormFieldProps) {
  const errorId = useId();

  // Inject aria-describedby on the first child element when an error is present
  const enhancedChildren =
    error && isValidElement(children)
      ? cloneElement(children as React.ReactElement<Record<string, unknown>>, {
          "aria-describedby": errorId,
        })
      : children;

  return (
    <div className="space-y-1" data-testid="form-field">
      <label
        htmlFor={htmlFor}
        className="block text-caption font-medium text-[var(--color-text-primary)]"
        data-testid="form-field-label"
      >
        {label}
        {required && (
          <span className="ml-0.5 text-[var(--color-error)]" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {enhancedChildren}
      {error && (
        <p
          id={errorId}
          className="text-caption text-[var(--color-error)]"
          role="alert"
          data-testid="form-field-error"
        >
          {error}
        </p>
      )}
    </div>
  );
}
