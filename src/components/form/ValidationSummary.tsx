import { AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ValidationSummaryProps {
  errors: Record<string, string>;
  onErrorClick?: (fieldName: string) => void;
}

export function ValidationSummary({
  errors,
  onErrorClick,
}: ValidationSummaryProps) {
  const { t } = useTranslation(["components"]);
  const errorEntries = Object.entries(errors);

  if (errorEntries.length === 0) return null;

  return (
    <div
      className="rounded-md border border-[var(--color-error)] bg-[var(--color-error-bg)] p-3"
      role="alert"
      data-testid="validation-summary"
    >
      <div className="flex items-center gap-2 text-body font-medium text-[var(--color-error)]">
        <AlertCircle size={16} />
        <span>
          {t("components:validationSummary.error", { count: errorEntries.length })}
        </span>
      </div>
      <ul className="mt-2 space-y-1 pl-6">
        {errorEntries.map(([field, message]) => (
          <li key={field} className="text-caption text-[var(--color-error)]">
            {onErrorClick ? (
              <button
                onClick={() => onErrorClick(field)}
                className="text-left hover:underline"
                data-testid={`validation-error-${field}`}
              >
                {message}
              </button>
            ) : (
              <span data-testid={`validation-error-${field}`}>{message}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
