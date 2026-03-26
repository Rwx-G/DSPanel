import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Calendar, ChevronLeft, ChevronRight, Clock, X } from "lucide-react";
import { CalendarGrid } from "@/components/form/CalendarGrid";
import { useTranslation } from "react-i18next";

interface DateTimePickerProps {
  value: Date | null;
  onChange: (date: Date | null) => void;
  includeTime?: boolean;
  disabled?: boolean;
  placeholder?: string;
  error?: boolean;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function formatDate(date: Date, includeTime: boolean): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  if (!includeTime) return `${year}-${month}-${day}`;
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

export function DateTimePicker({
  value,
  onChange,
  includeTime = false,
  disabled = false,
  placeholder,
  error = false,
}: DateTimePickerProps) {
  const { t } = useTranslation(["components"]);
  const [isOpen, setIsOpen] = useState(false);
  const [viewYear, setViewYear] = useState(
    () => value?.getFullYear() ?? new Date().getFullYear(),
  );
  const [viewMonth, setViewMonth] = useState(
    () => value?.getMonth() ?? new Date().getMonth(),
  );
  const containerRef = useRef<HTMLDivElement>(null);

  const today = useMemo(() => new Date(), []);

  const handlePrevMonth = useCallback(() => {
    setViewMonth((prev) => {
      if (prev === 0) {
        setViewYear((y) => y - 1);
        return 11;
      }
      return prev - 1;
    });
  }, []);

  const handleNextMonth = useCallback(() => {
    setViewMonth((prev) => {
      if (prev === 11) {
        setViewYear((y) => y + 1);
        return 0;
      }
      return prev + 1;
    });
  }, []);

  const handleSelectDay = useCallback(
    (day: number) => {
      const hours = value?.getHours() ?? 0;
      const minutes = value?.getMinutes() ?? 0;
      const newDate = new Date(viewYear, viewMonth, day, hours, minutes);
      onChange(newDate);
      if (!includeTime) {
        setIsOpen(false);
      }
    },
    [viewYear, viewMonth, value, onChange, includeTime],
  );

  const handleTimeChange = useCallback(
    (type: "hours" | "minutes", delta: number) => {
      if (!value) return;
      const newDate = new Date(value);
      if (type === "hours") {
        newDate.setHours((newDate.getHours() + delta + 24) % 24);
      } else {
        newDate.setMinutes((newDate.getMinutes() + delta + 60) % 60);
      }
      onChange(newDate);
    },
    [value, onChange],
  );

  const handleClear = useCallback(() => {
    onChange(null);
    setIsOpen(false);
  }, [onChange]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Sync view to value when popup opens
  useEffect(() => {
    if (isOpen && value) {
      setViewYear(value.getFullYear());
      setViewMonth(value.getMonth());
    }
  }, [isOpen, value]);

  return (
    <div ref={containerRef} className="relative" data-testid="date-time-picker">
      {/* Trigger button */}
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
        data-testid="date-time-trigger"
      >
        <span
          className={
            value
              ? "text-[var(--color-text-primary)]"
              : "text-[var(--color-text-secondary)]"
          }
        >
          {value ? formatDate(value, includeTime) : (placeholder ?? t("components:dateTimePicker.placeholder"))}
        </span>
        <div className="flex items-center gap-1">
          {value && !disabled && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                handleClear();
              }}
              className="rounded-sm p-0.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors cursor-pointer"
              data-testid="date-time-clear"
            >
              <X size={14} />
            </span>
          )}
          <Calendar
            size={16}
            className="shrink-0 text-[var(--color-text-secondary)]"
          />
        </div>
      </button>

      {/* Calendar popup */}
      {isOpen && (
        <div
          className="absolute z-20 mt-1 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-card)] shadow-md p-3"
          data-testid="date-time-popup"
        >
          {/* Month/year navigation */}
          <div className="flex items-center justify-between mb-2">
            <button
              onClick={handlePrevMonth}
              className="rounded-sm p-1 hover:bg-[var(--color-surface-hover)] transition-colors"
              aria-label={t("components:dateTimePicker.previousMonth")}
              data-testid="date-time-prev-month"
            >
              <ChevronLeft size={16} />
            </button>
            <span
              className="text-body font-medium text-[var(--color-text-primary)]"
              data-testid="date-time-month-year"
            >
              {MONTH_NAMES[viewMonth]} {viewYear}
            </span>
            <button
              onClick={handleNextMonth}
              className="rounded-sm p-1 hover:bg-[var(--color-surface-hover)] transition-colors"
              aria-label={t("components:dateTimePicker.nextMonth")}
              data-testid="date-time-next-month"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <CalendarGrid
            viewYear={viewYear}
            viewMonth={viewMonth}
            value={value}
            today={today}
            onSelectDay={handleSelectDay}
          />

          {/* Time picker */}
          {includeTime && value && (
            <div
              className="mt-3 flex items-center justify-center gap-2 border-t border-[var(--color-border-subtle)] pt-3"
              data-testid="date-time-time"
            >
              <Clock size={14} className="text-[var(--color-text-secondary)]" />
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleTimeChange("hours", -1)}
                  className="rounded-sm px-1 py-0.5 text-caption hover:bg-[var(--color-surface-hover)] transition-colors"
                  aria-label={t("components:dateTimePicker.decreaseHours")}
                  data-testid="time-hours-down"
                >
                  -
                </button>
                <span
                  className="w-8 text-center text-body font-mono text-[var(--color-text-primary)]"
                  data-testid="time-hours"
                >
                  {String(value.getHours()).padStart(2, "0")}
                </span>
                <button
                  onClick={() => handleTimeChange("hours", 1)}
                  className="rounded-sm px-1 py-0.5 text-caption hover:bg-[var(--color-surface-hover)] transition-colors"
                  aria-label={t("components:dateTimePicker.increaseHours")}
                  data-testid="time-hours-up"
                >
                  +
                </button>
              </div>
              <span className="text-body text-[var(--color-text-secondary)]">
                :
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleTimeChange("minutes", -1)}
                  className="rounded-sm px-1 py-0.5 text-caption hover:bg-[var(--color-surface-hover)] transition-colors"
                  aria-label={t("components:dateTimePicker.decreaseMinutes")}
                  data-testid="time-minutes-down"
                >
                  -
                </button>
                <span
                  className="w-8 text-center text-body font-mono text-[var(--color-text-primary)]"
                  data-testid="time-minutes"
                >
                  {String(value.getMinutes()).padStart(2, "0")}
                </span>
                <button
                  onClick={() => handleTimeChange("minutes", 1)}
                  className="rounded-sm px-1 py-0.5 text-caption hover:bg-[var(--color-surface-hover)] transition-colors"
                  aria-label={t("components:dateTimePicker.increaseMinutes")}
                  data-testid="time-minutes-up"
                >
                  +
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
