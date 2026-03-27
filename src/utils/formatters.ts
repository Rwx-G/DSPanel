import { i18n } from "../i18n";

/** Returns the active i18n language code (e.g. "en", "fr"). */
function currentLocale(): string {
  return i18n.language ?? "en";
}

/** Format a date using the active locale. */
export function formatDate(
  date: Date | string | number | null | undefined,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (date == null) return "";
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return String(date);
  return new Intl.DateTimeFormat(currentLocale(), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...options,
  }).format(d);
}

/** Format a date with time using the active locale. */
export function formatDateTime(
  date: Date | string | number | null | undefined,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (date == null) return "";
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return String(date);
  return new Intl.DateTimeFormat(currentLocale(), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    ...options,
  }).format(d);
}

/** Format a relative time (e.g. "3 days ago") using the active locale. */
export function formatRelativeTime(
  date: Date | string | number | null | undefined,
): string {
  if (date == null) return "";
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return String(date);

  const diffMs = Date.now() - d.getTime();
  const diffSec = Math.round(diffMs / 1000);
  const diffMin = Math.round(diffSec / 60);
  const diffHour = Math.round(diffMin / 60);
  const diffDay = Math.round(diffHour / 24);

  const rtf = new Intl.RelativeTimeFormat(currentLocale(), {
    numeric: "auto",
  });

  if (Math.abs(diffSec) < 60) return rtf.format(-diffSec, "second");
  if (Math.abs(diffMin) < 60) return rtf.format(-diffMin, "minute");
  if (Math.abs(diffHour) < 24) return rtf.format(-diffHour, "hour");
  return rtf.format(-diffDay, "day");
}

/** Format a number using the active locale. */
export function formatNumber(
  value: number | null | undefined,
  options?: Intl.NumberFormatOptions,
): string {
  if (value == null) return "";
  return new Intl.NumberFormat(currentLocale(), options).format(value);
}

/** Format a percentage using the active locale. */
export function formatPercent(
  value: number | null | undefined,
  fractionDigits = 1,
): string {
  if (value == null) return "";
  return new Intl.NumberFormat(currentLocale(), {
    style: "percent",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value / 100);
}
