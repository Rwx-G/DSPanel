import { memo } from "react";

const DAY_NAMES = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

interface CalendarGridProps {
  viewYear: number;
  viewMonth: number;
  value: Date | null;
  today: Date;
  onSelectDay: (day: number) => void;
}

export const CalendarGrid = memo(function CalendarGrid({
  viewYear,
  viewMonth,
  value,
  today,
  onSelectDay,
}: CalendarGridProps) {
  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDay = getFirstDayOfWeek(viewYear, viewMonth);

  return (
    <>
      <div className="grid grid-cols-7 gap-0 mb-1">
        {DAY_NAMES.map((day) => (
          <div
            key={day}
            className="w-8 h-8 flex items-center justify-center text-caption text-[var(--color-text-secondary)] font-medium"
          >
            {day}
          </div>
        ))}
      </div>

      <div
        className="grid grid-cols-7 gap-0"
        data-testid="date-time-calendar"
      >
        {Array.from({ length: firstDay }, (_, i) => (
          <div key={`empty-${i}`} className="w-8 h-8" />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const date = new Date(viewYear, viewMonth, day);
          const isSelected = value ? isSameDay(date, value) : false;
          const isToday = isSameDay(date, today);

          return (
            <button
              key={day}
              onClick={() => onSelectDay(day)}
              className={`w-8 h-8 flex items-center justify-center rounded-md text-caption transition-colors ${
                isSelected
                  ? "bg-[var(--color-primary)] text-white font-medium"
                  : isToday
                    ? "border border-[var(--color-primary)] text-[var(--color-primary)]"
                    : "text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
              }`}
              data-testid={`date-day-${day}`}
            >
              {day}
            </button>
          );
        })}
      </div>
    </>
  );
});
