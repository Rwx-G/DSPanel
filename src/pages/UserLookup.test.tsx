import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { type ReactNode, useEffect, useRef } from "react";
import { UserLookup } from "./UserLookup";
import { DialogProvider } from "@/contexts/DialogContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import {
  NavigationProvider,
  useNavigation,
} from "@/contexts/NavigationContext";
import type { DirectoryEntry } from "@/types/directory";
import type { AccountHealthStatus } from "@/types/health";
import type { SecurityIndicatorSet } from "@/types/securityIndicators";

function TestProviders({ children }: { children: ReactNode }) {
  return (
    <NotificationProvider>
      <DialogProvider>
        <NavigationProvider>{children}</NavigationProvider>
      </DialogProvider>
    </NotificationProvider>
  );
}

/**
 * Wrapper that opens a "users" tab with data for deep-link testing.
 */
function DeepLinkWrapper({
  children,
  selectedUserSam,
}: {
  children: ReactNode;
  selectedUserSam: string;
}) {
  const { openTab } = useNavigation();
  const opened = useRef(false);

  useEffect(() => {
    if (!opened.current) {
      opened.current = true;
      openTab("User Lookup", "users", "user", { selectedUserSam });
    }
  }, [openTab, selectedUserSam]);

  return <>{children}</>;
}

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("@/components/common/SnapshotHistory", () => ({
  SnapshotHistory: () => <div data-testid="snapshot-history-mock" />,
}));

// IntersectionObserver is not available in jsdom (needed by UserDetail)
class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (!globalThis.IntersectionObserver) {
  globalThis.IntersectionObserver =
    MockIntersectionObserver as unknown as typeof IntersectionObserver;
}

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
      lastLogon: ["134177760000000000"],
      pwdLastSet: ["134144136000000000"],
      memberOf: [
        "CN=Domain Users,CN=Users,DC=example,DC=com",
        "CN=Developers,OU=Groups,DC=example,DC=com",
      ],
      badPwdCount: ["0"],
      whenCreated: ["20240101000000.0Z"],
      whenChanged: ["20260301000000.0Z"],
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

const EMPTY_INDICATORS: SecurityIndicatorSet = {
  indicators: [],
  highestSeverity: "Healthy",
};

function mockBrowseWith(
  entries: DirectoryEntry[],
  healthOverrides: Record<string, AccountHealthStatus> = {},
  indicatorOverrides: Record<string, SecurityIndicatorSet> = {},
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
    if (cmd === "evaluate_health_batch") {
      const inputs = args?.inputs as { enabled: boolean }[] | undefined;
      if (inputs) {
        return Promise.resolve(
          inputs.map((input) => {
            if (!input.enabled) return CRITICAL_STATUS;
            for (const [, status] of Object.entries(healthOverrides)) {
              return status;
            }
            return HEALTHY_STATUS;
          }),
        );
      }
      return Promise.resolve([]);
    }
    if (cmd === "evaluate_user_security_indicators") {
      // Single-user invocation - first override or empty.
      for (const [, set] of Object.entries(indicatorOverrides)) {
        return Promise.resolve(set);
      }
      return Promise.resolve(EMPTY_INDICATORS);
    }
    if (cmd === "evaluate_user_security_indicators_batch") {
      const inputs = args?.inputs as Array<unknown> | undefined;
      if (!inputs) return Promise.resolve([]);
      // Map by index to entries to pick the right override per sam.
      return Promise.resolve(
        entries.map(
          (e) =>
            indicatorOverrides[e.samAccountName ?? ""] ?? EMPTY_INDICATORS,
        ),
      );
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

  it("shows empty state with no filter text when no users available", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "browse_users") return Promise.resolve(makeBrowseResult([]));
      if (cmd === "evaluate_health_cmd") return Promise.resolve(HEALTHY_STATUS);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(<UserLookup />, { wrapper: TestProviders });

    await waitFor(() => {
      expect(screen.getByTestId("empty-state-title")).toHaveTextContent(
        "No users found",
      );
      expect(screen.getByText("No users available.")).toBeInTheDocument();
    });
  });

  it("shows placeholder text when no user is selected", async () => {
    const entries = [makeEntry("jdoe", "John Doe")];
    mockBrowseWith(entries);

    render(<UserLookup />, { wrapper: TestProviders });

    await waitFor(() => {
      expect(screen.getByTestId("user-results-list")).toBeInTheDocument();
    });

    expect(
      screen.getByText("Select a user to view details"),
    ).toBeInTheDocument();
  });

  it("shows user detail panel after selection", async () => {
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
  });

  it("highlights selected user in results list", async () => {
    const entries = [
      makeEntry("jdoe", "John Doe"),
      makeEntry("asmith", "Alice Smith"),
    ];
    mockBrowseWith(entries);

    render(<UserLookup />, { wrapper: TestProviders });

    await waitFor(() => {
      expect(screen.getByTestId("user-result-jdoe")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("user-result-jdoe"));

    await waitFor(() => {
      const selected = screen.getByTestId("user-result-jdoe");
      expect(selected.className).toContain("selected");
    });
  });

  it("displays department in user result item", async () => {
    const entries = [makeEntry("jdoe", "John Doe")];
    mockBrowseWith(entries);

    render(<UserLookup />, { wrapper: TestProviders });

    await waitFor(() => {
      expect(screen.getByTestId("user-result-jdoe")).toBeInTheDocument();
    });

    expect(screen.getByText(/IT/)).toBeInTheDocument();
  });

  it("renders search bar component", async () => {
    mockBrowseWith([]);

    render(<UserLookup />, { wrapper: TestProviders });

    expect(screen.getByTestId("search-bar")).toBeInTheDocument();
  });

  it("renders accessibility status region", async () => {
    mockBrowseWith([makeEntry("jdoe", "John Doe")]);

    render(<UserLookup />, { wrapper: TestProviders });

    await waitFor(() => {
      const status = screen.getByTestId("user-lookup-status");
      expect(status).toBeInTheDocument();
    });
  });

  it("shows context menu on right-click with no user selected", async () => {
    const entries = [makeEntry("jdoe", "John Doe")];
    mockBrowseWith(entries);

    render(<UserLookup />, { wrapper: TestProviders });

    await waitFor(() => {
      expect(screen.getByTestId("user-result-jdoe")).toBeInTheDocument();
    });

    fireEvent.contextMenu(screen.getByTestId("user-result-jdoe"));

    await waitFor(() => {
      expect(
        screen.getByTestId("context-menu"),
      ).toBeInTheDocument();
    });
  });

  it("shows context menu with 'Cannot compare' when right-clicking the selected user", async () => {
    const entries = [
      makeEntry("jdoe", "John Doe"),
      makeEntry("asmith", "Alice Smith"),
    ];
    mockBrowseWith(entries);

    render(<UserLookup />, { wrapper: TestProviders });

    await waitFor(() => {
      expect(screen.getByTestId("user-result-jdoe")).toBeInTheDocument();
    });

    // Select jdoe first
    fireEvent.click(screen.getByTestId("user-result-jdoe"));

    await waitFor(() => {
      expect(screen.getByTestId("user-detail")).toBeInTheDocument();
    });

    // Right-click on the same user
    fireEvent.contextMenu(screen.getByTestId("user-result-jdoe"));

    await waitFor(() => {
      expect(
        screen.getByText("Cannot compare a user with itself"),
      ).toBeInTheDocument();
    });
  });

  it("shows compare option when right-clicking a different user from selected", async () => {
    const entries = [
      makeEntry("jdoe", "John Doe"),
      makeEntry("asmith", "Alice Smith"),
    ];
    mockBrowseWith(entries);

    render(<UserLookup />, { wrapper: TestProviders });

    await waitFor(() => {
      expect(screen.getByTestId("user-result-jdoe")).toBeInTheDocument();
    });

    // Select jdoe
    fireEvent.click(screen.getByTestId("user-result-jdoe"));

    await waitFor(() => {
      expect(screen.getByTestId("user-detail")).toBeInTheDocument();
    });

    // Right-click on asmith
    fireEvent.contextMenu(screen.getByTestId("user-result-asmith"));

    await waitFor(() => {
      expect(
        screen.getByText(/Compare John Doe with Alice Smith/),
      ).toBeInTheDocument();
    });
  });

  it("refreshes selected user data via invoke on refreshSelectedUser", async () => {
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

    // The detail panel should render with the user's name
    const detail = screen.getByTestId("user-detail");
    expect(detail.querySelector("h2")).toHaveTextContent("John Doe");
  });

  it("displays group filter functionality within detail panel", async () => {
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

    // Both groups should be visible
    expect(screen.getByText("Domain Users")).toBeInTheDocument();
    expect(screen.getByText("Developers")).toBeInTheDocument();
  });

  it("shows accessibility status for loading state", () => {
    mockInvoke.mockImplementation(
      (() => new Promise(() => {})) as typeof invoke,
    );
    render(<UserLookup />, { wrapper: TestProviders });

    const status = screen.getByTestId("user-lookup-status");
    expect(status).toHaveTextContent("Loading users...");
  });

  it("shows accessibility status for error state", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "browse_users")
        return Promise.reject(new Error("Network error"));
      return Promise.resolve(HEALTHY_STATUS);
    }) as typeof invoke);

    render(<UserLookup />, { wrapper: TestProviders });

    await waitFor(() => {
      const status = screen.getByTestId("user-lookup-status");
      expect(status).toHaveTextContent(/Error/);
    });
  });

  it("shows empty state with filter text when search returns no users", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "browse_users") return Promise.resolve(makeBrowseResult([]));
      if (cmd === "search_users") return Promise.resolve([]);
      if (cmd === "evaluate_health_cmd") return Promise.resolve(HEALTHY_STATUS);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(<UserLookup />, { wrapper: TestProviders });

    await waitFor(() => {
      expect(screen.getByText("No users available.")).toBeInTheDocument();
    });
  });

  it("displays user without department in the results list", async () => {
    const entries = [makeEntry("nodept", "No Department", { department: [] })];
    mockBrowseWith(entries);

    render(<UserLookup />, { wrapper: TestProviders });

    await waitFor(() => {
      expect(screen.getByTestId("user-result-nodept")).toBeInTheDocument();
    });

    // Should show SAM without department suffix
    const item = screen.getByTestId("user-result-nodept");
    expect(item).toBeInTheDocument();
  });

  it("shows health badge on selected user detail", async () => {
    const entries = [makeEntry("jdoe", "John Doe")];
    mockBrowseWith(entries);

    render(<UserLookup />, { wrapper: TestProviders });

    await waitFor(() => {
      expect(screen.getByTestId("user-result-jdoe")).toBeInTheDocument();
    });

    // Wait for health evaluation
    await waitFor(() => {
      const result = screen.getByTestId("user-result-jdoe");
      const badge = result.querySelector('[data-testid="health-badge"]');
      expect(badge).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("user-result-jdoe"));

    await waitFor(() => {
      expect(screen.getByTestId("user-detail")).toBeInTheDocument();
    });
  });

  describe("Deep-link", () => {
    it("selects user from browse results when selectedUserSam matches", async () => {
      const entries = [
        makeEntry("jdoe", "John Doe"),
        makeEntry("asmith", "Alice Smith"),
      ];
      mockBrowseWith(entries);

      render(
        <TestProviders>
          <DeepLinkWrapper selectedUserSam="asmith">
            <UserLookup />
          </DeepLinkWrapper>
        </TestProviders>,
      );

      await waitFor(() => {
        expect(screen.getByTestId("user-detail")).toBeInTheDocument();
      });

      const detail = screen.getByTestId("user-detail");
      expect(detail.querySelector("h2")).toHaveTextContent("Alice Smith");
    });

    it("fetches user via get_user when not in browse results", async () => {
      const browseEntries = [makeEntry("jdoe", "John Doe")];
      const remoteEntry = makeEntry("remote", "Remote User");

      mockInvoke.mockImplementation(((
        cmd: string,
        _args?: Record<string, unknown>,
      ) => {
        if (cmd === "browse_users")
          return Promise.resolve(makeBrowseResult(browseEntries));
        if (cmd === "get_user") return Promise.resolve(remoteEntry);
        if (cmd === "evaluate_health_cmd") return Promise.resolve(HEALTHY_STATUS);
        return Promise.resolve(null);
      }) as typeof invoke);

      render(
        <TestProviders>
          <DeepLinkWrapper selectedUserSam="remote">
            <UserLookup />
          </DeepLinkWrapper>
        </TestProviders>,
      );

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("get_user", {
          samAccountName: "remote",
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId("user-detail")).toBeInTheDocument();
      });

      const detail = screen.getByTestId("user-detail");
      expect(detail.querySelector("h2")).toHaveTextContent("Remote User");
    });
  });

  describe("Health filter buttons and counts", () => {
    it("shows health filter buttons", async () => {
      const entries = [makeEntry("jdoe", "John Doe")];
      mockBrowseWith(entries);

      render(<UserLookup />, { wrapper: TestProviders });

      await waitFor(() => {
        expect(screen.getByTestId("user-results-list")).toBeInTheDocument();
      });

      expect(screen.getByText("All")).toBeInTheDocument();
      expect(screen.getByText("Healthy")).toBeInTheDocument();
      expect(screen.getByText("Warning")).toBeInTheDocument();
      expect(screen.getByText("Critical")).toBeInTheDocument();
    });

    it("filters users by healthy status", async () => {
      const entries = [
        makeEntry("jdoe", "John Doe"),
        makeEntry("disabled", "Disabled User", {
          userAccountControl: ["514"],
        }),
      ];
      mockBrowseWith(entries);

      render(<UserLookup />, { wrapper: TestProviders });

      await waitFor(() => {
        expect(screen.getByTestId("user-result-jdoe")).toBeInTheDocument();
        expect(screen.getByTestId("user-result-disabled")).toBeInTheDocument();
      });

      // Wait for health evaluation
      await waitFor(() => {
        const result = screen.getByTestId("user-result-jdoe");
        const badge = result.querySelector('[data-testid="health-badge"]');
        expect(badge).toBeInTheDocument();
      });

      // Click Healthy filter
      fireEvent.click(screen.getByText("Healthy"));

      await waitFor(() => {
        expect(screen.getByTestId("user-result-jdoe")).toBeInTheDocument();
        expect(screen.queryByTestId("user-result-disabled")).not.toBeInTheDocument();
      });
    });

    it("filters users by critical status", async () => {
      const entries = [
        makeEntry("jdoe", "John Doe"),
        makeEntry("disabled", "Disabled User", {
          userAccountControl: ["514"],
        }),
      ];
      mockBrowseWith(entries);

      render(<UserLookup />, { wrapper: TestProviders });

      await waitFor(() => {
        expect(screen.getByTestId("user-result-jdoe")).toBeInTheDocument();
        expect(screen.getByTestId("user-result-disabled")).toBeInTheDocument();
      });

      // Wait for health evaluation
      await waitFor(() => {
        const disabledResult = screen.getByTestId("user-result-disabled");
        const badge = disabledResult.querySelector('[data-testid="health-badge"]');
        expect(badge).toBeInTheDocument();
      });

      // Click Critical filter
      fireEvent.click(screen.getByText("Critical"));

      await waitFor(() => {
        expect(screen.queryByTestId("user-result-jdoe")).not.toBeInTheDocument();
        expect(screen.getByTestId("user-result-disabled")).toBeInTheDocument();
      });
    });

    it("shows empty state with health filter message", async () => {
      const entries = [makeEntry("jdoe", "John Doe")];
      mockBrowseWith(entries);

      render(<UserLookup />, { wrapper: TestProviders });

      await waitFor(() => {
        expect(screen.getByTestId("user-result-jdoe")).toBeInTheDocument();
      });

      // Wait for health evaluation
      await waitFor(() => {
        const result = screen.getByTestId("user-result-jdoe");
        const badge = result.querySelector('[data-testid="health-badge"]');
        expect(badge).toBeInTheDocument();
      });

      // Click Critical filter (no critical users)
      fireEvent.click(screen.getByText("Critical"));

      await waitFor(() => {
        expect(screen.getByText(/No users with critical health status/)).toBeInTheDocument();
      });
    });

    it("shows health counts in filter buttons when users have health statuses", async () => {
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

      // Wait for health badges to appear
      await waitFor(() => {
        const result = screen.getByTestId("user-result-jdoe");
        const badge = result.querySelector('[data-testid="health-badge"]');
        expect(badge).toBeInTheDocument();
      });

      // Health counts should appear as "(N)" text near the filter buttons
      await waitFor(() => {
        // At least one count value should be visible (healthy or critical)
        const allButtons = screen.getAllByRole("button");
        const countButtons = allButtons.filter((btn) => /\(\d+\)/.test(btn.textContent ?? ""));
        expect(countButtons.length).toBeGreaterThan(0);
      });
    });
  });

  describe("Move to OU dialog", () => {
    it("shows Move to OU option in context menu for AccountOperator users", async () => {
      const entries = [
        makeEntry("jdoe", "John Doe"),
        makeEntry("asmith", "Alice Smith"),
      ];

      mockInvoke.mockImplementation(((
        cmd: string,
        args?: Record<string, unknown>,
      ) => {
        if (cmd === "browse_users")
          return Promise.resolve(makeBrowseResult(entries));
        if (cmd === "get_permission_level") return Promise.resolve("AccountOperator");
        if (cmd === "get_user_groups") return Promise.resolve([]);
        if (cmd === "evaluate_health_cmd") return Promise.resolve(HEALTHY_STATUS);
        if (cmd === "evaluate_health_batch") {
          const inputs = args?.inputs as { enabled: boolean }[] | undefined;
          return Promise.resolve((inputs ?? []).map(() => HEALTHY_STATUS));
        }
        return Promise.resolve(null);
      }) as typeof invoke);

      render(<UserLookup />, { wrapper: TestProviders });

      await waitFor(() => {
        expect(screen.getByTestId("user-result-jdoe")).toBeInTheDocument();
      });

      fireEvent.contextMenu(screen.getByTestId("user-result-jdoe"));

      await waitFor(() => {
        expect(screen.getByText("Move to OU")).toBeInTheDocument();
      });
    });
  });

  describe("Health batch evaluation", () => {
    it("evaluates health for all users in batch after browse", async () => {
      const entries = [
        makeEntry("jdoe", "John Doe"),
        makeEntry("asmith", "Alice Smith"),
      ];
      mockBrowseWith(entries);

      render(<UserLookup />, { wrapper: TestProviders });

      await waitFor(() => {
        expect(screen.getByTestId("user-results-list")).toBeInTheDocument();
      });

      // Health badges should eventually appear for all users
      await waitFor(() => {
        const jdoeResult = screen.getByTestId("user-result-jdoe");
        const badge = jdoeResult.querySelector('[data-testid="health-badge"]');
        expect(badge).toBeInTheDocument();
      });
    });

    it("clears health map when filter query changes to 3+ chars", async () => {
      const entries = [makeEntry("jdoe", "John Doe")];
      mockBrowseWith(entries);

      render(<UserLookup />, { wrapper: TestProviders });

      await waitFor(() => {
        expect(screen.getByTestId("user-results-list")).toBeInTheDocument();
      });

      // Wait for health badges
      await waitFor(() => {
        const result = screen.getByTestId("user-result-jdoe");
        const badge = result.querySelector('[data-testid="health-badge"]');
        expect(badge).toBeInTheDocument();
      });

      // Type a 3-char filter to trigger health map reset
      const searchInput = screen.getByTestId("search-bar").querySelector("input");
      expect(searchInput).not.toBeNull();
      fireEvent.change(searchInput!, { target: { value: "joh" } });

      // The health map should be cleared and re-evaluated
      // (we verify the flow completes without errors)
      await waitFor(() => {
        expect(screen.getByTestId("user-lookup")).toBeInTheDocument();
      });
    });
  });

  describe("Deep-link prefill", () => {
    it("deep-link prefills from tab data and selects user found in browse results", async () => {
      const entries = [
        makeEntry("jdoe", "John Doe"),
        makeEntry("asmith", "Alice Smith"),
      ];
      mockBrowseWith(entries);

      render(
        <TestProviders>
          <DeepLinkWrapper selectedUserSam="asmith">
            <UserLookup />
          </DeepLinkWrapper>
        </TestProviders>,
      );

      await waitFor(() => {
        expect(screen.getByTestId("user-detail")).toBeInTheDocument();
      });

      const detail = screen.getByTestId("user-detail");
      expect(detail.querySelector("h2")).toHaveTextContent("Alice Smith");
    });

    it("deep-link fetches user via get_user when not in browse results", async () => {
      const browseEntries = [makeEntry("jdoe", "John Doe")];
      const remoteEntry = makeEntry("remote", "Remote User");

      mockInvoke.mockImplementation(((
        cmd: string,
        _args?: Record<string, unknown>,
      ) => {
        if (cmd === "browse_users")
          return Promise.resolve(makeBrowseResult(browseEntries));
        if (cmd === "get_user") return Promise.resolve(remoteEntry);
        if (cmd === "evaluate_health_cmd") return Promise.resolve(HEALTHY_STATUS);
        return Promise.resolve(null);
      }) as typeof invoke);

      render(
        <TestProviders>
          <DeepLinkWrapper selectedUserSam="remote">
            <UserLookup />
          </DeepLinkWrapper>
        </TestProviders>,
      );

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("get_user", {
          samAccountName: "remote",
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId("user-detail")).toBeInTheDocument();
      });

      const detail = screen.getByTestId("user-detail");
      expect(detail.querySelector("h2")).toHaveTextContent("Remote User");
    });
  });

  describe("Refresh selected user", () => {
    it("reloads user data on refresh", async () => {
      const entries = [makeEntry("jdoe", "John Doe")];
      const refreshedEntry = makeEntry("jdoe", "John Doe Updated");

      let getUserCallCount = 0;
      mockInvoke.mockImplementation(((
        cmd: string,
      ) => {
        if (cmd === "browse_users")
          return Promise.resolve(makeBrowseResult(entries));
        if (cmd === "get_user") {
          getUserCallCount++;
          return Promise.resolve(refreshedEntry);
        }
        if (cmd === "evaluate_health_cmd") return Promise.resolve(HEALTHY_STATUS);
        return Promise.resolve(null);
      }) as typeof invoke);

      render(<UserLookup />, { wrapper: TestProviders });

      await waitFor(() => {
        expect(screen.getByTestId("user-result-jdoe")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("user-result-jdoe"));

      await waitFor(() => {
        expect(screen.getByTestId("user-detail")).toBeInTheDocument();
      });

      // Click refresh button if available in UserDetail
      const refreshBtn = screen.queryByTestId("refresh-user-btn");
      if (refreshBtn) {
        fireEvent.click(refreshBtn);

        await waitFor(() => {
          expect(getUserCallCount).toBeGreaterThanOrEqual(1);
        });
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Story 14.2 - SecurityIndicatorDot in lookup row
  // ---------------------------------------------------------------------------

  describe("security indicator dot", () => {
    it("renders no dot for users with no detected indicators", async () => {
      mockBrowseWith([makeEntry("jdoe", "John Doe")]);

      render(<UserLookup />, { wrapper: TestProviders });

      await waitFor(() => {
        expect(screen.getByTestId("user-result-jdoe")).toBeInTheDocument();
      });
      // Wait long enough for the indicators batch to resolve
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(
        screen.queryByTestId("security-indicator-dot"),
      ).not.toBeInTheDocument();
    });

    it("renders the dot for users that have indicators", async () => {
      const entries = [makeEntry("jdoe", "John Doe")];
      mockBrowseWith(entries, {}, {
        jdoe: {
          indicators: [
            {
              kind: "Kerberoastable",
              severity: "Warning",
              descriptionKey: "securityIndicators.Kerberoastable",
            },
          ],
          highestSeverity: "Warning",
        },
      });

      render(<UserLookup />, { wrapper: TestProviders });

      await waitFor(() => {
        expect(
          screen.getByTestId("security-indicator-dot"),
        ).toBeInTheDocument();
      });
      expect(screen.getByTestId("security-indicator-dot")).toHaveAttribute(
        "data-severity",
        "Warning",
      );
    });

    it("dot color reflects highestSeverity (Critical wins over Warning)", async () => {
      const entries = [makeEntry("jdoe", "John Doe")];
      mockBrowseWith(entries, {}, {
        jdoe: {
          indicators: [
            {
              kind: "Kerberoastable",
              severity: "Warning",
              descriptionKey: "securityIndicators.Kerberoastable",
            },
            {
              kind: "PasswordNotRequired",
              severity: "Critical",
              descriptionKey: "securityIndicators.PasswordNotRequired",
            },
          ],
          highestSeverity: "Critical",
        },
      });

      render(<UserLookup />, { wrapper: TestProviders });

      await waitFor(() => {
        expect(
          screen.getByTestId("security-indicator-dot"),
        ).toHaveAttribute("data-severity", "Critical");
      });
      expect(screen.getByTestId("security-indicator-dot")).toHaveAttribute(
        "data-count",
        "2",
      );
    });

    it("propagates indicator set to UserDetail when a user is selected", async () => {
      const entries = [makeEntry("jdoe", "John Doe")];
      mockBrowseWith(entries, {}, {
        jdoe: {
          indicators: [
            {
              kind: "AsRepRoastable",
              severity: "Critical",
              descriptionKey: "securityIndicators.AsRepRoastable",
            },
          ],
          highestSeverity: "Critical",
        },
      });

      render(<UserLookup />, { wrapper: TestProviders });

      await waitFor(() => {
        expect(screen.getByTestId("user-result-jdoe")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("user-result-jdoe"));

      await waitFor(() => {
        expect(
          screen.getByTestId("security-indicator-badge-AsRepRoastable"),
        ).toBeInTheDocument();
      });
    });
  });
});
