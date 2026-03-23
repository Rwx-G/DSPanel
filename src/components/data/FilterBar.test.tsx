import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { FilterBar, type FilterChip } from "./FilterBar";

describe("FilterBar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const defaultFilters: FilterChip[] = [
    { id: "status", label: "Status", value: "Active" },
    { id: "dept", label: "Department", value: "IT" },
  ];

  it("should render the filter bar", () => {
    render(
      <FilterBar
        filters={[]}
        onFilterChange={vi.fn()}
        onTextFilter={vi.fn()}
      />,
    );
    expect(screen.getByTestId("filter-bar")).toBeInTheDocument();
  });

  it("should render filter chips", () => {
    render(
      <FilterBar
        filters={defaultFilters}
        onFilterChange={vi.fn()}
        onTextFilter={vi.fn()}
      />,
    );
    expect(screen.getByTestId("filter-chip-status")).toBeInTheDocument();
    expect(screen.getByTestId("filter-chip-dept")).toBeInTheDocument();
  });

  it("should remove a filter chip when its remove button is clicked", () => {
    const onFilterChange = vi.fn();
    render(
      <FilterBar
        filters={defaultFilters}
        onFilterChange={onFilterChange}
        onTextFilter={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("filter-remove-status"));
    expect(onFilterChange).toHaveBeenCalledWith([defaultFilters[1]]);
  });

  it("should debounce text filter input", () => {
    const onTextFilter = vi.fn();
    render(
      <FilterBar
        filters={[]}
        onFilterChange={vi.fn()}
        onTextFilter={onTextFilter}
        debounceMs={300}
      />,
    );

    fireEvent.change(screen.getByTestId("filter-text-input"), {
      target: { value: "test" },
    });

    expect(onTextFilter).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(350);
    });

    expect(onTextFilter).toHaveBeenCalledWith("test");
  });

  it("should show clear-all button when filters exist", () => {
    render(
      <FilterBar
        filters={defaultFilters}
        onFilterChange={vi.fn()}
        onTextFilter={vi.fn()}
      />,
    );
    expect(screen.getByTestId("filter-clear-all")).toBeInTheDocument();
  });

  it("should not show clear-all button when no filters and no text", () => {
    render(
      <FilterBar
        filters={[]}
        onFilterChange={vi.fn()}
        onTextFilter={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("filter-clear-all")).not.toBeInTheDocument();
  });

  it("should clear all filters and text on clear-all click", () => {
    const onFilterChange = vi.fn();
    const onTextFilter = vi.fn();
    render(
      <FilterBar
        filters={defaultFilters}
        onFilterChange={onFilterChange}
        onTextFilter={onTextFilter}
      />,
    );
    fireEvent.click(screen.getByTestId("filter-clear-all"));
    expect(onFilterChange).toHaveBeenCalledWith([]);
    expect(onTextFilter).toHaveBeenCalledWith("");
  });

  it("should render with default placeholder", () => {
    render(
      <FilterBar
        filters={[]}
        onFilterChange={vi.fn()}
        onTextFilter={vi.fn()}
      />,
    );
    expect(screen.getByPlaceholderText("Filter...")).toBeInTheDocument();
  });
});
