import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { SearchBar } from "./SearchBar";

describe("SearchBar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should render with placeholder and shortcut hint", () => {
    render(<SearchBar value="" onChange={vi.fn()} onSearch={vi.fn()} />);
    expect(screen.getByPlaceholderText("Search... (Ctrl+F)")).toBeInTheDocument();
  });

  it("should render with custom placeholder and shortcut hint", () => {
    render(
      <SearchBar
        value=""
        onChange={vi.fn()}
        onSearch={vi.fn()}
        placeholder="Find user..."
      />,
    );
    expect(screen.getByPlaceholderText("Find user... (Ctrl+F)")).toBeInTheDocument();
  });

  it("should display the current value", () => {
    render(<SearchBar value="test" onChange={vi.fn()} onSearch={vi.fn()} />);
    expect(screen.getByTestId("search-input")).toHaveValue("test");
  });

  it("should call onChange when typing", () => {
    const onChange = vi.fn();
    render(<SearchBar value="" onChange={onChange} onSearch={vi.fn()} />);
    fireEvent.change(screen.getByTestId("search-input"), {
      target: { value: "hello" },
    });
    expect(onChange).toHaveBeenCalledWith("hello");
  });

  it("should debounce onSearch calls", () => {
    const onSearch = vi.fn();
    const { rerender } = render(
      <SearchBar
        value=""
        onChange={vi.fn()}
        onSearch={onSearch}
        debounceMs={300}
      />,
    );

    rerender(
      <SearchBar
        value="test"
        onChange={vi.fn()}
        onSearch={onSearch}
        debounceMs={300}
      />,
    );

    expect(onSearch).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(350);
    });

    expect(onSearch).toHaveBeenCalledWith("test");
  });

  it("should show clear button when value is non-empty", () => {
    render(<SearchBar value="test" onChange={vi.fn()} onSearch={vi.fn()} />);
    expect(screen.getByTestId("search-clear")).toBeInTheDocument();
  });

  it("should not show clear button when value is empty", () => {
    render(<SearchBar value="" onChange={vi.fn()} onSearch={vi.fn()} />);
    expect(screen.queryByTestId("search-clear")).not.toBeInTheDocument();
  });

  it("should call onChange and onSearch with empty string when clear is clicked", () => {
    const onChange = vi.fn();
    const onSearch = vi.fn();
    render(<SearchBar value="test" onChange={onChange} onSearch={onSearch} />);
    fireEvent.click(screen.getByTestId("search-clear"));
    expect(onChange).toHaveBeenCalledWith("");
    expect(onSearch).toHaveBeenCalledWith("");
  });

  it("should have accessible clear button label", () => {
    render(<SearchBar value="test" onChange={vi.fn()} onSearch={vi.fn()} />);
    expect(screen.getByLabelText("Clear search")).toBeInTheDocument();
  });
});
