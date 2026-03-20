export interface ExchangeOnlineInfo {
  primarySmtpAddress: string;
  emailAliases: string[];
  forwardingSmtpAddress: string | null;
  autoReplyStatus: string;
  mailboxUsageBytes: number;
  mailboxQuotaBytes: number;
  usagePercentage: number;
  delegates: string[];
}

/** Formats byte count as a human-readable size string. */
export function formatBytes(bytes: number): string {
  const KB = 1024;
  const MB = KB * 1024;
  const GB = MB * 1024;

  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  if (bytes >= KB) return `${(bytes / KB).toFixed(1)} KB`;
  return `${bytes} B`;
}

/** Returns a color token based on usage percentage. */
export function usageColor(percentage: number): string {
  if (percentage >= 90) return "var(--color-error)";
  if (percentage >= 75) return "var(--color-warning)";
  return "var(--color-success)";
}
