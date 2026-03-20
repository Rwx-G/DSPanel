import { useState, useMemo, useCallback } from "react";
import { Star, ChevronDown, ChevronRight, Filter, X, Pencil, Check } from "lucide-react";
import { CopyButton } from "@/components/common/CopyButton";

const STORAGE_KEY = "dspanel-favorite-attributes";

/** Attributes already shown in the curated PropertyGrid sections. */
const DISPLAYED_ATTRS = new Set([
  "displayName",
  "sAMAccountName",
  "userPrincipalName",
  "givenName",
  "sn",
  "mail",
  "department",
  "title",
  "userAccountControl",
  "lockoutTime",
  "accountExpires",
  "pwdLastSet",
  "lastLogon",
  "lastLogonWorkstation",
  "badPwdCount",
  "whenCreated",
  "whenChanged",
  "memberOf",
  "objectClass",
  "distinguishedName",
]);

function loadFavorites(): Set<string> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return new Set(JSON.parse(stored));
  } catch {
    // ignore
  }
  return new Set();
}

function saveFavorites(favs: Set<string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...favs]));
}

interface AdvancedAttributesProps {
  rawAttributes: Record<string, string[]>;
  /** All attribute names from the AD schema, used to populate empty attributes. */
  schemaAttributes?: string[];
  /** Called when an attribute value is edited. Receives (attributeName, oldValue, newValue). */
  onEdit?: (attributeName: string, oldValue: string, newValue: string) => void;
}

function EditableValue({
  attrKey,
  displayValue,
  onEdit,
}: {
  attrKey: string;
  displayValue: string;
  onEdit: (attributeName: string, oldValue: string, newValue: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(displayValue);

  const handleConfirm = useCallback(() => {
    if (draft !== displayValue) {
      onEdit(attrKey, displayValue, draft);
    }
    setEditing(false);
  }, [draft, displayValue, attrKey, onEdit]);

  const handleCancel = useCallback(() => {
    setDraft(displayValue);
    setEditing(false);
  }, [displayValue]);

  if (editing) {
    return (
      <div className="flex flex-1 items-center gap-1">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleConfirm();
            if (e.key === "Escape") handleCancel();
          }}
          autoFocus
          className="flex-1 rounded border border-[var(--color-primary)] bg-[var(--color-input-bg)] px-2 py-0.5 text-body font-mono text-[var(--color-text-primary)] outline-none"
          data-testid={`adv-edit-input-${attrKey}`}
        />
        <button
          onClick={handleConfirm}
          className="rounded p-0.5 text-[var(--color-success)] hover:bg-[var(--color-success-subtle)]"
          aria-label="Confirm edit"
          data-testid={`adv-edit-confirm-${attrKey}`}
        >
          <Check size={14} />
        </button>
        <button
          onClick={handleCancel}
          className="rounded p-0.5 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
          aria-label="Cancel edit"
          data-testid={`adv-edit-cancel-${attrKey}`}
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <>
      <span className="flex-1 text-body text-[var(--color-text-primary)] break-all font-mono">
        {displayValue || (
          <span className="text-[var(--color-text-disabled)]">(empty)</span>
        )}
      </span>
      <button
        onClick={() => {
          setDraft(displayValue);
          setEditing(true);
        }}
        className="shrink-0 rounded p-0.5 text-[var(--color-text-disabled)] opacity-0 group-hover:opacity-100 hover:text-[var(--color-primary)] transition-all"
        aria-label={`Edit ${attrKey}`}
        data-testid={`adv-edit-btn-${attrKey}`}
      >
        <Pencil size={12} />
      </button>
    </>
  );
}

export function AdvancedAttributes({ rawAttributes, schemaAttributes, onEdit }: AdvancedAttributesProps) {
  const [favorites, setFavorites] = useState<Set<string>>(loadFavorites);
  const [collapsed, setCollapsed] = useState(false);
  const [searchText, setSearchText] = useState("");

  const toggleFavorite = useCallback((attr: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(attr)) {
        next.delete(attr);
      } else {
        next.add(attr);
      }
      saveFavorites(next);
      return next;
    });
  }, []);

  const [showEmpty, setShowEmpty] = useState(false);

  // Filter out already-displayed attributes, split into favorites and rest.
  // When showEmpty is on, merge in schema attributes that have no value.
  const allAdvanced = useMemo(() => {
    const populated = Object.entries(rawAttributes)
      .filter(([key]) => !DISPLAYED_ATTRS.has(key));

    if (!showEmpty) {
      return populated
        .filter(([, values]) => values.some((v) => v !== ""))
        .sort(([a], [b]) => a.localeCompare(b));
    }

    // Merge schema attributes as empty entries
    const result = new Map<string, string[]>();
    if (schemaAttributes) {
      for (const attr of schemaAttributes) {
        if (!DISPLAYED_ATTRS.has(attr)) {
          result.set(attr, []);
        }
      }
    }
    for (const [key, values] of populated) {
      result.set(key, values);
    }
    return Array.from(result.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [rawAttributes, showEmpty, schemaAttributes]);

  const { favoriteAttrs, otherAttrs } = useMemo(() => {
    const lower = searchText.toLowerCase();
    const filtered = lower
      ? allAdvanced.filter(
          ([key, values]) =>
            key.toLowerCase().includes(lower) ||
            values.some((v) => v.toLowerCase().includes(lower)),
        )
      : allAdvanced;

    const fav: [string, string[]][] = [];
    const other: [string, string[]][] = [];

    for (const entry of filtered) {
      if (favorites.has(entry[0])) {
        fav.push(entry);
      } else {
        other.push(entry);
      }
    }

    return { favoriteAttrs: fav, otherAttrs: other };
  }, [allAdvanced, favorites, searchText]);

  const totalCount = allAdvanced.length;
  const filteredCount = favoriteAttrs.length + otherAttrs.length;

  const renderRow = (key: string, values: string[], isFav: boolean) => {
    const displayValue = values.length === 1 ? values[0] : values.join(" ; ");
    return (
      <div
        key={key}
        className={`group flex items-center gap-2 px-3 py-1 transition-colors hover:bg-[var(--color-surface-hover)] ${
          isFav ? "bg-[var(--color-warning-bg)]" : ""
        }`}
        data-testid={`advanced-attr-${key}`}
      >
        <button
          className={`shrink-0 transition-colors ${
            isFav
              ? "text-[var(--color-warning)]"
              : "text-[var(--color-text-disabled)] opacity-0 group-hover:opacity-100"
          }`}
          onClick={() => toggleFavorite(key)}
          aria-label={
            isFav ? `Remove ${key} from favorites` : `Add ${key} to favorites`
          }
          data-testid={`favorite-toggle-${key}`}
        >
          <Star size={12} fill={isFav ? "currentColor" : "none"} />
        </button>
        <span className="min-w-[180px] shrink-0 text-caption text-[var(--color-text-secondary)] font-mono">
          {key}
        </span>
        {onEdit ? (
          <EditableValue attrKey={key} displayValue={displayValue} onEdit={onEdit} />
        ) : (
          <span className="flex-1 text-body text-[var(--color-text-primary)] break-all font-mono">
            {displayValue || (
              <span className="text-[var(--color-text-disabled)]">(empty)</span>
            )}
          </span>
        )}
        <span className="opacity-0 group-hover:opacity-100 transition-opacity">
          <CopyButton text={displayValue} />
        </span>
      </div>
    );
  };

  return (
    <div data-testid="advanced-attributes">
      <button
        className="flex w-full items-center gap-1 mb-2 text-left"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        <h3 className="text-body font-semibold text-[var(--color-text-primary)]">
          Advanced Attributes ({totalCount})
        </h3>
      </button>

      {!collapsed && totalCount === 0 && (
        <p className="py-3 text-center text-caption text-[var(--color-text-secondary)]">
          No advanced attributes available
        </p>
      )}

      {!collapsed && totalCount > 0 && (
        <>
          <div className="mb-2 flex items-center gap-2 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-2 py-1">
            <Filter
              size={14}
              className="shrink-0 text-[var(--color-text-secondary)]"
            />
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Filter attributes..."
              className="flex-1 bg-transparent text-body text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-secondary)]"
              data-testid="advanced-attributes-search"
            />
            {searchText && (
              <button
                onClick={() => setSearchText("")}
                className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                aria-label="Clear filter"
              >
                <X size={14} />
              </button>
            )}
            <label className="flex shrink-0 items-center gap-1.5 text-caption text-[var(--color-text-secondary)] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showEmpty}
                onChange={(e) => setShowEmpty(e.target.checked)}
                className="accent-[var(--color-primary)]"
                data-testid="show-empty-toggle"
              />
              Show empty
            </label>
          </div>

          {filteredCount === 0 && (
            <p className="py-3 text-center text-caption text-[var(--color-text-secondary)]">
              No attributes match "{searchText}"
            </p>
          )}

          {filteredCount > 0 && (
            <div className="rounded-lg border border-[var(--color-border-default)] overflow-hidden">
              {favoriteAttrs.length > 0 && (
                <>
                  <div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--color-warning)] bg-[var(--color-surface-card)]">
                    Favorites
                  </div>
                  {favoriteAttrs.map(([key, values]) =>
                    renderRow(key, values, true),
                  )}
                </>
              )}
              {otherAttrs.length > 0 && (
                <>
                  {favoriteAttrs.length > 0 && (
                    <div className="border-t border-[var(--color-border-default)]" />
                  )}
                  <div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-secondary)] bg-[var(--color-surface-card)]">
                    All Attributes
                  </div>
                  {otherAttrs.map(([key, values]) =>
                    renderRow(key, values, false),
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
