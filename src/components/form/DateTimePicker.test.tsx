import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DateTimePicker } from "./DateTimePicker";

describe("DateTimePicker", () => {
  it("should render the date time picker", () => {
    render(<DateTimePicker value={null} onChange={vi.fn()} />);
    expect(screen.getByTestId("date-time-picker")).toBeInTheDocument();
  });

  it("should show placeholder when no value", () => {
    render(<DateTimePicker value={null} onChange={vi.fn()} />);
    expect(screen.getByText("Select date...")).toBeInTheDocument();
  });

  it("should show custom placeholder", () => {
    render(
      <DateTimePicker
        value={null}
        onChange={vi.fn()}
        placeholder="Pick a date"
      />,
    );
    expect(screen.getByText("Pick a date")).toBeInTheDocument();
  });

  it("should display formatted date when value is set", () => {
    const date = new Date(2026, 2, 15); // March 15, 2026
    render(<DateTimePicker value={date} onChange={vi.fn()} />);
    expect(screen.getByText("2026-03-15")).toBeInTheDocument();
  });

  it("should display date and time when includeTime is true", () => {
    const date = new Date(2026, 2, 15, 14, 30);
    render(
      <DateTimePicker value={date} onChange={vi.fn()} includeTime={true} />,
    );
    expect(screen.getByText("2026-03-15 14:30")).toBeInTheDocument();
  });

  it("should open calendar popup when clicked", () => {
    render(<DateTimePicker value={null} onChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("date-time-trigger"));
    expect(screen.getByTestId("date-time-popup")).toBeInTheDocument();
  });

  it("should display current month and year in popup", () => {
    const date = new Date(2026, 2, 15);
    render(<DateTimePicker value={date} onChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("date-time-trigger"));
    expect(screen.getByTestId("date-time-month-year")).toHaveTextContent(
      "March 2026",
    );
  });

  it("should navigate to previous month", () => {
    const date = new Date(2026, 2, 15);
    render(<DateTimePicker value={date} onChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("date-time-trigger"));
    fireEvent.click(screen.getByTestId("date-time-prev-month"));
    expect(screen.getByTestId("date-time-month-year")).toHaveTextContent(
      "February 2026",
    );
  });

  it("should navigate to next month", () => {
    const date = new Date(2026, 2, 15);
    render(<DateTimePicker value={date} onChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("date-time-trigger"));
    fireEvent.click(screen.getByTestId("date-time-next-month"));
    expect(screen.getByTestId("date-time-month-year")).toHaveTextContent(
      "April 2026",
    );
  });

  it("should wrap from January to December of previous year", () => {
    const date = new Date(2026, 0, 15); // January 2026
    render(<DateTimePicker value={date} onChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("date-time-trigger"));
    fireEvent.click(screen.getByTestId("date-time-prev-month"));
    expect(screen.getByTestId("date-time-month-year")).toHaveTextContent(
      "December 2025",
    );
  });

  it("should wrap from December to January of next year", () => {
    const date = new Date(2026, 11, 15); // December 2026
    render(<DateTimePicker value={date} onChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("date-time-trigger"));
    fireEvent.click(screen.getByTestId("date-time-next-month"));
    expect(screen.getByTestId("date-time-month-year")).toHaveTextContent(
      "January 2027",
    );
  });

  it("should call onChange when a day is selected", () => {
    const onChange = vi.fn();
    const date = new Date(2026, 2, 15);
    render(<DateTimePicker value={date} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("date-time-trigger"));
    fireEvent.click(screen.getByTestId("date-day-20"));
    expect(onChange).toHaveBeenCalledWith(new Date(2026, 2, 20));
  });

  it("should close popup after day selection when no time picker", () => {
    const onChange = vi.fn();
    render(<DateTimePicker value={null} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("date-time-trigger"));
    fireEvent.click(screen.getByTestId("date-day-10"));
    expect(screen.queryByTestId("date-time-popup")).not.toBeInTheDocument();
  });

  it("should keep popup open after day selection when includeTime", () => {
    const onChange = vi.fn();
    const date = new Date(2026, 2, 15, 10, 0);
    render(
      <DateTimePicker value={date} onChange={onChange} includeTime={true} />,
    );
    fireEvent.click(screen.getByTestId("date-time-trigger"));
    fireEvent.click(screen.getByTestId("date-day-20"));
    expect(screen.getByTestId("date-time-popup")).toBeInTheDocument();
  });

  it("should show time controls when includeTime and value set", () => {
    const date = new Date(2026, 2, 15, 14, 30);
    render(
      <DateTimePicker value={date} onChange={vi.fn()} includeTime={true} />,
    );
    fireEvent.click(screen.getByTestId("date-time-trigger"));
    expect(screen.getByTestId("date-time-time")).toBeInTheDocument();
    expect(screen.getByTestId("time-hours")).toHaveTextContent("14");
    expect(screen.getByTestId("time-minutes")).toHaveTextContent("30");
  });

  it("should increment hours", () => {
    const onChange = vi.fn();
    const date = new Date(2026, 2, 15, 14, 30);
    render(
      <DateTimePicker value={date} onChange={onChange} includeTime={true} />,
    );
    fireEvent.click(screen.getByTestId("date-time-trigger"));
    fireEvent.click(screen.getByTestId("time-hours-up"));
    expect(onChange).toHaveBeenCalledWith(new Date(2026, 2, 15, 15, 30));
  });

  it("should decrement hours", () => {
    const onChange = vi.fn();
    const date = new Date(2026, 2, 15, 14, 30);
    render(
      <DateTimePicker value={date} onChange={onChange} includeTime={true} />,
    );
    fireEvent.click(screen.getByTestId("date-time-trigger"));
    fireEvent.click(screen.getByTestId("time-hours-down"));
    expect(onChange).toHaveBeenCalledWith(new Date(2026, 2, 15, 13, 30));
  });

  it("should wrap hours from 23 to 0", () => {
    const onChange = vi.fn();
    const date = new Date(2026, 2, 15, 23, 0);
    render(
      <DateTimePicker value={date} onChange={onChange} includeTime={true} />,
    );
    fireEvent.click(screen.getByTestId("date-time-trigger"));
    fireEvent.click(screen.getByTestId("time-hours-up"));
    const called = onChange.mock.calls[0][0] as Date;
    expect(called.getHours()).toBe(0);
  });

  it("should increment minutes", () => {
    const onChange = vi.fn();
    const date = new Date(2026, 2, 15, 14, 30);
    render(
      <DateTimePicker value={date} onChange={onChange} includeTime={true} />,
    );
    fireEvent.click(screen.getByTestId("date-time-trigger"));
    fireEvent.click(screen.getByTestId("time-minutes-up"));
    expect(onChange).toHaveBeenCalledWith(new Date(2026, 2, 15, 14, 31));
  });

  it("should clear value when clear button is clicked", () => {
    const onChange = vi.fn();
    const date = new Date(2026, 2, 15);
    render(<DateTimePicker value={date} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("date-time-clear"));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("should be disabled when disabled prop is true", () => {
    render(<DateTimePicker value={null} onChange={vi.fn()} disabled={true} />);
    const trigger = screen.getByTestId("date-time-trigger");
    expect(trigger).toBeDisabled();
  });

  it("should show error border when error prop is true", () => {
    render(<DateTimePicker value={null} onChange={vi.fn()} error={true} />);
    const trigger = screen.getByTestId("date-time-trigger");
    expect(trigger.className).toContain("border-[var(--color-error)]");
  });

  it("should render correct number of days for the month", () => {
    const date = new Date(2026, 1, 15); // February 2026 (28 days)
    render(<DateTimePicker value={date} onChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("date-time-trigger"));
    expect(screen.getByTestId("date-day-28")).toBeInTheDocument();
    expect(screen.queryByTestId("date-day-29")).not.toBeInTheDocument();
  });

  it("should highlight today's date", () => {
    const today = new Date();
    render(<DateTimePicker value={null} onChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("date-time-trigger"));
    const todayButton = screen.getByTestId(`date-day-${today.getDate()}`);
    expect(todayButton.className).toContain("border-[var(--color-primary)]");
  });

  it("should highlight selected date", () => {
    const date = new Date(2026, 2, 15);
    render(<DateTimePicker value={date} onChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("date-time-trigger"));
    const selectedButton = screen.getByTestId("date-day-15");
    expect(selectedButton.className).toContain("bg-[var(--color-primary)]");
  });
});
