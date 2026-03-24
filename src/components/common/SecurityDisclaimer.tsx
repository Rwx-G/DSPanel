import { useState } from "react";
import { Info, AlertTriangle } from "lucide-react";

interface SecurityDisclaimerProps {
  /** Estimated coverage compared to specialized tools (e.g., "~30%"). */
  coverage: string;
  /** What this module checks. */
  checks: string;
  /** What specialized tools do better. */
  limitations: string;
  /** Recommended specialized tools for deeper analysis. */
  tools: string;
}

export function SecurityDisclaimer({
  coverage,
  checks,
  limitations,
  tools,
}: SecurityDisclaimerProps) {
  const [show, setShow] = useState(false);

  return (
    <div className="relative inline-flex">
      <button
        className="flex h-5 w-5 items-center justify-center rounded-full text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
        onClick={() => setShow(!show)}
        onBlur={() => setTimeout(() => setShow(false), 200)}
        aria-label="About this module"
        data-testid="security-disclaimer-btn"
      >
        <Info size={13} />
      </button>
      {show && (
        <div className="absolute left-0 top-full z-50 mt-1 w-96 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)] p-3 shadow-lg">
          <div className="flex items-start gap-2 mb-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-[var(--color-warning)]" />
            <p className="text-caption font-medium text-[var(--color-text-primary)]">
              Indicative analysis - estimated {coverage} coverage
            </p>
          </div>
          <div className="space-y-1.5 text-caption text-[var(--color-text-secondary)]">
            <p><strong>What we check:</strong> {checks}</p>
            <p><strong>Limitations:</strong> {limitations}</p>
            <p><strong>For a complete audit:</strong> {tools}</p>
          </div>
        </div>
      )}
    </div>
  );
}
