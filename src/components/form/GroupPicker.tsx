import { useState, useEffect, useCallback, useRef } from "react";
import { Search, X } from "lucide-react";
import { TagChip } from "@/components/common/TagChip";
import { LoadingSpinner } from "@/components/common/LoadingSpinner";

export interface GroupOption {
  distinguishedName: string;
  name: string;
  description?: string;
}

interface GroupPickerProps {
  selectedGroups: GroupOption[];
  onSelectionChange: (groups: GroupOption[]) => void;
  onSearch: (query: string) => Promise<GroupOption[]> | GroupOption[];
  placeholder?: string;
  disabled?: boolean;
  debounceMs?: number;
}

export function GroupPicker({
  selectedGroups,
  onSelectionChange,
  onSearch,
  placeholder = "Search groups...",
  disabled = false,
  debounceMs = 300,
}: GroupPickerProps) {
  const [searchText, setSearchText] = useState("");
  const [results, setResults] = useState<GroupOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedDNs = new Set(selectedGroups.map((g) => g.distinguishedName));

  // Debounced search
  useEffect(() => {
    if (!searchText.trim()) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const searchResults = await onSearch(searchText);
        setResults(
          searchResults.filter((g) => !selectedDNs.has(g.distinguishedName)),
        );
        setIsOpen(true);
      } finally {
        setLoading(false);
      }
    }, debounceMs);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText, debounceMs]);

  const handleAddGroup = useCallback(
    (group: GroupOption) => {
      onSelectionChange([...selectedGroups, group]);
      setSearchText("");
      setResults([]);
      setIsOpen(false);
      setHighlightIndex(-1);
      inputRef.current?.focus();
    },
    [selectedGroups, onSelectionChange],
  );

  const handleRemoveGroup = useCallback(
    (dn: string) => {
      onSelectionChange(
        selectedGroups.filter((g) => g.distinguishedName !== dn),
      );
    },
    [selectedGroups, onSelectionChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen || results.length === 0) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setHighlightIndex((prev) => Math.min(prev + 1, results.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setHighlightIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (highlightIndex >= 0 && highlightIndex < results.length) {
            handleAddGroup(results[highlightIndex]);
          }
          break;
        case "Escape":
          e.preventDefault();
          setIsOpen(false);
          setHighlightIndex(-1);
          break;
      }
    },
    [isOpen, results, highlightIndex, handleAddGroup],
  );

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setHighlightIndex(-1);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div
      ref={containerRef}
      className={`relative ${disabled ? "pointer-events-none opacity-50" : ""}`}
      data-testid="group-picker"
    >
      {/* Selected groups as tags */}
      {selectedGroups.length > 0 && (
        <div
          className="mb-2 flex flex-wrap gap-1"
          data-testid="group-picker-selected"
        >
          {selectedGroups.map((group) => (
            <TagChip
              key={group.distinguishedName}
              text={group.name}
              onRemove={() => handleRemoveGroup(group.distinguishedName)}
            />
          ))}
        </div>
      )}

      {/* Search input */}
      <div
        className="flex items-center gap-2 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] px-3 py-1.5"
        onKeyDown={handleKeyDown}
      >
        <Search
          size={16}
          className="shrink-0 text-[var(--color-text-secondary)]"
        />
        <input
          ref={inputRef}
          type="text"
          value={searchText}
          onChange={(e) => {
            setSearchText(e.target.value);
            setHighlightIndex(-1);
          }}
          placeholder={placeholder}
          disabled={disabled}
          className="flex-1 bg-transparent text-body text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-secondary)]"
          data-testid="group-picker-search"
        />
        {loading && (
          <LoadingSpinner size="small" data-testid="group-picker-loading" />
        )}
        {searchText && !loading && (
          <button
            onClick={() => {
              setSearchText("");
              setResults([]);
              setIsOpen(false);
            }}
            className="rounded-sm p-0.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            aria-label="Clear search"
            data-testid="group-picker-clear"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Dropdown results */}
      {isOpen && results.length > 0 && (
        <div
          className="absolute z-20 mt-1 w-full rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] shadow-md max-h-48 overflow-auto"
          role="listbox"
          data-testid="group-picker-dropdown"
        >
          {results.map((group, index) => (
            <div
              key={group.distinguishedName}
              onClick={() => handleAddGroup(group)}
              className={`cursor-pointer px-3 py-1.5 transition-colors ${
                index === highlightIndex
                  ? "bg-[var(--color-primary-subtle)] text-[var(--color-primary)]"
                  : "text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
              }`}
              role="option"
              aria-selected={false}
              data-testid={`group-option-${group.name}`}
            >
              <div className="text-body">{group.name}</div>
              {group.description && (
                <div className="text-caption text-[var(--color-text-secondary)] truncate">
                  {group.description}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {isOpen && !loading && results.length === 0 && searchText.trim() && (
        <div
          className="absolute z-20 mt-1 w-full rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] shadow-md px-3 py-2 text-caption text-[var(--color-text-secondary)]"
          data-testid="group-picker-no-results"
        >
          No groups found
        </div>
      )}
    </div>
  );
}
