import { ChevronRight } from "lucide-react";
import { useNavigation } from "@/contexts/NavigationContext";

export function Breadcrumbs() {
  const { breadcrumbs, navigateTo } = useNavigation();

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex h-8 items-center gap-1 border-b border-[var(--color-border-subtle)] px-4 text-caption text-[var(--color-text-secondary)] bg-[var(--color-surface-bg)]"
      data-testid="breadcrumbs"
    >
      {breadcrumbs.map((segment, index) => (
        <span
          key={segment.navigationTarget}
          className="flex items-center gap-1"
        >
          {index > 0 && (
            <ChevronRight
              size={12}
              className="text-[var(--color-text-disabled)]"
            />
          )}
          <button
            className={`rounded-sm px-1 py-0.5 transition-colors duration-150 hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] ${
              index === breadcrumbs.length - 1
                ? "text-[var(--color-text-primary)] font-medium"
                : ""
            }`}
            onClick={() => navigateTo(segment.navigationTarget, segment.label)}
            data-testid={`breadcrumb-${segment.navigationTarget}`}
          >
            {segment.label}
          </button>
        </span>
      ))}
    </nav>
  );
}
