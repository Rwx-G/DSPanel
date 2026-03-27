import { useEffect, useCallback, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";

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
  placeholder,
  debounceMs = 300,
}: SearchBarProps) {
  const { t } = useTranslation(["components"]);
  const resolvedPlaceholder = placeholder ?? t("components:searchBar.placeholder");
  // Stabilize callbacks via refs so the debounce effect only fires
  // when `value` changes, not when the parent re-renders with a new
  // callback reference.
  const onSearchRef = useRef(onSearch);
  onSearchRef.current = onSearch;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const timer = setTimeout(() => onSearchRef.current(value), debounceMs);
    return () => clearTimeout(timer);
  }, [value, debounceMs]);

  const handleClear = useCallback(() => {
    onChangeRef.current("");
    onSearchRef.current("");
  }, []);

  // Focus input on Ctrl+F (via AppShell custom event)
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const handler = () => inputRef.current?.focus();
    window.addEventListener("dspanel:search", handler);
    return () => window.removeEventListener("dspanel:search", handler);
  }, []);

  // Show shortcut hint in placeholder when not focused
  const [focused, setFocused] = useState(false);
  const displayPlaceholder = focused ? resolvedPlaceholder : `${resolvedPlaceholder} (Ctrl+F)`;

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
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={displayPlaceholder}
        aria-label={resolvedPlaceholder}
        className="flex-1 bg-transparent text-body text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-secondary)]"
        data-testid="search-input"
      />
      {value && (
        <button
          onClick={handleClear}
          className="rounded-sm p-0.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          aria-label={t("components:searchBar.clearSearch")}
          data-testid="search-clear"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
