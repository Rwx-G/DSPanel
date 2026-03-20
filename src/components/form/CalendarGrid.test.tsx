import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CalendarGrid } from "./CalendarGrid";

function renderGrid(
  props: Partial<Parameters<typeof CalendarGrid>[0]> = {},
) {
  const defaultProps = {
    viewYear: 2025,
    viewMonth: 0, // January 2025
    value: null,
    today: new Date(2025, 0, 15),
    onSelectDay: vi.fn(),
    ...props,
  };
  render(<CalendarGrid {...defaultProps} />);
  return defaultProps;
}

describe("CalendarGrid", () => {
  it("renders 7 day name headers", () => {
    renderGrid();
    const headers = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
    for (const day of headers) {
      expect(screen.getByText(day)).toBeInTheDocument();
    }
  });

  it("renders correct number of day buttons for January 2025 (31 days)", () => {
    renderGrid({ viewYear: 2025, viewMonth: 0 });
    expect(screen.getByTestId("date-day-1")).toBeInTheDocument();
    expect(screen.getByTestId("date-day-31")).toBeInTheDocument();
    expect(screen.queryByTestId("date-day-32")).not.toBeInTheDocument();
  });

  it("renders correct number of day buttons for April 2025 (30 days)", () => {
    renderGrid({ viewYear: 2025, viewMonth: 3 });
    expect(screen.getByTestId("date-day-30")).toBeInTheDocument();
    expect(screen.queryByTestId("date-day-31")).not.toBeInTheDocument();
  });

  it("highlights today with a border class", () => {
    renderGrid({ today: new Date(2025, 0, 10) });
    const todayBtn = screen.getByTestId("date-day-10");
    expect(todayBtn.className).toContain("border");
    expect(todayBtn.className).toContain("--color-primary");
  });

  it("highlights selected day with primary background", () => {
    renderGrid({ value: new Date(2025, 0, 20) });
    const selectedBtn = screen.getByTestId("date-day-20");
    expect(selectedBtn.className).toContain("bg-[var(--color-primary)]");
    expect(selectedBtn.className).toContain("text-white");
  });

  it("does not highlight a non-selected, non-today day", () => {
    renderGrid({ today: new Date(2025, 0, 15), value: new Date(2025, 0, 20) });
    const regularBtn = screen.getByTestId("date-day-5");
    expect(regularBtn.className).not.toContain("bg-[var(--color-primary)]");
    expect(regularBtn.className).not.toContain("border-[var(--color-primary)]");
  });

  it("calls onSelectDay with correct day number when clicked", () => {
    const props = renderGrid();
    fireEvent.click(screen.getByTestId("date-day-7"));
    expect(props.onSelectDay).toHaveBeenCalledWith(7);
  });

  it("handles month starting on Wednesday (January 2025 starts on Wed)", () => {
    // January 2025 starts on Wednesday (index 3)
    renderGrid({ viewYear: 2025, viewMonth: 0 });
    const calendar = screen.getByTestId("date-time-calendar");
    // 3 empty placeholders + 31 day buttons = 34 children
    expect(calendar.children).toHaveLength(3 + 31);
  });

  it("handles month starting on Sunday (June 2025 starts on Sun)", () => {
    // June 2025 starts on Sunday (index 0)
    renderGrid({ viewYear: 2025, viewMonth: 5 });
    const calendar = screen.getByTestId("date-time-calendar");
    // 0 empty placeholders + 30 day buttons = 30 children
    expect(calendar.children).toHaveLength(0 + 30);
  });

  it("handles month starting on Saturday (March 2025 starts on Sat)", () => {
    // March 2025 starts on Saturday (index 6)
    renderGrid({ viewYear: 2025, viewMonth: 2 });
    const calendar = screen.getByTestId("date-time-calendar");
    // 6 empty placeholders + 31 day buttons = 37 children
    expect(calendar.children).toHaveLength(6 + 31);
  });

  it("renders 29 days for February in a leap year", () => {
    renderGrid({ viewYear: 2024, viewMonth: 1 });
    expect(screen.getByTestId("date-day-29")).toBeInTheDocument();
    expect(screen.queryByTestId("date-day-30")).not.toBeInTheDocument();
  });

  it("renders 28 days for February in a non-leap year", () => {
    renderGrid({ viewYear: 2025, viewMonth: 1 });
    expect(screen.getByTestId("date-day-28")).toBeInTheDocument();
    expect(screen.queryByTestId("date-day-29")).not.toBeInTheDocument();
  });
});
