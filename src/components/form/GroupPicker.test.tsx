import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GroupPicker, type GroupOption } from "./GroupPicker";

const mockGroups: GroupOption[] = [
  {
    distinguishedName: "CN=Admins,DC=example,DC=com",
    name: "Admins",
    description: "Domain administrators",
  },
  {
    distinguishedName: "CN=Users,DC=example,DC=com",
    name: "Users",
    description: "Regular users",
  },
  {
    distinguishedName: "CN=Sales,DC=example,DC=com",
    name: "Sales",
  },
];

describe("GroupPicker", () => {
  let onSearch: ReturnType<typeof vi.fn>;
  let onSelectionChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onSearch = vi.fn().mockResolvedValue(mockGroups);
    onSelectionChange = vi.fn();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should render the group picker", () => {
    render(
      <GroupPicker
        selectedGroups={[]}
        onSelectionChange={onSelectionChange}
        onSearch={onSearch}
      />,
    );
    expect(screen.getByTestId("group-picker")).toBeInTheDocument();
  });

  it("should render search input with placeholder", () => {
    render(
      <GroupPicker
        selectedGroups={[]}
        onSelectionChange={onSelectionChange}
        onSearch={onSearch}
        placeholder="Find groups..."
      />,
    );
    expect(screen.getByPlaceholderText("Find groups...")).toBeInTheDocument();
  });

  it("should display selected groups as tag chips", () => {
    render(
      <GroupPicker
        selectedGroups={[mockGroups[0]]}
        onSelectionChange={onSelectionChange}
        onSearch={onSearch}
      />,
    );
    expect(screen.getByTestId("group-picker-selected")).toBeInTheDocument();
    expect(screen.getByText("Admins")).toBeInTheDocument();
  });

  it("should call onSearch after debounce when typing", async () => {
    render(
      <GroupPicker
        selectedGroups={[]}
        onSelectionChange={onSelectionChange}
        onSearch={onSearch}
        debounceMs={100}
      />,
    );

    fireEvent.change(screen.getByTestId("group-picker-search"), {
      target: { value: "admin" },
    });

    // Not called immediately
    expect(onSearch).not.toHaveBeenCalled();

    // Advance timer past debounce
    await vi.advanceTimersByTimeAsync(150);

    expect(onSearch).toHaveBeenCalledWith("admin");
  });

  it("should show search results in dropdown", async () => {
    render(
      <GroupPicker
        selectedGroups={[]}
        onSelectionChange={onSelectionChange}
        onSearch={onSearch}
        debounceMs={100}
      />,
    );

    fireEvent.change(screen.getByTestId("group-picker-search"), {
      target: { value: "test" },
    });

    await vi.advanceTimersByTimeAsync(150);

    await waitFor(() => {
      expect(screen.getByTestId("group-picker-dropdown")).toBeInTheDocument();
    });
    expect(screen.getByTestId("group-option-Admins")).toBeInTheDocument();
  });

  it("should show group description in results", async () => {
    render(
      <GroupPicker
        selectedGroups={[]}
        onSelectionChange={onSelectionChange}
        onSearch={onSearch}
        debounceMs={100}
      />,
    );

    fireEvent.change(screen.getByTestId("group-picker-search"), {
      target: { value: "test" },
    });

    await vi.advanceTimersByTimeAsync(150);

    await waitFor(() => {
      expect(screen.getByText("Domain administrators")).toBeInTheDocument();
    });
  });

  it("should add group to selection when clicked", async () => {
    render(
      <GroupPicker
        selectedGroups={[]}
        onSelectionChange={onSelectionChange}
        onSearch={onSearch}
        debounceMs={100}
      />,
    );

    fireEvent.change(screen.getByTestId("group-picker-search"), {
      target: { value: "test" },
    });

    await vi.advanceTimersByTimeAsync(150);

    await waitFor(() => {
      expect(screen.getByTestId("group-option-Admins")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("group-option-Admins"));
    expect(onSelectionChange).toHaveBeenCalledWith([mockGroups[0]]);
  });

  it("should remove group when tag chip remove is clicked", () => {
    render(
      <GroupPicker
        selectedGroups={[mockGroups[0], mockGroups[1]]}
        onSelectionChange={onSelectionChange}
        onSearch={onSearch}
      />,
    );

    const removeButtons = screen.getAllByTestId("tag-chip-remove");
    fireEvent.click(removeButtons[0]);

    expect(onSelectionChange).toHaveBeenCalledWith([mockGroups[1]]);
  });

  it("should filter already-selected groups from results", async () => {
    render(
      <GroupPicker
        selectedGroups={[mockGroups[0]]}
        onSelectionChange={onSelectionChange}
        onSearch={onSearch}
        debounceMs={100}
      />,
    );

    fireEvent.change(screen.getByTestId("group-picker-search"), {
      target: { value: "test" },
    });

    await vi.advanceTimersByTimeAsync(150);

    await waitFor(() => {
      expect(screen.getByTestId("group-picker-dropdown")).toBeInTheDocument();
    });

    // Admins should not be in the dropdown since it's already selected
    expect(screen.queryByTestId("group-option-Admins")).not.toBeInTheDocument();
    expect(screen.getByTestId("group-option-Users")).toBeInTheDocument();
  });

  it("should show no results message when search returns empty", async () => {
    onSearch.mockResolvedValue([]);
    render(
      <GroupPicker
        selectedGroups={[]}
        onSelectionChange={onSelectionChange}
        onSearch={onSearch}
        debounceMs={100}
      />,
    );

    fireEvent.change(screen.getByTestId("group-picker-search"), {
      target: { value: "nonexistent" },
    });

    await vi.advanceTimersByTimeAsync(150);

    await waitFor(() => {
      expect(screen.getByTestId("group-picker-no-results")).toBeInTheDocument();
    });
  });

  it("should clear search when clear button is clicked", async () => {
    render(
      <GroupPicker
        selectedGroups={[]}
        onSelectionChange={onSelectionChange}
        onSearch={onSearch}
        debounceMs={100}
      />,
    );

    fireEvent.change(screen.getByTestId("group-picker-search"), {
      target: { value: "test" },
    });

    await vi.advanceTimersByTimeAsync(150);

    await waitFor(() => {
      expect(screen.getByTestId("group-picker-clear")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("group-picker-clear"));
    expect(screen.getByTestId("group-picker-search")).toHaveValue("");
  });

  it("should be disabled when disabled prop is true", () => {
    render(
      <GroupPicker
        selectedGroups={[]}
        onSelectionChange={onSelectionChange}
        onSearch={onSearch}
        disabled={true}
      />,
    );
    const picker = screen.getByTestId("group-picker");
    expect(picker).toHaveClass("pointer-events-none");
    expect(picker).toHaveClass("opacity-50");
  });

  it("should navigate results with ArrowDown key", async () => {
    render(
      <GroupPicker
        selectedGroups={[]}
        onSelectionChange={onSelectionChange}
        onSearch={onSearch}
        debounceMs={100}
      />,
    );

    fireEvent.change(screen.getByTestId("group-picker-search"), {
      target: { value: "test" },
    });

    await vi.advanceTimersByTimeAsync(150);

    await waitFor(() => {
      expect(screen.getByTestId("group-picker-dropdown")).toBeInTheDocument();
    });

    const input = screen.getByTestId("group-picker-search");

    // Press ArrowDown to highlight first item (index 0)
    fireEvent.keyDown(input, { key: "ArrowDown" });

    const firstOption = screen.getByTestId("group-option-Admins");
    expect(firstOption.className).toContain("bg-[var(--color-primary-subtle)]");

    // Press ArrowDown again to highlight second item (index 1)
    fireEvent.keyDown(input, { key: "ArrowDown" });

    const secondOption = screen.getByTestId("group-option-Users");
    expect(secondOption.className).toContain(
      "bg-[var(--color-primary-subtle)]",
    );
    // First option should no longer be highlighted
    expect(firstOption.className).not.toContain(
      "bg-[var(--color-primary-subtle)]",
    );
  });

  it("should navigate results with ArrowUp key", async () => {
    render(
      <GroupPicker
        selectedGroups={[]}
        onSelectionChange={onSelectionChange}
        onSearch={onSearch}
        debounceMs={100}
      />,
    );

    fireEvent.change(screen.getByTestId("group-picker-search"), {
      target: { value: "test" },
    });

    await vi.advanceTimersByTimeAsync(150);

    await waitFor(() => {
      expect(screen.getByTestId("group-picker-dropdown")).toBeInTheDocument();
    });

    const input = screen.getByTestId("group-picker-search");

    // Navigate down twice (to index 1)
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });

    const secondOption = screen.getByTestId("group-option-Users");
    expect(secondOption.className).toContain(
      "bg-[var(--color-primary-subtle)]",
    );

    // Navigate up (back to index 0)
    fireEvent.keyDown(input, { key: "ArrowUp" });

    const firstOption = screen.getByTestId("group-option-Admins");
    expect(firstOption.className).toContain("bg-[var(--color-primary-subtle)]");
    expect(secondOption.className).not.toContain(
      "bg-[var(--color-primary-subtle)]",
    );
  });

  it("should select highlighted result with Enter key", async () => {
    render(
      <GroupPicker
        selectedGroups={[]}
        onSelectionChange={onSelectionChange}
        onSearch={onSearch}
        debounceMs={100}
      />,
    );

    fireEvent.change(screen.getByTestId("group-picker-search"), {
      target: { value: "test" },
    });

    await vi.advanceTimersByTimeAsync(150);

    await waitFor(() => {
      expect(screen.getByTestId("group-picker-dropdown")).toBeInTheDocument();
    });

    const input = screen.getByTestId("group-picker-search");

    // Navigate to first item and press Enter
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSelectionChange).toHaveBeenCalledWith([mockGroups[0]]);
  });

  it("should close dropdown on Escape key", async () => {
    render(
      <GroupPicker
        selectedGroups={[]}
        onSelectionChange={onSelectionChange}
        onSearch={onSearch}
        debounceMs={100}
      />,
    );

    fireEvent.change(screen.getByTestId("group-picker-search"), {
      target: { value: "test" },
    });

    await vi.advanceTimersByTimeAsync(150);

    await waitFor(() => {
      expect(screen.getByTestId("group-picker-dropdown")).toBeInTheDocument();
    });

    const input = screen.getByTestId("group-picker-search");
    fireEvent.keyDown(input, { key: "Escape" });

    expect(
      screen.queryByTestId("group-picker-dropdown"),
    ).not.toBeInTheDocument();
  });

  it("should close dropdown on click outside", async () => {
    render(
      <GroupPicker
        selectedGroups={[]}
        onSelectionChange={onSelectionChange}
        onSearch={onSearch}
        debounceMs={100}
      />,
    );

    fireEvent.change(screen.getByTestId("group-picker-search"), {
      target: { value: "test" },
    });

    await vi.advanceTimersByTimeAsync(150);

    await waitFor(() => {
      expect(screen.getByTestId("group-picker-dropdown")).toBeInTheDocument();
    });

    // Simulate click outside the component
    fireEvent.mouseDown(document.body);

    expect(
      screen.queryByTestId("group-picker-dropdown"),
    ).not.toBeInTheDocument();
  });
});
