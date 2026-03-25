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
});
