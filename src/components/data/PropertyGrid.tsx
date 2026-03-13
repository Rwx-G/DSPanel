import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { CopyButton } from "@/components/common/CopyButton";

export interface PropertyItem {
  label: string;
  value: string;
}

export interface PropertyGroup {
  category: string;
  items: PropertyItem[];
}

interface PropertyGridProps {
  groups: PropertyGroup[];
}

export function PropertyGrid({ groups }: PropertyGridProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleGroup = (category: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  if (groups.length === 0) {
    return (
      <div
        className="py-4 text-center text-caption text-[var(--color-text-secondary)]"
        data-testid="property-grid-empty"
      >
        No properties to display
      </div>
    );
  }

  return (
    <div className="space-y-1" data-testid="property-grid">
      {groups.map((group) => {
        const isCollapsed = collapsed.has(group.category);
        return (
          <div
            key={group.category}
            data-testid={`property-group-${group.category}`}
          >
            <button
              className="flex w-full items-center gap-1 px-2 py-1.5 text-left text-caption font-medium text-[var(--color-text-secondary)] uppercase tracking-wider hover:text-[var(--color-text-primary)] transition-colors"
              onClick={() => toggleGroup(group.category)}
              aria-expanded={!isCollapsed}
              aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${group.category}`}
              data-testid={`property-group-toggle-${group.category}`}
            >
              {isCollapsed ? (
                <ChevronRight size={14} />
              ) : (
                <ChevronDown size={14} />
              )}
              {group.category}
            </button>
            {!isCollapsed && (
              <div className="border-l-2 border-[var(--color-border-subtle)] ml-2">
                {group.items.map((item) => (
                  <div
                    key={item.label}
                    className="group flex items-center gap-2 px-3 py-1 hover:bg-[var(--color-surface-hover)] transition-colors"
                    data-testid={`property-item-${item.label}`}
                  >
                    <span className="min-w-[140px] shrink-0 text-caption text-[var(--color-text-secondary)]">
                      {item.label}
                    </span>
                    <span className="flex-1 text-body text-[var(--color-text-primary)] break-all">
                      {item.value}
                    </span>
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity">
                      <CopyButton text={item.value} />
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
