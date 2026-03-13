import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

interface InfoCardProps {
  header: string;
  icon?: ReactNode;
  collapsible?: boolean;
  defaultExpanded?: boolean;
  children: ReactNode;
}

export function InfoCard({
  header,
  icon,
  collapsible = true,
  defaultExpanded = true,
  children,
}: InfoCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div
      className="overflow-hidden rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-card)]"
      data-testid="info-card"
    >
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-body font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors"
        onClick={() => collapsible && setExpanded(!expanded)}
        aria-expanded={expanded}
        data-testid="info-card-header"
      >
        {collapsible &&
          (expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />)}
        {icon && (
          <span className="text-[var(--color-text-secondary)]">{icon}</span>
        )}
        <span>{header}</span>
      </button>
      {expanded && (
        <div
          className="border-t border-[var(--color-border-subtle)] px-3 py-2"
          data-testid="info-card-content"
        >
          {children}
        </div>
      )}
    </div>
  );
}
