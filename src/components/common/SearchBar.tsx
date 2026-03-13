import { useEffect, useCallback } from "react";
import { Search, X } from "lucide-react";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onSearch: (query: string) => void;
  placeholder?: string;
  debounceMs?: number;
}

export function SearchBar({
  value,
  onChange,
  onSearch,
  placeholder = "Search...",
  debounceMs = 300,
}: SearchBarProps) {
  useEffect(() => {
    const timer = setTimeout(() => onSearch(value), debounceMs);
    return () => clearTimeout(timer);
  }, [value, debounceMs, onSearch]);

  const handleClear = useCallback(() => {
    onChange("");
    onSearch("");
  }, [onChange, onSearch]);

  return (
    <div
      className="flex items-center gap-2 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-1.5"
      data-testid="search-bar"
    >
      <Search
        size={16}
        className="shrink-0 text-[var(--color-text-secondary)]"
        aria-hidden="true"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="flex-1 bg-transparent text-body text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-secondary)]"
        data-testid="search-input"
      />
      {value && (
        <button
          onClick={handleClear}
          className="rounded-sm p-0.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          aria-label="Clear search"
          data-testid="search-clear"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
