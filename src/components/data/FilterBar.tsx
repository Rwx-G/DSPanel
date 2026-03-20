import { useState, useEffect, useCallback } from "react";
import { X, Filter } from "lucide-react";

export interface FilterChip {
  id: string;
  label: string;
  value: string;
}

interface FilterBarProps {
  filters: FilterChip[];
  onFilterChange: (filters: FilterChip[]) => void;
  onTextFilter: (text: string) => void;
  placeholder?: string;
  debounceMs?: number;
}

export function FilterBar({
  filters,
  onFilterChange,
  onTextFilter,
  placeholder = "Filter...",
  debounceMs = 300,
}: FilterBarProps) {
  const [textValue, setTextValue] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => onTextFilter(textValue), debounceMs);
    return () => clearTimeout(timer);
  }, [textValue, debounceMs, onTextFilter]);

  const removeFilter = useCallback(
    (id: string) => {
      onFilterChange(filters.filter((f) => f.id !== id));
    },
    [filters, onFilterChange],
  );

  const clearAll = useCallback(() => {
    onFilterChange([]);
    setTextValue("");
    onTextFilter("");
  }, [onFilterChange, onTextFilter]);

  return (
    <div
      className="mb-2 flex items-center gap-2 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-2 py-1"
      data-testid="filter-bar"
    >
      <Filter
        size={14}
        className="shrink-0 text-[var(--color-text-secondary)]"
      />

      {filters.map((chip) => (
        <span
          key={chip.id}
          className="inline-flex items-center gap-1 rounded-md bg-[var(--color-primary-subtle)] px-2 py-0.5 text-caption text-[var(--color-primary)]"
          data-testid={`filter-chip-${chip.id}`}
        >
          <span className="font-medium">{chip.label}:</span> {chip.value}
          <button
            onClick={() => removeFilter(chip.id)}
            className="rounded-sm p-0.5 hover:bg-[var(--color-surface-hover)] transition-colors"
            aria-label={`Remove ${chip.label} filter`}
            data-testid={`filter-remove-${chip.id}`}
          >
            <X size={10} />
          </button>
        </span>
      ))}

      <input
        type="text"
        value={textValue}
        onChange={(e) => setTextValue(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="flex-1 min-w-[120px] bg-transparent text-body text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-secondary)]"
        data-testid="filter-text-input"
      />

      {(filters.length > 0 || textValue) && (
        <button
          onClick={clearAll}
          className="rounded-sm p-0.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          aria-label="Clear all filters"
          data-testid="filter-clear-all"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
