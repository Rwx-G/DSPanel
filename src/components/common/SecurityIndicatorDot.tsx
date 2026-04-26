import { useState, useId, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Shield, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  SecurityIndicator,
  SecurityIndicatorSet,
  IndicatorSeverity,
} from "@/types/securityIndicators";

interface SecurityIndicatorDotProps {
  indicators: SecurityIndicatorSet;
}

const SEVERITY_COLOR: Record<IndicatorSeverity, string> = {
  Healthy: "var(--color-success)",
  Info: "var(--color-info)",
  Warning: "var(--color-warning)",
  Critical: "var(--color-error)",
};

/**
 * Maximum number of metadata items rendered inline before truncation. Past
 * this count the popover shows "+N more" so the row stays compact and the
 * operator gets a stable visual rhythm regardless of how many SPNs / SIDs
 * are configured.
 */
const METADATA_PREVIEW_LIMIT = 3;

/**
 * Returns the metadata array (target SPNs for `ConstrainedDelegation`,
 * allowed-principal SIDs for `Rbcd`) when present, else null. Other
 * indicator kinds have no metadata payload.
 */
function metadataItemsFor(indicator: SecurityIndicator): string[] | null {
  if (indicator.kind === "ConstrainedDelegation") {
    const spns = indicator.metadata?.target_spns;
    return Array.isArray(spns) ? (spns as string[]) : null;
  }
  if (indicator.kind === "Rbcd") {
    const principals = indicator.metadata?.allowed_principals;
    return Array.isArray(principals) ? (principals as string[]) : null;
  }
  return null;
}

/**
 * Compact aggregate indicator for the user / computer lookup list. Shows a
 * shield icon colored by `highestSeverity`. Hover (or focus) opens a portal
 * tooltip listing every indicator on the object with its localized label.
 *
 * Renders nothing when the indicator set is empty - rows for clean objects
 * stay visually unchanged. Visually distinct from HealthBadge by using a
 * shield instead of a circular dot.
 */
export function SecurityIndicatorDot({
  indicators,
}: SecurityIndicatorDotProps) {
  const { t } = useTranslation("securityIndicators");
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipId = useId();
  const dotRef = useRef<HTMLDivElement>(null);
  const [tooltipPos, setTooltipPos] = useState<{
    top: number;
    left: number;
  } | null>(null);

  const count = indicators.indicators.length;
  const Icon = indicators.highestSeverity === "Critical" ? ShieldAlert : Shield;
  const color = SEVERITY_COLOR[indicators.highestSeverity];

  useEffect(() => {
    if (!showTooltip || !dotRef.current) {
      setTooltipPos(null);
      return;
    }
    const rect = dotRef.current.getBoundingClientRect();
    const tooltipWidth = 256;
    let left = rect.left + rect.width / 2 - tooltipWidth / 2;
    let top = rect.bottom + 4;
    if (left < 4) left = 4;
    if (left + tooltipWidth > window.innerWidth - 4) {
      left = window.innerWidth - tooltipWidth - 4;
    }
    if (top + 100 > window.innerHeight) {
      top = rect.top - 4;
    }
    setTooltipPos({ top, left });
  }, [showTooltip]);

  if (count === 0) return null;

  return (
    <div
      ref={dotRef}
      className="relative inline-flex"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      onFocus={() => setShowTooltip(true)}
      onBlur={() => setShowTooltip(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && showTooltip) {
          setShowTooltip(false);
        } else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setShowTooltip((prev) => !prev);
        }
      }}
      tabIndex={0}
      role="status"
      aria-label={t("dot.ariaLabel", { count })}
      aria-describedby={showTooltip ? tooltipId : undefined}
      data-testid="security-indicator-dot"
      data-severity={indicators.highestSeverity}
      data-count={count}
    >
      <span
        className="inline-flex items-center justify-center rounded-full p-1"
        style={{ backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)` }}
      >
        <Icon size={12} style={{ color }} />
      </span>

      {showTooltip &&
        tooltipPos &&
        createPortal(
          <div
            id={tooltipId}
            role="tooltip"
            className="fixed z-50 w-64 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-2 shadow-lg"
            style={{ top: tooltipPos.top, left: tooltipPos.left }}
            data-testid="security-indicator-tooltip"
          >
            <p className="mb-1 text-caption font-medium text-[var(--color-text-primary)]">
              {t("dot.popoverHeader")}
            </p>
            <ul className="space-y-1.5">
              {indicators.indicators.map((indicator) => {
                const indicatorColor = SEVERITY_COLOR[indicator.severity];
                const metadata = metadataItemsFor(indicator);
                const preview = metadata?.slice(0, METADATA_PREVIEW_LIMIT) ?? [];
                const overflow = (metadata?.length ?? 0) - preview.length;
                return (
                  <li
                    key={indicator.kind}
                    className="flex items-start gap-1.5"
                    data-testid={`security-indicator-row-${indicator.kind}`}
                  >
                    <span
                      className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: indicatorColor }}
                      aria-hidden="true"
                    />
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-caption text-[var(--color-text-primary)]">
                        {t(`${indicator.kind}.badge`)}
                      </span>
                      {preview.length > 0 && (
                        <span
                          className="font-mono text-[11px] text-[var(--color-text-secondary)] break-all"
                          data-testid={`security-indicator-meta-${indicator.kind}`}
                        >
                          {preview.join(", ")}
                          {overflow > 0 &&
                            " " +
                              t("dot.metadataMore", { count: overflow })}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}
