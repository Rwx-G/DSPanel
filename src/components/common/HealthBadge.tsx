import { useState, useId, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { CheckCircle, AlertTriangle, AlertCircle, Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AccountHealthStatus, HealthLevel } from "@/types/health";

const LEVEL_STYLES: Record<HealthLevel, string> = {
  Healthy: "bg-[var(--color-success)]/10 text-[var(--color-success)]",
  Info: "bg-[var(--color-info)]/10 text-[var(--color-info)]",
  Warning: "bg-[var(--color-warning)]/10 text-[var(--color-warning)]",
  Critical: "bg-[var(--color-error)]/10 text-[var(--color-error)]",
};

const LEVEL_ICON: Record<HealthLevel, typeof Info> = {
  Healthy: CheckCircle,
  Info: Info,
  Warning: AlertTriangle,
  Critical: AlertCircle,
};

interface HealthBadgeProps {
  healthStatus: AccountHealthStatus;
  /** When true, shows only the icon without text. */
  compact?: boolean;
}

export function HealthBadge({ healthStatus, compact = false }: HealthBadgeProps) {
  const { t } = useTranslation("components");
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipId = useId();
  const badgeRef = useRef<HTMLDivElement>(null);
  const [tooltipPos, setTooltipPos] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const Icon = LEVEL_ICON[healthStatus.level];
  const flagCount = healthStatus.activeFlags.length;

  // Compute tooltip position relative to viewport when shown
  useEffect(() => {
    if (!showTooltip || !badgeRef.current) {
      setTooltipPos(null);
      return;
    }
    const rect = badgeRef.current.getBoundingClientRect();
    const tooltipWidth = 256; // w-64 = 16rem = 256px
    let left = rect.left + rect.width / 2 - tooltipWidth / 2;
    let top = rect.bottom + 4;

    // Keep within viewport
    if (left < 4) left = 4;
    if (left + tooltipWidth > window.innerWidth - 4) {
      left = window.innerWidth - tooltipWidth - 4;
    }
    // If it would go below viewport, show above
    if (top + 100 > window.innerHeight) {
      top = rect.top - 4;
    }

    setTooltipPos({ top, left });
  }, [showTooltip]);

  return (
    <div
      ref={badgeRef}
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
      aria-label={flagCount === 0 ? t("healthBadge.healthy") : t("healthBadge.issue", { count: flagCount })}
      aria-describedby={showTooltip ? tooltipId : undefined}
      data-testid="health-badge"
      data-level={healthStatus.level}
    >
      <span
        className={`inline-flex items-center gap-1 rounded-full ${compact ? "p-1" : "px-2 py-0.5"} text-[11px] font-medium ${LEVEL_STYLES[healthStatus.level]}`}
      >
        <Icon size={12} />
        {!compact &&
          (flagCount === 0
            ? t("healthBadge.healthy")
            : t("healthBadge.issue", { count: flagCount }))}
      </span>

      {showTooltip &&
        tooltipPos &&
        createPortal(
          <div
            id={tooltipId}
            role="tooltip"
            className="fixed z-50 w-64 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-2 shadow-lg"
            style={{ top: tooltipPos.top, left: tooltipPos.left }}
            data-testid="health-tooltip"
          >
            {flagCount === 0 ? (
              <div className="flex items-center gap-1.5 text-caption text-[var(--color-text-secondary)]">
                <CheckCircle size={12} className="shrink-0 text-[var(--color-success)]" />
                {t("healthBadge.noIssues")}
              </div>
            ) : (
              <ul className="space-y-1">
                {healthStatus.activeFlags.map((flag) => {
                  const FlagIcon = LEVEL_ICON[flag.severity];
                  return (
                    <li
                      key={flag.name}
                      className="flex items-center gap-1.5"
                      data-testid={`health-flag-${flag.name}`}
                    >
                      <FlagIcon
                        size={12}
                        className={`mr-1 shrink-0 ${LEVEL_STYLES[flag.severity].split(" ")[1]}`}
                      />
                      <div>
                        <span className="text-caption font-medium text-[var(--color-text-primary)]">
                          {t(`healthBadge.flags.${flag.name}`, { defaultValue: flag.name })}
                        </span>
                        <p className="text-[10px] text-[var(--color-text-secondary)]">
                          {t(`healthBadge.flagDesc.${flag.name}`, { defaultValue: flag.description })}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
