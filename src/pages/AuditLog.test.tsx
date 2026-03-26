import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AuditLog } from "./AuditLog";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

const mockEntries = [
  {
    timestamp: "2026-03-25T10:00:00+00:00",
    operator: "admin",
    action: "PasswordReset",
    targetDn: "CN=John Doe,OU=Users,DC=example,DC=com",
    details: "Password reset by operator",
    success: true,
  },
  {
    timestamp: "2026-03-25T09:00:00+00:00",
    operator: "admin",
    action: "AccountDisabled",
    targetDn: "CN=Jane Smith,OU=Users,DC=example,DC=com",
    details: "Account disabled for offboarding",
    success: true,
  },
  {
    timestamp: "2026-03-24T15:00:00+00:00",
    operator: "helpdesk",
    action: "PasswordResetFailed",
    targetDn: "CN=Bob,OU=Users,DC=example,DC=com",
    details: "Insufficient rights",
    success: false,
  },
];

const mockQueryResult = {
  entries: mockEntries,
  totalCount: 3,
};

const mockActionTypes = ["AccountDisabled", "PasswordReset", "PasswordResetFailed"];

describe("AuditLog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "query_audit_log") return Promise.resolve(mockQueryResult);
      if (cmd === "get_audit_action_types") return Promise.resolve(mockActionTypes);
      return Promise.resolve(null);
    });
  });

  it("renders the page title", async () => {
    render(<AuditLog />);
    expect(screen.getByText("Activity Journal")).toBeInTheDocument();
  });

  it("fetches and displays audit entries", async () => {
    render(<AuditLog />);
    await waitFor(() => {
      expect(screen.getAllByTestId("audit-row").length).toBe(3);
    });
  });

  it("displays entry count", async () => {
    render(<AuditLog />);
    await waitFor(() => {
      expect(screen.getByText(/3 entries found/)).toBeInTheDocument();
    });
  });

  it("shows filter bar with all controls", async () => {
    render(<AuditLog />);
    expect(screen.getByTestId("audit-filter-bar")).toBeInTheDocument();
    expect(screen.getByTestId("filter-date-from")).toBeInTheDocument();
    expect(screen.getByTestId("filter-date-to")).toBeInTheDocument();
    expect(screen.getByTestId("filter-operator")).toBeInTheDocument();
    expect(screen.getByTestId("filter-action")).toBeInTheDocument();
    expect(screen.getByTestId("filter-target")).toBeInTheDocument();
    expect(screen.getByTestId("filter-result")).toBeInTheDocument();
  });

  it("shows search and reset buttons", () => {
    render(<AuditLog />);
    expect(screen.getByTestId("search-button")).toBeInTheDocument();
    expect(screen.getByTestId("reset-button")).toBeInTheDocument();
  });

  it("has export toolbar", () => {
    render(<AuditLog />);
    expect(screen.getByTestId("export-toolbar")).toBeInTheDocument();
  });

  it("calls query_audit_log with filters on search", async () => {
    render(<AuditLog />);
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("query_audit_log", expect.anything());
    });

    // Type in operator filter
    fireEvent.change(screen.getByTestId("filter-operator"), {
      target: { value: "admin" },
    });

    // Click search
    fireEvent.click(screen.getByTestId("search-button"));

    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter((c) => c[0] === "query_audit_log");
      const lastCall = calls[calls.length - 1];
      expect((lastCall[1] as { filter: { operator: string } }).filter.operator).toBe("admin");
    });
  });

  it("shows empty state when no entries", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "query_audit_log")
        return Promise.resolve({ entries: [], totalCount: 0 });
      if (cmd === "get_audit_action_types") return Promise.resolve([]);
      return Promise.resolve(null);
    });

    render(<AuditLog />);
    await waitFor(() => {
      expect(screen.getByText("No audit entries found")).toBeInTheDocument();
    });
  });

  it("shows error message on fetch failure", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "query_audit_log")
        return Promise.reject("Connection failed");
      if (cmd === "get_audit_action_types") return Promise.resolve([]);
      return Promise.resolve(null);
    });

    render(<AuditLog />);
    await waitFor(() => {
      expect(screen.getByTestId("error-message")).toBeInTheDocument();
    });
  });

  it("expands a row to show details", async () => {
    render(<AuditLog />);
    await waitFor(() => {
      expect(screen.getAllByTestId("audit-row").length).toBe(3);
    });

    fireEvent.click(screen.getAllByTestId("audit-row")[0]);

    await waitFor(() => {
      expect(screen.getByText("Password reset by operator")).toBeInTheDocument();
    });
  });

  it("populates action type dropdown", async () => {
    render(<AuditLog />);
    await waitFor(() => {
      const select = screen.getByTestId("filter-action") as HTMLSelectElement;
      const options = Array.from(select.options);
      // "All" + 3 action types
      expect(options.length).toBe(4);
    });
  });

  it("resets filters when reset button clicked", async () => {
    render(<AuditLog />);

    // Set a filter
    fireEvent.change(screen.getByTestId("filter-operator"), {
      target: { value: "admin" },
    });

    // Click reset
    fireEvent.click(screen.getByTestId("reset-button"));

    const operatorInput = screen.getByTestId("filter-operator") as HTMLInputElement;
    expect(operatorInput.value).toBe("");
  });

  // ---------------------------------------------------------------------------
  // Date range filter
  // ---------------------------------------------------------------------------

  it("sends dateFrom as ISO string in filter when set", async () => {
    render(<AuditLog />);
    await waitFor(() => {
      expect(screen.getAllByTestId("audit-row").length).toBe(3);
    });

    fireEvent.change(screen.getByTestId("filter-date-from"), {
      target: { value: "2026-03-01" },
    });
    fireEvent.click(screen.getByTestId("search-button"));

    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(
        (c) => c[0] === "query_audit_log",
      );
      const lastCall = calls[calls.length - 1];
      const filter = (lastCall[1] as { filter: { dateFrom: string } }).filter;
      expect(filter.dateFrom).toContain("2026-03-01");
    });
  });

  it("sends dateTo as ISO string with end-of-day in filter when set", async () => {
    render(<AuditLog />);
    await waitFor(() => {
      expect(screen.getAllByTestId("audit-row").length).toBe(3);
    });

    fireEvent.change(screen.getByTestId("filter-date-to"), {
      target: { value: "2026-03-25" },
    });
    fireEvent.click(screen.getByTestId("search-button"));

    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(
        (c) => c[0] === "query_audit_log",
      );
      const lastCall = calls[calls.length - 1];
      const filter = (lastCall[1] as { filter: { dateTo: string } }).filter;
      expect(filter.dateTo).toContain("2026-03-25");
    });
  });

  // ---------------------------------------------------------------------------
  // Operator filter
  // ---------------------------------------------------------------------------

  it("sends null operator when operator filter is empty", async () => {
    render(<AuditLog />);
    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(
        (c) => c[0] === "query_audit_log",
      );
      const lastCall = calls[calls.length - 1];
      const filter = (lastCall[1] as { filter: { operator: string | null } })
        .filter;
      expect(filter.operator).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Action type dropdown filter
  // ---------------------------------------------------------------------------

  it("sends action filter when a specific action type is selected", async () => {
    render(<AuditLog />);
    await waitFor(() => {
      expect(screen.getAllByTestId("audit-row").length).toBe(3);
    });

    fireEvent.change(screen.getByTestId("filter-action"), {
      target: { value: "PasswordReset" },
    });
    fireEvent.click(screen.getByTestId("search-button"));

    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(
        (c) => c[0] === "query_audit_log",
      );
      const lastCall = calls[calls.length - 1];
      const filter = (lastCall[1] as { filter: { action: string } }).filter;
      expect(filter.action).toBe("PasswordReset");
    });
  });

  // ---------------------------------------------------------------------------
  // Target DN filter
  // ---------------------------------------------------------------------------

  it("sends targetDn filter when target input has value", async () => {
    render(<AuditLog />);
    await waitFor(() => {
      expect(screen.getAllByTestId("audit-row").length).toBe(3);
    });

    fireEvent.change(screen.getByTestId("filter-target"), {
      target: { value: "John" },
    });
    fireEvent.click(screen.getByTestId("search-button"));

    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(
        (c) => c[0] === "query_audit_log",
      );
      const lastCall = calls[calls.length - 1];
      const filter = (lastCall[1] as { filter: { targetDn: string } }).filter;
      expect(filter.targetDn).toBe("John");
    });
  });

  // ---------------------------------------------------------------------------
  // Result filter
  // ---------------------------------------------------------------------------

  it("sends success=true when result filter is set to success", async () => {
    render(<AuditLog />);
    await waitFor(() => {
      expect(screen.getAllByTestId("audit-row").length).toBe(3);
    });

    fireEvent.change(screen.getByTestId("filter-result"), {
      target: { value: "success" },
    });
    fireEvent.click(screen.getByTestId("search-button"));

    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(
        (c) => c[0] === "query_audit_log",
      );
      const lastCall = calls[calls.length - 1];
      const filter = (lastCall[1] as { filter: { success: boolean } }).filter;
      expect(filter.success).toBe(true);
    });
  });

  it("sends success=false when result filter is set to failure", async () => {
    render(<AuditLog />);
    await waitFor(() => {
      expect(screen.getAllByTestId("audit-row").length).toBe(3);
    });

    fireEvent.change(screen.getByTestId("filter-result"), {
      target: { value: "failure" },
    });
    fireEvent.click(screen.getByTestId("search-button"));

    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(
        (c) => c[0] === "query_audit_log",
      );
      const lastCall = calls[calls.length - 1];
      const filter = (lastCall[1] as { filter: { success: boolean | null } })
        .filter;
      expect(filter.success).toBe(false);
    });
  });

  it("sends success=null when result filter is set to All", async () => {
    render(<AuditLog />);
    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(
        (c) => c[0] === "query_audit_log",
      );
      const lastCall = calls[calls.length - 1];
      const filter = (lastCall[1] as { filter: { success: boolean | null } })
        .filter;
      expect(filter.success).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Sort order toggle
  // ---------------------------------------------------------------------------

  it("toggles sort order and refetches", async () => {
    render(<AuditLog />);
    await waitFor(() => {
      expect(screen.getAllByTestId("audit-row").length).toBe(3);
    });

    // Default is "Newest first"
    expect(screen.getByTestId("sort-toggle")).toHaveTextContent("Newest first");

    fireEvent.click(screen.getByTestId("sort-toggle"));

    await waitFor(() => {
      expect(screen.getByTestId("sort-toggle")).toHaveTextContent(
        "Oldest first",
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Pagination
  // ---------------------------------------------------------------------------

  it("shows pagination when totalCount exceeds page size", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "query_audit_log")
        return Promise.resolve({
          entries: mockEntries,
          totalCount: 150, // 3 pages
        });
      if (cmd === "get_audit_action_types") return Promise.resolve(mockActionTypes);
      return Promise.resolve(null);
    });

    render(<AuditLog />);
    await waitFor(() => {
      expect(screen.getByTestId("pagination")).toBeInTheDocument();
    });
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
  });

  it("navigates to next page", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "query_audit_log")
        return Promise.resolve({
          entries: mockEntries,
          totalCount: 150,
        });
      if (cmd === "get_audit_action_types") return Promise.resolve(mockActionTypes);
      return Promise.resolve(null);
    });

    render(<AuditLog />);
    await waitFor(() => {
      expect(screen.getByTestId("pagination")).toBeInTheDocument();
    });

    // Click next page
    const nextBtn = screen.getByTestId("pagination").querySelectorAll("button")[1];
    fireEvent.click(nextBtn);

    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(
        (c) => c[0] === "query_audit_log",
      );
      const lastCall = calls[calls.length - 1];
      const filter = (lastCall[1] as { filter: { page: number } }).filter;
      expect(filter.page).toBe(1);
    });
  });

  it("navigates to previous page", async () => {
    let currentPage = 1;
    mockInvoke.mockImplementation((cmd: string, args?: unknown) => {
      if (cmd === "query_audit_log") {
        const filter = (args as { filter: { page: number } }).filter;
        currentPage = filter.page;
        return Promise.resolve({
          entries: mockEntries,
          totalCount: 150,
        });
      }
      if (cmd === "get_audit_action_types") return Promise.resolve(mockActionTypes);
      return Promise.resolve(null);
    });

    render(<AuditLog />);
    await waitFor(() => {
      expect(screen.getByTestId("pagination")).toBeInTheDocument();
    });

    // Navigate to page 2 first
    const nextBtn = screen.getByTestId("pagination").querySelectorAll("button")[1];
    fireEvent.click(nextBtn);

    await waitFor(() => {
      expect(currentPage).toBe(1);
    });

    // Then navigate back
    const prevBtn = screen.getByTestId("pagination").querySelectorAll("button")[0];
    fireEvent.click(prevBtn);

    await waitFor(() => {
      expect(currentPage).toBe(0);
    });
  });

  it("disables previous button on first page", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "query_audit_log")
        return Promise.resolve({
          entries: mockEntries,
          totalCount: 150,
        });
      if (cmd === "get_audit_action_types") return Promise.resolve(mockActionTypes);
      return Promise.resolve(null);
    });

    render(<AuditLog />);
    await waitFor(() => {
      expect(screen.getByTestId("pagination")).toBeInTheDocument();
    });

    const prevBtn = screen.getByTestId("pagination").querySelectorAll("button")[0];
    expect(prevBtn).toBeDisabled();
  });

  it("does not show pagination when results fit in one page", async () => {
    render(<AuditLog />);
    await waitFor(() => {
      expect(screen.getAllByTestId("audit-row").length).toBe(3);
    });
    expect(screen.queryByTestId("pagination")).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Row expansion and collapse
  // ---------------------------------------------------------------------------

  it("collapses an expanded row when clicked again", async () => {
    render(<AuditLog />);
    await waitFor(() => {
      expect(screen.getAllByTestId("audit-row").length).toBe(3);
    });

    // Expand
    fireEvent.click(screen.getAllByTestId("audit-row")[0]);
    await waitFor(() => {
      expect(
        screen.getByText("Password reset by operator"),
      ).toBeInTheDocument();
    });

    // Collapse
    fireEvent.click(screen.getAllByTestId("audit-row")[0]);
    await waitFor(() => {
      expect(
        screen.queryByText("Password reset by operator"),
      ).not.toBeInTheDocument();
    });
  });

  it("shows full target DN in expanded row", async () => {
    render(<AuditLog />);
    await waitFor(() => {
      expect(screen.getAllByTestId("audit-row").length).toBe(3);
    });

    fireEvent.click(screen.getAllByTestId("audit-row")[0]);
    await waitFor(() => {
      expect(
        screen.getByText("CN=John Doe,OU=Users,DC=example,DC=com"),
      ).toBeInTheDocument();
    });
  });

  it("shows (none) for empty details in expanded row", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "query_audit_log")
        return Promise.resolve({
          entries: [
            {
              timestamp: "2026-03-25T10:00:00+00:00",
              operator: "admin",
              action: "PasswordReset",
              targetDn: "CN=Test,DC=example,DC=com",
              details: "",
              success: true,
            },
          ],
          totalCount: 1,
        });
      if (cmd === "get_audit_action_types") return Promise.resolve([]);
      return Promise.resolve(null);
    });

    render(<AuditLog />);
    await waitFor(() => {
      expect(screen.getAllByTestId("audit-row").length).toBe(1);
    });

    fireEvent.click(screen.getAllByTestId("audit-row")[0]);
    await waitFor(() => {
      expect(screen.getByText("(none)")).toBeInTheDocument();
    });
  });

  it("shows Success result text in expanded successful row", async () => {
    render(<AuditLog />);
    await waitFor(() => {
      expect(screen.getAllByTestId("audit-row").length).toBe(3);
    });

    // First entry is success
    fireEvent.click(screen.getAllByTestId("audit-row")[0]);
    await waitFor(() => {
      // The expanded row shows "Result: Success" - look for the styled span
      const resultSpans = screen.getAllByText("Success");
      // At least one should be outside the filter dropdown (in the expanded row)
      const expandedResult = resultSpans.find(
        (el) => el.closest("tr") !== null,
      );
      expect(expandedResult).toBeDefined();
    });
  });

  it("shows Failure result text in expanded failed row", async () => {
    render(<AuditLog />);
    await waitFor(() => {
      expect(screen.getAllByTestId("audit-row").length).toBe(3);
    });

    // Third entry is failure
    fireEvent.click(screen.getAllByTestId("audit-row")[2]);
    await waitFor(() => {
      const resultSpans = screen.getAllByText("Failure");
      const expandedResult = resultSpans.find(
        (el) => el.closest("tr") !== null,
      );
      expect(expandedResult).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Filter reset clears all fields
  // ---------------------------------------------------------------------------

  it("resets all filter fields when reset is clicked", async () => {
    render(<AuditLog />);

    // Set all filters
    fireEvent.change(screen.getByTestId("filter-date-from"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.change(screen.getByTestId("filter-date-to"), {
      target: { value: "2026-03-31" },
    });
    fireEvent.change(screen.getByTestId("filter-operator"), {
      target: { value: "admin" },
    });
    fireEvent.change(screen.getByTestId("filter-action"), {
      target: { value: "PasswordReset" },
    });
    fireEvent.change(screen.getByTestId("filter-target"), {
      target: { value: "John" },
    });
    fireEvent.change(screen.getByTestId("filter-result"), {
      target: { value: "success" },
    });

    // Click reset
    fireEvent.click(screen.getByTestId("reset-button"));

    expect(
      (screen.getByTestId("filter-date-from") as HTMLInputElement).value,
    ).toBe("");
    expect(
      (screen.getByTestId("filter-date-to") as HTMLInputElement).value,
    ).toBe("");
    expect(
      (screen.getByTestId("filter-operator") as HTMLInputElement).value,
    ).toBe("");
    expect(
      (screen.getByTestId("filter-action") as HTMLSelectElement).value,
    ).toBe("");
    expect(
      (screen.getByTestId("filter-target") as HTMLInputElement).value,
    ).toBe("");
    expect(
      (screen.getByTestId("filter-result") as HTMLSelectElement).value,
    ).toBe("");
  });

  // ---------------------------------------------------------------------------
  // Keyboard Enter triggers search
  // ---------------------------------------------------------------------------

  it("triggers search on Enter key in filter inputs", async () => {
    render(<AuditLog />);
    await waitFor(() => {
      expect(screen.getAllByTestId("audit-row").length).toBe(3);
    });

    const initialCallCount = mockInvoke.mock.calls.filter(
      (c) => c[0] === "query_audit_log",
    ).length;

    fireEvent.change(screen.getByTestId("filter-operator"), {
      target: { value: "helpdesk" },
    });
    fireEvent.keyDown(screen.getByTestId("filter-operator"), { key: "Enter" });

    await waitFor(() => {
      const newCallCount = mockInvoke.mock.calls.filter(
        (c) => c[0] === "query_audit_log",
      ).length;
      expect(newCallCount).toBeGreaterThan(initialCallCount);
    });
  });

  // ---------------------------------------------------------------------------
  // Refresh button
  // ---------------------------------------------------------------------------

  it("refetches current page on refresh button click", async () => {
    render(<AuditLog />);
    await waitFor(() => {
      expect(screen.getAllByTestId("audit-row").length).toBe(3);
    });

    const callCountBefore = mockInvoke.mock.calls.filter(
      (c) => c[0] === "query_audit_log",
    ).length;

    fireEvent.click(screen.getByTestId("refresh-button"));

    await waitFor(() => {
      const callCountAfter = mockInvoke.mock.calls.filter(
        (c) => c[0] === "query_audit_log",
      ).length;
      expect(callCountAfter).toBeGreaterThan(callCountBefore);
    });
  });

  // ---------------------------------------------------------------------------
  // Entry count singular
  // ---------------------------------------------------------------------------

  it("shows singular 'entry' for single result", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "query_audit_log")
        return Promise.resolve({
          entries: [mockEntries[0]],
          totalCount: 1,
        });
      if (cmd === "get_audit_action_types") return Promise.resolve(mockActionTypes);
      return Promise.resolve(null);
    });

    render(<AuditLog />);
    await waitFor(() => {
      expect(screen.getByText("1 entry found")).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Formatted DN in table rows
  // ---------------------------------------------------------------------------

  it("displays CN-extracted name in table rows", async () => {
    render(<AuditLog />);
    await waitFor(() => {
      expect(screen.getAllByTestId("audit-row").length).toBe(3);
    });

    // "CN=John Doe,OU=Users,DC=example,DC=com" should render as "John Doe"
    expect(screen.getByText("John Doe")).toBeInTheDocument();
    expect(screen.getByText("Jane Smith")).toBeInTheDocument();
  });
});
