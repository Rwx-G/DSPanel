import { useState } from "react";
import { CheckCircle, AlertTriangle, AlertCircle, Info } from "lucide-react";
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
}

export function HealthBadge({ healthStatus }: HealthBadgeProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const Icon = LEVEL_ICON[healthStatus.level];
  const flagCount = healthStatus.activeFlags.length;

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      onFocus={() => setShowTooltip(true)}
      onBlur={() => setShowTooltip(false)}
      tabIndex={0}
      role="status"
      aria-label={`Health: ${healthStatus.level}${flagCount > 0 ? `, ${flagCount} issue${flagCount > 1 ? "s" : ""}` : ""}`}
      data-testid="health-badge"
      data-level={healthStatus.level}
    >
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${LEVEL_STYLES[healthStatus.level]}`}
      >
        <Icon size={12} />
        {flagCount === 0
          ? "Healthy"
          : `${flagCount} issue${flagCount > 1 ? "s" : ""}`}
      </span>

      {showTooltip && (
        <div
          className="absolute left-1/2 top-full z-50 mt-1 w-64 -translate-x-1/2 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-2 shadow-lg"
          data-testid="health-tooltip"
        >
          {flagCount === 0 ? (
            <p className="text-caption text-[var(--color-text-secondary)]">
              No issues detected
            </p>
          ) : (
            <ul className="space-y-1">
              {healthStatus.activeFlags.map((flag, i) => {
                const FlagIcon = LEVEL_ICON[flag.severity];
                return (
                  <li
                    key={i}
                    className="flex items-start gap-1.5"
                    data-testid={`health-flag-${i}`}
                  >
                    <FlagIcon
                      size={12}
                      className={`mt-0.5 shrink-0 ${LEVEL_STYLES[flag.severity].split(" ")[1]}`}
                    />
                    <div>
                      <span className="text-caption font-medium text-[var(--color-text-primary)]">
                        {flag.name}
                      </span>
                      <p className="text-[10px] text-[var(--color-text-secondary)]">
                        {flag.description}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
