import { useState } from "react";
import { ChevronDown, ChevronRight, Cloud } from "lucide-react";
import { CopyButton } from "@/components/common/CopyButton";
import {
  type ExchangeOnlineInfo,
  formatBytes,
  usageColor,
} from "@/types/exchange-online";

interface ExchangeOnlinePanelProps {
  exchangeOnlineInfo: ExchangeOnlineInfo;
}

export function ExchangeOnlinePanel({
  exchangeOnlineInfo: info,
}: ExchangeOnlinePanelProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div data-testid="exchange-online-panel">
      <button
        className="flex w-full items-center gap-2 py-1 text-left text-body font-semibold text-[var(--color-text-primary)] hover:text-[var(--color-primary)]"
        onClick={() => setExpanded(!expanded)}
        data-testid="exchange-online-panel-toggle"
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Cloud size={14} />
        Exchange Online
      </button>

      {expanded && (
        <div
          className="mt-2 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)]"
          data-testid="exchange-online-panel-content"
        >
          <table className="w-full text-caption">
            <tbody>
              <PropertyRow label="Primary SMTP" value={info.primarySmtpAddress} />
              <PropertyRow label="Auto-Reply" value={info.autoReplyStatus} />
              {info.forwardingSmtpAddress && (
                <PropertyRow
                  label="Forwarding To"
                  value={info.forwardingSmtpAddress}
                />
              )}
            </tbody>
          </table>

          {/* Quota usage bar */}
          <div
            className="border-t border-[var(--color-border-subtle)] px-3 py-2"
            data-testid="exchange-online-quota"
          >
            <div className="mb-1 flex items-center justify-between text-caption">
              <span className="text-[var(--color-text-secondary)]">
                Mailbox Usage
              </span>
              <span className="font-mono text-[var(--color-text-primary)]">
                {formatBytes(info.mailboxUsageBytes)} /{" "}
                {formatBytes(info.mailboxQuotaBytes)} (
                {info.usagePercentage.toFixed(1)}%)
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-bg)]">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(info.usagePercentage, 100)}%`,
                  backgroundColor: usageColor(info.usagePercentage),
                }}
                data-testid="exchange-online-quota-bar"
              />
            </div>
          </div>

          {info.emailAliases.length > 0 && (
            <div className="border-t border-[var(--color-border-subtle)] px-3 py-2">
              <h4 className="mb-1 text-caption font-medium text-[var(--color-text-secondary)]">
                Email Aliases ({info.emailAliases.length})
              </h4>
              <ul
                className="space-y-0.5"
                data-testid="exchange-online-aliases-list"
              >
                {info.emailAliases.map((alias) => (
                  <li
                    key={alias}
                    className="flex items-center gap-1 text-caption text-[var(--color-text-primary)]"
                  >
                    <span className="font-mono">{alias}</span>
                    <CopyButton text={alias} />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {info.delegates.length > 0 && (
            <div className="border-t border-[var(--color-border-subtle)] px-3 py-2">
              <h4 className="mb-1 text-caption font-medium text-[var(--color-text-secondary)]">
                Delegates ({info.delegates.length})
              </h4>
              <ul
                className="space-y-0.5"
                data-testid="exchange-online-delegates-list"
              >
                {info.delegates.map((delegate) => (
                  <li
                    key={delegate}
                    className="text-caption text-[var(--color-text-primary)]"
                  >
                    {delegate}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PropertyRow({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-b border-[var(--color-border-subtle)] last:border-b-0">
      <td className="w-1/3 px-3 py-1.5 text-[var(--color-text-secondary)]">
        {label}
      </td>
      <td className="px-3 py-1.5 text-[var(--color-text-primary)]">
        <span className="flex items-center gap-1">
          <span className="font-mono">{value || "N/A"}</span>
          {value && <CopyButton text={value} />}
        </span>
      </td>
    </tr>
  );
}
