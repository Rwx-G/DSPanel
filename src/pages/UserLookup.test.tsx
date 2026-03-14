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

// Mock react-virtual to avoid needing real scroll container measurements
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: vi.fn(({ count, estimateSize, getItemKey }) => {
    const items = Array.from({ length: Math.min(count, 50) }, (_, i) => ({
      key: getItemKey ? getItemKey(i) : i,
      index: i,
      start: i * estimateSize(i),
      size: estimateSize(i),
    }));
    return {
      getTotalSize: () => count * estimateSize(0),
      getVirtualItems: () => items,
    };
  }),
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
    {
      name: "Disabled",
      severity: "Critical",
      description: "Account is disabled",
    },
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

function makeBrowseResult(entries: DirectoryEntry[], hasMore = false) {
  return {
    entries,
    totalCount: entries.length + (hasMore ? 50 : 0),
    hasMore,
  };
}

function mockBrowseWith(
  entries: DirectoryEntry[],
  healthOverrides: Record<string, AccountHealthStatus> = {},
) {
  mockInvoke.mockImplementation(((
    cmd: string,
    args?: Record<string, unknown>,
  ) => {
    if (cmd === "browse_users")
      return Promise.resolve(makeBrowseResult(entries));
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

  it("renders with search bar and loads users on mount", async () => {
    const entries = [
      makeEntry("jdoe", "John Doe"),
      makeEntry("asmith", "Alice Smith"),
    ];
    mockBrowseWith(entries);

    render(<UserLookup />, { wrapper: TestProviders });
    expect(screen.getByTestId("user-lookup")).toBeInTheDocument();
    expect(screen.getByTestId("search-bar")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId("user-results-list")).toBeInTheDocument();
    });

    expect(screen.getByTestId("user-result-jdoe")).toBeInTheDocument();
    expect(screen.getByTestId("user-result-asmith")).toBeInTheDocument();
  });

  it("shows loading state during initial load", () => {
    mockInvoke.mockImplementation(
      (() => new Promise(() => {})) as typeof invoke,
    );
    render(<UserLookup />, { wrapper: TestProviders });
    expect(screen.getByTestId("user-lookup-loading")).toBeInTheDocument();
  });

  it("shows results list with users from browse", async () => {
    const entries = [
      makeEntry("jdoe", "John Doe"),
      makeEntry("asmith", "Alice Smith"),
    ];
    mockBrowseWith(entries);

    render(<UserLookup />, { wrapper: TestProviders });

    await waitFor(() => {
      expect(screen.getByTestId("user-results-list")).toBeInTheDocument();
    });

    expect(screen.getByTestId("user-result-jdoe")).toBeInTheDocument();
    expect(screen.getByTestId("user-result-asmith")).toBeInTheDocument();
  });

  it("shows error state on browse failure", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "browse_users")
        return Promise.reject(new Error("LDAP connection failed"));
      return Promise.resolve(HEALTHY_STATUS);
    }) as typeof invoke);

    render(<UserLookup />, { wrapper: TestProviders });

    await waitFor(() => {
      expect(screen.getByTestId("user-lookup-error")).toBeInTheDocument();
    });

    expect(screen.getByText("Failed to load users")).toBeInTheDocument();
  });

  it("shows retry button on error", async () => {
    let callCount = 0;
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "evaluate_health_cmd") return Promise.resolve(HEALTHY_STATUS);
      if (cmd === "browse_users") {
        callCount++;
        if (callCount === 1) return Promise.reject(new Error("fail"));
        return Promise.resolve(
          makeBrowseResult([makeEntry("jdoe", "John Doe")]),
        );
      }
      return Promise.resolve(null);
    }) as typeof invoke);

    render(<UserLookup />, { wrapper: TestProviders });

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
    mockBrowseWith(entries);

    render(<UserLookup />, { wrapper: TestProviders });

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
    mockBrowseWith(entries);

    render(<UserLookup />, { wrapper: TestProviders });

    await waitFor(() => {
      expect(screen.getByTestId("user-result-jdoe")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("user-result-jdoe"));

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
    mockBrowseWith(entries);

    render(<UserLookup />, { wrapper: TestProviders });

    await waitFor(() => {
      expect(screen.getByTestId("user-result-jdoe")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("user-result-jdoe"));

    await waitFor(() => {
      expect(screen.getByTestId("user-groups-section")).toBeInTheDocument();
    });

    expect(screen.getByText("Group Memberships (2)")).toBeInTheDocument();
    expect(screen.getByText("Domain Users")).toBeInTheDocument();
    expect(screen.getByText("Developers")).toBeInTheDocument();
  });

  it("shows health badges for users in results list", async () => {
    const entries = [
      makeEntry("jdoe", "John Doe"),
      makeEntry("disabled", "Disabled User", {
        userAccountControl: ["514"],
      }),
    ];
    mockBrowseWith(entries);

    render(<UserLookup />, { wrapper: TestProviders });

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

  it("calls browse_users on mount", async () => {
    mockBrowseWith([]);

    render(<UserLookup />, { wrapper: TestProviders });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("browse_users", {
        page: 0,
        pageSize: 50,
      });
    });
  });
});
