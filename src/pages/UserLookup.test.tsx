import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { UserLookup } from "./UserLookup";
import { DialogProvider } from "@/contexts/DialogContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import type { DirectoryEntry } from "@/types/directory";
import type { AccountHealthStatus } from "@/types/health";

function TestProviders({ children }: { children: ReactNode }) {
  return (
    <NotificationProvider>
      <DialogProvider>{children}</DialogProvider>
    </NotificationProvider>
  );
}

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

const HEALTHY_STATUS: AccountHealthStatus = {
  level: "Healthy",
  activeFlags: [],
};

const CRITICAL_STATUS: AccountHealthStatus = {
  level: "Critical",
  activeFlags: [
    { name: "Disabled", severity: "Critical", description: "Account is disabled" },
  ],
};

function makeEntry(
  sam: string,
  display: string,
  attrs: Record<string, string[]> = {},
): DirectoryEntry {
  return {
    distinguishedName: `CN=${display},OU=Users,OU=Corp,DC=example,DC=com`,
    samAccountName: sam,
    displayName: display,
    objectClass: "user",
    attributes: {
      givenName: [display.split(" ")[0]],
      sn: [display.split(" ")[1] ?? ""],
      mail: [`${sam}@example.com`],
      department: ["IT"],
      title: ["Engineer"],
      userAccountControl: ["512"],
      lockoutTime: ["0"],
      lastLogon: ["2026-03-12T08:00:00Z"],
      pwdLastSet: ["2026-02-01T10:00:00Z"],
      memberOf: [
        "CN=Domain Users,CN=Users,DC=example,DC=com",
        "CN=Developers,OU=Groups,DC=example,DC=com",
      ],
      badPwdCount: ["0"],
      whenCreated: ["2024-01-01T00:00:00Z"],
      whenChanged: ["2026-03-01T00:00:00Z"],
      ...attrs,
    },
  };
}

function mockInvokeWith(
  entries: DirectoryEntry[],
  healthOverrides: Record<string, AccountHealthStatus> = {},
) {
  mockInvoke.mockImplementation(((cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "search_users") return Promise.resolve(entries);
    if (cmd === "evaluate_health_cmd") {
      const input = args?.input as { enabled: boolean } | undefined;
      if (input && !input.enabled) return Promise.resolve(CRITICAL_STATUS);
      for (const [, status] of Object.entries(healthOverrides)) {
        return Promise.resolve(status);
      }
      return Promise.resolve(HEALTHY_STATUS);
    }
    return Promise.resolve(null);
  }) as typeof invoke);
}

describe("UserLookup", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("renders initial state with search bar and empty state", () => {
    render(<UserLookup />, { wrapper: TestProviders });
    expect(screen.getByTestId("user-lookup")).toBeInTheDocument();
    expect(screen.getByTestId("search-bar")).toBeInTheDocument();
    expect(screen.getByText("Search for a user")).toBeInTheDocument();
  });

  it("shows loading state during search", async () => {
    mockInvoke.mockImplementation((() => new Promise(() => {})) as typeof invoke);
    render(<UserLookup />, { wrapper: TestProviders });

    const input = screen.getByTestId("search-input");
    fireEvent.change(input, { target: { value: "jdoe" } });

    await waitFor(() => {
      expect(screen.getByTestId("user-lookup-loading")).toBeInTheDocument();
    });
  });

  it("shows results after successful search", async () => {
    const entries = [
      makeEntry("jdoe", "John Doe"),
      makeEntry("asmith", "Alice Smith"),
    ];
    mockInvokeWith(entries);

    render(<UserLookup />, { wrapper: TestProviders });
    const input = screen.getByTestId("search-input");
    fireEvent.change(input, { target: { value: "doe" } });

    await waitFor(() => {
      expect(screen.getByTestId("user-results-list")).toBeInTheDocument();
    });

    expect(screen.getByTestId("user-result-jdoe")).toBeInTheDocument();
    expect(screen.getByTestId("user-result-asmith")).toBeInTheDocument();
  });

  it("auto-selects user when only one result", async () => {
    const entries = [makeEntry("jdoe", "John Doe")];
    mockInvokeWith(entries);

    render(<UserLookup />, { wrapper: TestProviders });
    const input = screen.getByTestId("search-input");
    fireEvent.change(input, { target: { value: "jdoe" } });

    await waitFor(() => {
      expect(screen.getByTestId("user-detail")).toBeInTheDocument();
    });
  });

  it("shows empty state when no results", async () => {
    mockInvokeWith([]);

    render(<UserLookup />, { wrapper: TestProviders });
    const input = screen.getByTestId("search-input");
    fireEvent.change(input, { target: { value: "nobody" } });

    await waitFor(() => {
      expect(screen.getByText("No users found")).toBeInTheDocument();
    });
  });

  it("shows error state on search failure", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "search_users") return Promise.reject(new Error("LDAP connection failed"));
      return Promise.resolve(HEALTHY_STATUS);
    }) as typeof invoke);

    render(<UserLookup />, { wrapper: TestProviders });
    const input = screen.getByTestId("search-input");
    fireEvent.change(input, { target: { value: "test" } });

    await waitFor(() => {
      expect(screen.getByTestId("user-lookup-error")).toBeInTheDocument();
    });

    expect(screen.getByText("Search failed")).toBeInTheDocument();
  });

  it("shows retry button on error and retries search", async () => {
    let callCount = 0;
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "evaluate_health_cmd") return Promise.resolve(HEALTHY_STATUS);
      callCount++;
      if (callCount === 1) return Promise.reject(new Error("fail"));
      return Promise.resolve([makeEntry("jdoe", "John Doe")]);
    }) as typeof invoke);

    render(<UserLookup />, { wrapper: TestProviders });
    const input = screen.getByTestId("search-input");
    fireEvent.change(input, { target: { value: "test" } });

    await waitFor(() => {
      expect(screen.getByText("Retry")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Retry"));

    await waitFor(() => {
      expect(screen.getByTestId("user-results-list")).toBeInTheDocument();
    });
  });

  it("selects user from results list on click", async () => {
    const entries = [
      makeEntry("jdoe", "John Doe"),
      makeEntry("asmith", "Alice Smith"),
    ];
    mockInvokeWith(entries);

    render(<UserLookup />, { wrapper: TestProviders });
    const input = screen.getByTestId("search-input");
    fireEvent.change(input, { target: { value: "test" } });

    await waitFor(() => {
      expect(screen.getByTestId("user-result-jdoe")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("user-result-asmith"));

    await waitFor(() => {
      expect(screen.getByTestId("user-detail")).toBeInTheDocument();
    });

    const detail = screen.getByTestId("user-detail");
    expect(detail.querySelector("h2")).toHaveTextContent("Alice Smith");
  });

  it("displays user detail with property groups", async () => {
    const entries = [makeEntry("jdoe", "John Doe")];
    mockInvokeWith(entries);

    render(<UserLookup />, { wrapper: TestProviders });
    const input = screen.getByTestId("search-input");
    fireEvent.change(input, { target: { value: "jdoe" } });

    await waitFor(() => {
      expect(screen.getByTestId("user-detail")).toBeInTheDocument();
    });

    expect(screen.getByText("Identity")).toBeInTheDocument();
    expect(screen.getByText("Location")).toBeInTheDocument();
    expect(screen.getByText("Account Status")).toBeInTheDocument();
    expect(screen.getByText("Authentication")).toBeInTheDocument();
    expect(screen.getByText("Dates")).toBeInTheDocument();
  });

  it("displays group memberships section", async () => {
    const entries = [makeEntry("jdoe", "John Doe")];
    mockInvokeWith(entries);

    render(<UserLookup />, { wrapper: TestProviders });
    const input = screen.getByTestId("search-input");
    fireEvent.change(input, { target: { value: "jdoe" } });

    await waitFor(() => {
      expect(screen.getByTestId("user-groups-section")).toBeInTheDocument();
    });

    expect(screen.getByText("Group Memberships (2)")).toBeInTheDocument();
    expect(screen.getByText("Domain Users")).toBeInTheDocument();
    expect(screen.getByText("Developers")).toBeInTheDocument();
  });

  it("shows health badges for enabled/disabled users in results list", async () => {
    const entries = [
      makeEntry("jdoe", "John Doe"),
      makeEntry("disabled", "Disabled User", {
        userAccountControl: ["514"],
      }),
    ];
    mockInvokeWith(entries);

    render(<UserLookup />, { wrapper: TestProviders });
    const input = screen.getByTestId("search-input");
    fireEvent.change(input, { target: { value: "test" } });

    await waitFor(() => {
      expect(screen.getByTestId("user-results-list")).toBeInTheDocument();
    });

    await waitFor(() => {
      const activeResult = screen.getByTestId("user-result-jdoe");
      const activeBadge = activeResult.querySelector(
        '[data-testid="health-badge"]',
      );
      expect(activeBadge).toHaveAttribute("data-level", "Healthy");
    });

    const disabledResult = screen.getByTestId("user-result-disabled");
    const disabledBadge = disabledResult.querySelector(
      '[data-testid="health-badge"]',
    );
    expect(disabledBadge).toHaveAttribute("data-level", "Critical");
  });

  it("does not search with empty query", async () => {
    render(<UserLookup />, { wrapper: TestProviders });
    const input = screen.getByTestId("search-input");
    fireEvent.change(input, { target: { value: "" } });

    await waitFor(() => {
      expect(screen.getByText("Search for a user")).toBeInTheDocument();
    });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("calls invoke with correct command and arguments", async () => {
    mockInvokeWith([]);

    render(<UserLookup />, { wrapper: TestProviders });
    const input = screen.getByTestId("search-input");
    fireEvent.change(input, { target: { value: "jdoe" } });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("search_users", {
        query: "jdoe",
      });
    });
  });
});
