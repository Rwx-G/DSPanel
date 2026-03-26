import { useState } from "react";
import { ChevronDown, ChevronRight, Mail } from "lucide-react";
import { CopyButton } from "@/components/common/CopyButton";
import { type ExchangeMailboxInfo } from "@/types/exchange";
import { parseCnFromDn } from "@/utils/dn";
import { useTranslation } from "react-i18next";

interface ExchangePanelProps {
  exchangeInfo: ExchangeMailboxInfo;
}

export function ExchangePanel({ exchangeInfo }: ExchangePanelProps) {
  const { t } = useTranslation(["components", "common"]);
  const [expanded, setExpanded] = useState(true);

  return (
    <div data-testid="exchange-panel">
      <button
        className="flex w-full items-center gap-2 py-1 text-left text-body font-semibold text-[var(--color-text-primary)] hover:text-[var(--color-primary)]"
        onClick={() => setExpanded(!expanded)}
        data-testid="exchange-panel-toggle"
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Mail size={14} />
        {t("components:exchangePanel.title")}
      </button>

      {expanded && (
        <div
          className="mt-2 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)]"
          data-testid="exchange-panel-content"
        >
          <table className="w-full text-caption">
            <tbody>
              <PropertyRow
                label={t("components:exchangePanel.mailboxGuid")}
                value={exchangeInfo.mailboxGuid}
              />
              <PropertyRow
                label={t("components:exchangePanel.recipientType")}
                value={exchangeInfo.recipientType}
              />
              <PropertyRow
                label={t("components:exchangePanel.primarySmtp")}
                value={exchangeInfo.primarySmtpAddress}
              />
              {exchangeInfo.forwardingAddress && (
                <PropertyRow
                  label={t("components:exchangePanel.forwardingTo")}
                  value={parseCnFromDn(exchangeInfo.forwardingAddress)}
                  title={exchangeInfo.forwardingAddress}
                />
              )}
            </tbody>
          </table>

          {exchangeInfo.emailAliases.length > 0 && (
            <div className="border-t border-[var(--color-border-subtle)] px-3 py-2">
              <h4 className="mb-1 text-caption font-medium text-[var(--color-text-secondary)]">
                {t("components:exchangePanel.emailAliases", { count: exchangeInfo.emailAliases.length })}
              </h4>
              <ul className="space-y-0.5" data-testid="exchange-aliases-list">
                {exchangeInfo.emailAliases.map((alias) => (
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

          {exchangeInfo.delegates.length > 0 && (
            <div className="border-t border-[var(--color-border-subtle)] px-3 py-2">
              <h4 className="mb-1 text-caption font-medium text-[var(--color-text-secondary)]">
                {t("components:exchangePanel.delegates", { count: exchangeInfo.delegates.length })}
              </h4>
              <ul className="space-y-0.5" data-testid="exchange-delegates-list">
                {exchangeInfo.delegates.map((dn) => (
                  <li
                    key={dn}
                    className="text-caption text-[var(--color-text-primary)]"
                    title={dn}
                  >
                    {parseCnFromDn(dn)}
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

function PropertyRow({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string;
}) {
  const { t } = useTranslation(["common"]);
  return (
    <tr className="border-b border-[var(--color-border-subtle)] last:border-b-0">
      <td className="w-1/3 px-3 py-1.5 text-[var(--color-text-secondary)]">
        {label}
      </td>
      <td className="px-3 py-1.5 text-[var(--color-text-primary)]">
        <span className="flex items-center gap-1" title={title}>
          <span className="font-mono">{value || t("common:na")}</span>
          {value && <CopyButton text={value} />}
        </span>
      </td>
    </tr>
  );
}
