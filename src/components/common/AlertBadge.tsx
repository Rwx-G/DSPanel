import { useState, useId, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { CheckCircle, AlertTriangle, AlertCircle, Info } from "lucide-react";
import type { AlertSeverity, SecurityAlert } from "@/types/security";

const SEVERITY_STYLES: Record<AlertSeverity, string> = {
  Critical: "bg-[var(--color-error)]/10 text-[var(--color-error)]",
  High: "bg-[var(--color-warning)]/10 text-[var(--color-warning)]",
  Medium: "bg-[var(--color-caution,var(--color-warning))]/10 text-[var(--color-caution,var(--color-warning))]",
  Info: "bg-[var(--color-info)]/10 text-[var(--color-info)]",
};

const SEVERITY_TEXT_COLOR: Record<AlertSeverity, string> = {
  Critical: "text-[var(--color-error)]",
  High: "text-[var(--color-warning)]",
  Medium: "text-[var(--color-caution,var(--color-warning))]",
  Info: "text-[var(--color-info)]",
};

const SEVERITY_ICON: Record<AlertSeverity, typeof Info> = {
  Critical: AlertCircle,
  High: AlertTriangle,
  Medium: AlertTriangle,
  Info: Info,
};

interface AlertBadgeProps {
  alerts: SecurityAlert[];
  /** When true, shows only the icon without text. */
  compact?: boolean;
}

/** Highest severity from a list of alerts. */
function highestSeverity(alerts: SecurityAlert[]): AlertSeverity {
  const order: AlertSeverity[] = ["Critical", "High", "Medium", "Info"];
  for (const level of order) {
    if (alerts.some((a) => a.severity === level)) return level;
  }
  return "Info";
}

export function AlertBadge({ alerts, compact = false }: AlertBadgeProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipId = useId();
  const badgeRef = useRef<HTMLDivElement>(null);
  const [tooltipPos, setTooltipPos] = useState<{
    top: number;
    left: number;
  } | null>(null);

  const count = alerts.length;
  const level = count > 0 ? highestSeverity(alerts) : null;
  const Icon = level ? SEVERITY_ICON[level] : CheckCircle;

  useEffect(() => {
    if (!showTooltip || !badgeRef.current) {
      setTooltipPos(null);
      return;
    }
    const rect = badgeRef.current.getBoundingClientRect();
    const tooltipWidth = 320;
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
      aria-label={
        count === 0
          ? "No alerts"
          : `${count} alert${count > 1 ? "s" : ""}, highest: ${level}`
      }
      aria-describedby={showTooltip ? tooltipId : undefined}
      data-testid="alert-badge"
      data-level={level ?? "ok"}
    >
      <span
        className={`inline-flex items-center gap-1 rounded-full ${compact ? "p-1" : "px-2 py-0.5"} text-[11px] font-medium ${level ? SEVERITY_STYLES[level] : "bg-[var(--color-success)]/10 text-[var(--color-success)]"}`}
      >
        <Icon size={12} />
        {!compact &&
          (count === 0
            ? "OK"
            : `${count} alert${count > 1 ? "s" : ""}`)}
      </span>

      {showTooltip &&
        tooltipPos &&
        createPortal(
          <div
            id={tooltipId}
            role="tooltip"
            className="fixed z-50 w-80 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-2 shadow-lg"
            style={{ top: tooltipPos.top, left: tooltipPos.left }}
            data-testid="alert-tooltip"
          >
            {count === 0 ? (
              <div className="flex items-center gap-1.5 text-caption text-[var(--color-text-secondary)]">
                <CheckCircle
                  size={12}
                  className="shrink-0 text-[var(--color-success)]"
                />
                No alerts detected
              </div>
            ) : (
              <ul className="space-y-1.5">
                {alerts.map((alert, i) => {
                  const FlagIcon = SEVERITY_ICON[alert.severity];
                  return (
                    <li
                      key={i}
                      className="flex items-center gap-1.5"
                      data-testid={`alert-flag-${alert.alertType}`}
                    >
                      <FlagIcon
                        size={12}
                        className={`shrink-0 ${SEVERITY_TEXT_COLOR[alert.severity]}`}
                      />
                      <div className="min-w-0">
                        <span className={`text-caption font-medium ${SEVERITY_TEXT_COLOR[alert.severity]}`}>
                          {alert.severity}
                        </span>
                        <p className="text-[10px] text-[var(--color-text-secondary)]">
                          {alert.message}
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
