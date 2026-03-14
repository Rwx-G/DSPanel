import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { AlertTriangle, AlertCircle, CheckCircle } from "lucide-react";
import { CopyButton } from "@/components/common/CopyButton";

export type PropertySeverity = "Warning" | "Critical" | "Success" | "Error";

const SEVERITY_ROW_STYLE: Record<PropertySeverity, string> = {
  Warning: "bg-[var(--color-warning-bg)]",
  Critical: "bg-[var(--color-error-bg)]",
  Success: "bg-[var(--color-success-bg)]",
  Error: "bg-[var(--color-error-bg)]",
};

const SEVERITY_VALUE_STYLE: Record<PropertySeverity, string> = {
  Warning: "text-[var(--color-warning)] font-medium",
  Critical: "text-[var(--color-error)] font-medium",
  Success: "text-[var(--color-success)] font-medium",
  Error: "text-[var(--color-error)] font-medium",
};

export interface PropertyItem {
  label: string;
  value: string;
  severity?: PropertySeverity;
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
    <div className="space-y-2" data-testid="property-grid">
      {groups.map((group) => {
        const isCollapsed = collapsed.has(group.category);
        return (
          <div
            key={group.category}
            className="rounded-lg border border-[var(--color-border-default)] overflow-hidden"
            data-testid={`property-group-${group.category}`}
          >
            <button
              className="flex w-full items-center gap-1 px-3 py-2 text-left text-caption font-medium text-[var(--color-text-secondary)] uppercase tracking-wider bg-[var(--color-surface-card)] hover:text-[var(--color-text-primary)] transition-colors"
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
              <div>
                {group.items.map((item, idx) => {
                  const SeverityIcon =
                    item.severity === "Critical" || item.severity === "Error"
                      ? AlertCircle
                      : item.severity === "Warning"
                        ? AlertTriangle
                        : item.severity === "Success"
                          ? CheckCircle
                          : null;
                  return (
                    <div
                      key={item.label}
                      className={`group flex items-center gap-2 px-3 py-1 transition-colors ${
                        idx > 0
                          ? "border-t border-[var(--color-border-subtle)]"
                          : ""
                      } ${item.severity ? SEVERITY_ROW_STYLE[item.severity] : "hover:bg-[var(--color-surface-hover)]"}`}
                      data-testid={`property-item-${item.label}`}
                      data-severity={item.severity ?? undefined}
                    >
                      <span className="min-w-[140px] shrink-0 text-caption text-[var(--color-text-secondary)]">
                        {item.label}
                      </span>
                      <span
                        className={`flex-1 text-body break-all ${
                          item.severity
                            ? SEVERITY_VALUE_STYLE[item.severity]
                            : "text-[var(--color-text-primary)]"
                        }`}
                      >
                        {SeverityIcon && (
                          <SeverityIcon
                            size={12}
                            className="inline mr-1 -mt-0.5"
                          />
                        )}
                        {item.value}
                      </span>
                      <span className="opacity-0 group-hover:opacity-100 transition-opacity">
                        <CopyButton text={item.value} />
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
