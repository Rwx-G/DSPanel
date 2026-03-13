import { ChevronRight } from "lucide-react";
import { useNavigation } from "@/contexts/NavigationContext";

export function Breadcrumbs() {
  const { breadcrumbs, navigateTo } = useNavigation();

  return (
    <div
      className="flex h-7 items-center gap-1 px-3 text-caption text-[var(--color-text-secondary)] bg-[var(--color-surface-bg)]"
      data-testid="breadcrumbs"
    >
      {breadcrumbs.map((segment, index) => (
        <span
          key={segment.navigationTarget}
          className="flex items-center gap-1"
        >
          {index > 0 && <ChevronRight size={12} />}
          <button
            className={`hover:text-[var(--color-text-primary)] transition-colors ${
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
    </div>
  );
}
