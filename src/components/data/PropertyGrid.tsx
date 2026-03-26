import { useState, useCallback } from "react";
import { ChevronDown, ChevronRight, Pencil, Check, X } from "lucide-react";
import { AlertTriangle, AlertCircle, CheckCircle } from "lucide-react";
import { CopyButton } from "@/components/common/CopyButton";
import { useTranslation } from "react-i18next";

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
  /** Whether this field can be edited inline (requires onEdit). */
  editable?: boolean;
  /** The LDAP attribute name used when calling onEdit. */
  attributeName?: string;
}

export interface PropertyGroup {
  category: string;
  items: PropertyItem[];
}

interface PropertyGridProps {
  groups: PropertyGroup[];
  /** Called when an editable field is changed. Receives (attributeName, oldValue, newValue). */
  onEdit?: (attributeName: string, oldValue: string, newValue: string) => void;
}

function EditableCell({
  item,
  onEdit,
}: {
  item: PropertyItem;
  onEdit: (attributeName: string, oldValue: string, newValue: string) => void;
}) {
  const { t } = useTranslation(["components"]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.value);

  const handleConfirm = useCallback(() => {
    if (draft !== item.value && item.attributeName) {
      onEdit(item.attributeName, item.value, draft);
    }
    setEditing(false);
  }, [draft, item, onEdit]);

  const handleCancel = useCallback(() => {
    setDraft(item.value);
    setEditing(false);
  }, [item.value]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleConfirm();
      if (e.key === "Escape") handleCancel();
    },
    [handleConfirm, handleCancel],
  );

  if (editing) {
    return (
      <div className="flex flex-1 items-center gap-1">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
          className="flex-1 rounded border border-[var(--color-primary)] bg-[var(--color-surface-card)] px-2 py-0.5 text-body text-[var(--color-text-primary)] outline-none"
          data-testid={`edit-input-${item.attributeName}`}
        />
        <button
          onClick={handleConfirm}
          className="rounded p-0.5 text-[var(--color-success)] hover:bg-[var(--color-success-bg)]"
          aria-label={t("components:propertyGrid.confirmEdit")}
          data-testid={`edit-confirm-${item.attributeName}`}
        >
          <Check size={14} />
        </button>
        <button
          onClick={handleCancel}
          className="rounded p-0.5 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
          aria-label={t("components:propertyGrid.cancelEdit")}
          data-testid={`edit-cancel-${item.attributeName}`}
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <>
      <span className="flex-1 text-body break-all text-[var(--color-text-primary)]">
        {item.value}
      </span>
      <button
        onClick={() => {
          setDraft(item.value);
          setEditing(true);
        }}
        className="shrink-0 rounded p-0.5 text-[var(--color-text-disabled)] opacity-0 group-hover:opacity-100 hover:text-[var(--color-primary)] transition-all"
        aria-label={`Edit ${item.label}`}
        data-testid={`edit-btn-${item.attributeName}`}
      >
        <Pencil size={12} />
      </button>
    </>
  );
}

export function PropertyGrid({ groups, onEdit }: PropertyGridProps) {
  const { t } = useTranslation(["components"]);
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
        {t("components:propertyGrid.noProperties")}
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

                  const isEditable = item.editable && item.attributeName && onEdit;

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
                      {isEditable ? (
                        <EditableCell item={item} onEdit={onEdit} />
                      ) : (
                        <>
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
                        </>
                      )}
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
