import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { ChevronDown } from "lucide-react";

export interface ComboBoxOption {
  value: string;
  label: string;
}

interface ComboBoxProps {
  options: ComboBoxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  error?: boolean;
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark className="bg-[var(--color-primary-subtle)] text-[var(--color-primary)] rounded-sm">
        {text.slice(index, index + query.length)}
      </mark>
      {text.slice(index + query.length)}
    </>
  );
}

export function ComboBox({
  options,
  value,
  onChange,
  placeholder = "Select...",
  disabled = false,
  error = false,
}: ComboBoxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredOptions = useMemo(
    () =>
      options.filter((opt) =>
        opt.label.toLowerCase().includes(searchText.toLowerCase()),
      ),
    [options, searchText],
  );

  const selectedOption = options.find((opt) => opt.value === value);

  const handleSelect = useCallback(
    (optValue: string) => {
      onChange(optValue);
      setIsOpen(false);
      setSearchText("");
      setHighlightIndex(-1);
    },
    [onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen) {
        if (e.key === "ArrowDown" || e.key === "Enter") {
          e.preventDefault();
          setIsOpen(true);
        }
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setHighlightIndex((prev) =>
            Math.min(prev + 1, filteredOptions.length - 1),
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setHighlightIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (highlightIndex >= 0 && highlightIndex < filteredOptions.length) {
            handleSelect(filteredOptions[highlightIndex].value);
          }
          break;
        case "Escape":
          e.preventDefault();
          setIsOpen(false);
          setSearchText("");
          setHighlightIndex(-1);
          break;
      }
    },
    [isOpen, highlightIndex, filteredOptions, handleSelect],
  );

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setSearchText("");
        setHighlightIndex(-1);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  return (
    <div
      ref={containerRef}
      className="relative"
      onKeyDown={handleKeyDown}
      data-testid="combobox"
    >
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`flex w-full items-center justify-between rounded-md border px-3 py-1.5 text-left text-body transition-colors ${
          error
            ? "border-[var(--color-error)]"
            : "border-[var(--color-border-default)]"
        } ${
          disabled
            ? "cursor-not-allowed opacity-50 bg-[var(--color-surface-bg)]"
            : "bg-[var(--color-surface-card)] hover:border-[var(--color-border-strong)]"
        }`}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        data-testid="combobox-trigger"
      >
        <span
          className={
            selectedOption
              ? "text-[var(--color-text-primary)]"
              : "text-[var(--color-text-secondary)]"
          }
        >
          {selectedOption?.label ?? placeholder}
        </span>
        <ChevronDown
          size={16}
          className={`shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {isOpen && (
        <div
          className="absolute z-20 mt-1 w-full rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] shadow-md"
          role="listbox"
          data-testid="combobox-dropdown"
        >
          <div className="border-b border-[var(--color-border-subtle)] p-1">
            <input
              ref={inputRef}
              type="text"
              value={searchText}
              onChange={(e) => {
                setSearchText(e.target.value);
                setHighlightIndex(-1);
              }}
              placeholder="Search..."
              className="w-full bg-transparent px-2 py-1 text-body text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-secondary)]"
              aria-label="Search options"
              data-testid="combobox-search"
            />
          </div>
          <div className="max-h-48 overflow-auto">
            {filteredOptions.length === 0 ? (
              <div
                className="px-3 py-2 text-caption text-[var(--color-text-secondary)]"
                data-testid="combobox-no-results"
              >
                No results
              </div>
            ) : (
              filteredOptions.map((opt, index) => (
                <div
                  key={opt.value}
                  onClick={() => handleSelect(opt.value)}
                  className={`cursor-pointer px-3 py-1.5 text-body transition-colors ${
                    index === highlightIndex
                      ? "bg-[var(--color-primary-subtle)] text-[var(--color-primary)]"
                      : opt.value === value
                        ? "bg-[var(--color-surface-hover)] text-[var(--color-text-primary)]"
                        : "text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
                  }`}
                  role="option"
                  aria-selected={opt.value === value}
                  data-testid={`combobox-option-${opt.value}`}
                >
                  <HighlightedText text={opt.label} query={searchText} />
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
