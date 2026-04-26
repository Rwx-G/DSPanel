import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";

interface TruncatedBannerProps {
  truncated: boolean;
  /** Optional: count actually shown, used in the message. */
  shown?: number;
}

/**
 * Surfaces the case where the underlying LDAP browse hit `sizeLimitExceeded`
 * server-side or our `MAX_BROWSE` cap was reached with more pages available.
 * Without this banner the user would be looking at a silently incomplete
 * list and could draw wrong conclusions (e.g. "the user does not exist").
 */
export function TruncatedBanner({ truncated, shown }: TruncatedBannerProps) {
  const { t } = useTranslation("common");
  if (!truncated) return null;
  return (
    <div
      role="alert"
      className="mb-3 flex items-start gap-2 rounded-lg border border-[var(--color-warning)] bg-[var(--color-warning-bg)] px-3 py-2 text-caption text-[var(--color-warning)]"
      data-testid="truncated-banner"
    >
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <div>
        <p className="font-medium">{t("truncatedTitle")}</p>
        <p className="mt-0.5 text-[var(--color-text-secondary)]">
          {shown !== undefined
            ? t("truncatedDetailWithCount", { shown })
            : t("truncatedDetail")}
        </p>
      </div>
    </div>
  );
}
