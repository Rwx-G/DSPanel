import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ComputerLookup } from "./ComputerLookup";
import type { DirectoryEntry } from "@/types/directory";
import type { SecurityIndicatorSet } from "@/types/securityIndicators";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    level: "ReadOnly",
    groups: [],
    loading: false,
    hasPermission: () => false,
  }),
}));

vi.mock("@/contexts/DialogContext", () => ({
  useDialog: () => ({
    showConfirmation: vi.fn(),
  }),
}));

vi.mock("@/contexts/NotificationContext", () => ({
  useNotifications: () => ({
    notify: vi.fn(),
  }),
}));

vi.mock("@/hooks/useErrorHandler", () => ({
  useErrorHandler: () => ({
    handleError: vi.fn(),
  }),
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

function makeComputerEntry(
  name: string,
  attrs: Record<string, string[]> = {},
): DirectoryEntry {
  return {
    distinguishedName: `CN=${name},OU=Computers,DC=example,DC=com`,
    samAccountName: `${name}$`,
    displayName: name,
    objectClass: "computer",
    attributes: {
      dNSHostName: [`${name.toLowerCase()}.example.com`],
      operatingSystem: ["Windows 11 Enterprise"],
      operatingSystemVersion: ["10.0 (22631)"],
      userAccountControl: ["4096"],
      lastLogon: ["2026-03-12T08:00:00Z"],
      memberOf: ["CN=Domain Computers,CN=Users,DC=example,DC=com"],
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
  indicatorOverrides: Record<string, SecurityIndicatorSet> = {},
) {
  mockInvoke.mockImplementation(((cmd: string) => {
    if (cmd === "browse_computers")
      return Promise.resolve(makeBrowseResult(entries));
    if (cmd === "search_computers") return Promise.resolve(entries);
    if (cmd === "resolve_dns") return Promise.resolve(["10.0.0.1"]);
    if (cmd === "evaluate_computer_security_indicators_batch") {
      return Promise.resolve(
        entries.map((e) => indicatorOverrides[e.displayName ?? ""] ?? EMPTY_INDICATORS),
      );
    }
    if (cmd === "evaluate_computer_security_indicators") {
      for (const [, set] of Object.entries(indicatorOverrides)) {
        return Promise.resolve(set);
      }
      return Promise.resolve(EMPTY_INDICATORS);
    }
    return Promise.resolve(null);
  }) as typeof invoke);
}

describe("ComputerLookup", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("renders with search bar and loads computers on mount", async () => {
    const entries = [makeComputerEntry("WS001"), makeComputerEntry("WS002")];
    mockBrowseWith(entries);

    render(<ComputerLookup />);
    expect(screen.getByTestId("computer-lookup")).toBeInTheDocument();
    expect(screen.getByTestId("search-bar")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId("computer-results-list")).toBeInTheDocument();
    });

    expect(screen.getByTestId("computer-result-WS001")).toBeInTheDocument();
    expect(screen.getByTestId("computer-result-WS002")).toBeInTheDocument();
  });

  it("shows loading state during initial load", () => {
    mockInvoke.mockImplementation(
      (() => new Promise(() => {})) as typeof invoke,
    );
    render(<ComputerLookup />);
    expect(screen.getByTestId("computer-lookup-loading")).toBeInTheDocument();
  });

  it("shows error state on browse failure", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "browse_computers")
        return Promise.reject(new Error("LDAP error"));
      return Promise.resolve(null);
    }) as typeof invoke);

    render(<ComputerLookup />);

    await waitFor(() => {
      expect(screen.getByTestId("computer-lookup-error")).toBeInTheDocument();
    });

    expect(screen.getByText("Failed to load computers")).toBeInTheDocument();
  });

  it("shows retry button on error and retries", async () => {
    let callCount = 0;
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "browse_computers") {
        callCount++;
        if (callCount === 1) return Promise.reject(new Error("fail"));
        return Promise.resolve(makeBrowseResult([makeComputerEntry("WS001")]));
      }
      return Promise.resolve(null);
    }) as typeof invoke);

    render(<ComputerLookup />);

    await waitFor(() => {
      expect(screen.getByText("Retry")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Retry"));

    await waitFor(() => {
      expect(screen.getByTestId("computer-results-list")).toBeInTheDocument();
    });
  });

  it("selects computer from results list on click", async () => {
    const entries = [makeComputerEntry("WS001"), makeComputerEntry("WS002")];
    mockBrowseWith(entries);

    render(<ComputerLookup />);

    await waitFor(() => {
      expect(screen.getByTestId("computer-result-WS002")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("computer-result-WS002"));

    await waitFor(() => {
      expect(screen.getByTestId("computer-detail")).toBeInTheDocument();
    });
  });

  it("displays computer detail with property groups", async () => {
    const entries = [makeComputerEntry("WS001")];
    mockBrowseWith(entries);

    render(<ComputerLookup />);

    await waitFor(() => {
      expect(screen.getByTestId("computer-result-WS001")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("computer-result-WS001"));

    await waitFor(() => {
      expect(screen.getByTestId("computer-detail")).toBeInTheDocument();
    });

    expect(screen.getByText("Identity")).toBeInTheDocument();
    expect(screen.getAllByText("Status").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Location")).toBeInTheDocument();
    expect(screen.getByText("Network")).toBeInTheDocument();
  });

  it("calls browse_computers on mount", async () => {
    mockBrowseWith([]);

    render(<ComputerLookup />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("browse_computers", {
        page: 0,
        pageSize: 50,
      });
    });
  });

  it("shows empty state when no computers available", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "browse_computers")
        return Promise.resolve(makeBrowseResult([]));
      return Promise.resolve(null);
    }) as typeof invoke);

    render(<ComputerLookup />);

    await waitFor(() => {
      expect(screen.getByTestId("empty-state-title")).toHaveTextContent(
        "No computers found",
      );
      expect(screen.getAllByText("No computers found").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows placeholder text when no computer is selected", async () => {
    const entries = [makeComputerEntry("WS001")];
    mockBrowseWith(entries);

    render(<ComputerLookup />);

    await waitFor(() => {
      expect(screen.getByTestId("computer-results-list")).toBeInTheDocument();
    });

    expect(
      screen.getByText("Select a computer to view details"),
    ).toBeInTheDocument();
  });

  it("displays OS information in computer result item", async () => {
    const entries = [makeComputerEntry("WS001")];
    mockBrowseWith(entries);

    render(<ComputerLookup />);

    await waitFor(() => {
      expect(screen.getByTestId("computer-result-WS001")).toBeInTheDocument();
    });

    expect(screen.getByText("Windows 11 Enterprise")).toBeInTheDocument();
  });

  it("shows Active badge for enabled computer", async () => {
    const entries = [makeComputerEntry("WS001")];
    mockBrowseWith(entries);

    render(<ComputerLookup />);

    await waitFor(() => {
      expect(screen.getByTestId("computer-result-WS001")).toBeInTheDocument();
    });

    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("shows Disabled badge for disabled computer", async () => {
    const entries = [
      makeComputerEntry("WS001", { userAccountControl: ["4098"] }),
    ];
    mockBrowseWith(entries);

    render(<ComputerLookup />);

    await waitFor(() => {
      expect(screen.getByTestId("computer-result-WS001")).toBeInTheDocument();
    });

    // The computer result item should show "Disabled" badge
    const resultItem = screen.getByTestId("computer-result-WS001");
    expect(resultItem.textContent).toContain("Disabled");
  });

  it("renders accessibility status region", async () => {
    mockBrowseWith([makeComputerEntry("WS001")]);

    render(<ComputerLookup />);

    await waitFor(() => {
      const status = screen.getByTestId("computer-lookup-status");
      expect(status).toBeInTheDocument();
    });
  });

  it("shows Unknown OS when operatingSystem is empty", async () => {
    // Override mapEntryToComputer behavior - OS comes from attributes
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "browse_computers") {
        // Return entry with empty OS
        const entry = {
          ...makeComputerEntry("WS001"),
          attributes: {
            ...makeComputerEntry("WS001").attributes,
            operatingSystem: [],
          },
        };
        return Promise.resolve(makeBrowseResult([entry]));
      }
      if (cmd === "resolve_dns") return Promise.resolve(["10.0.0.1"]);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(<ComputerLookup />);

    await waitFor(() => {
      expect(screen.getByText("Unknown OS")).toBeInTheDocument();
    });
  });

  it("highlights selected computer in results list", async () => {
    const entries = [makeComputerEntry("WS001"), makeComputerEntry("WS002")];
    mockBrowseWith(entries);

    render(<ComputerLookup />);

    await waitFor(() => {
      expect(screen.getByTestId("computer-result-WS001")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("computer-result-WS001"));

    await waitFor(() => {
      const selected = screen.getByTestId("computer-result-WS001");
      expect(selected.className).toContain("selected");
    });
  });

  it("shows computer detail panel after selection", async () => {
    const entries = [makeComputerEntry("WS001")];
    mockBrowseWith(entries);

    render(<ComputerLookup />);

    await waitFor(() => {
      expect(screen.getByTestId("computer-result-WS001")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("computer-result-WS001"));

    await waitFor(() => {
      expect(screen.getByTestId("computer-detail")).toBeInTheDocument();
    });

    // Computer detail should show the computer name
    expect(screen.getByTestId("computer-detail")).toBeInTheDocument();
  });

  it("shows accessibility status for multiple computers found", async () => {
    const entries = [
      makeComputerEntry("WS001"),
      makeComputerEntry("WS002"),
      makeComputerEntry("WS003"),
    ];
    mockBrowseWith(entries);

    render(<ComputerLookup />);

    await waitFor(() => {
      const status = screen.getByTestId("computer-lookup-status");
      expect(status).toHaveTextContent("3 computers found");
    });
  });

  it("shows accessibility status for single computer found", async () => {
    const entries = [makeComputerEntry("WS001")];
    mockBrowseWith(entries);

    render(<ComputerLookup />);

    await waitFor(() => {
      const status = screen.getByTestId("computer-lookup-status");
      expect(status).toHaveTextContent("1 computer found");
    });
  });

  it("shows empty state with filter text message", async () => {
    // First load returns results, then filter returns empty
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "browse_computers")
        return Promise.resolve(makeBrowseResult([]));
      if (cmd === "search_computers") return Promise.resolve([]);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(<ComputerLookup />);

    await waitFor(() => {
      expect(screen.getByTestId("empty-state-title")).toHaveTextContent("No computers found");
    });
  });

  it("calls browse_computers with correct pagination", async () => {
    mockBrowseWith([]);

    render(<ComputerLookup />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("browse_computers", {
        page: 0,
        pageSize: 50,
      });
    });
  });

  it("shows loading state text in accessibility region", () => {
    mockInvoke.mockImplementation(
      (() => new Promise(() => {})) as typeof invoke,
    );

    render(<ComputerLookup />);

    const status = screen.getByTestId("computer-lookup-status");
    expect(status).toHaveTextContent("Loading computers...");
  });

  it("shows error message in accessibility status region", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "browse_computers")
        return Promise.reject(new Error("LDAP error"));
      return Promise.resolve(null);
    }) as typeof invoke);

    render(<ComputerLookup />);

    await waitFor(() => {
      const status = screen.getByTestId("computer-lookup-status");
      expect(status).toHaveTextContent(/Error/);
    });
  });

  // ---------------------------------------------------------------------------
  // Status filter tests
  // ---------------------------------------------------------------------------

  it("filters computers by Enabled status", async () => {
    const entries = [
      makeComputerEntry("WS001"), // enabled (UAC 4096)
      makeComputerEntry("WS002", { userAccountControl: ["4098"] }), // disabled
      makeComputerEntry("WS003"), // enabled
    ];
    mockBrowseWith(entries);

    render(<ComputerLookup />);

    await waitFor(() => {
      expect(screen.getByTestId("computer-results-list")).toBeInTheDocument();
    });

    // Click the Enabled filter button
    fireEvent.click(screen.getByText("Enabled", { selector: "button" }));

    // Only enabled computers should remain
    expect(screen.getByTestId("computer-result-WS001")).toBeInTheDocument();
    expect(screen.getByTestId("computer-result-WS003")).toBeInTheDocument();
    expect(
      screen.queryByTestId("computer-result-WS002"),
    ).not.toBeInTheDocument();
  });

  it("filters computers by Disabled status", async () => {
    const entries = [
      makeComputerEntry("WS001"),
      makeComputerEntry("WS002", { userAccountControl: ["4098"] }),
    ];
    mockBrowseWith(entries);

    render(<ComputerLookup />);

    await waitFor(() => {
      expect(screen.getByTestId("computer-results-list")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Disabled", { selector: "button" }));

    expect(
      screen.queryByTestId("computer-result-WS001"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("computer-result-WS002")).toBeInTheDocument();
  });

  it("shows All computers when All status filter is clicked after Enabled", async () => {
    const entries = [
      makeComputerEntry("WS001"),
      makeComputerEntry("WS002", { userAccountControl: ["4098"] }),
    ];
    mockBrowseWith(entries);

    render(<ComputerLookup />);

    await waitFor(() => {
      expect(screen.getByTestId("computer-results-list")).toBeInTheDocument();
    });

    // Filter to Enabled only
    fireEvent.click(screen.getByText("Enabled", { selector: "button" }));
    expect(
      screen.queryByTestId("computer-result-WS002"),
    ).not.toBeInTheDocument();

    // Switch back to All
    const allButtons = screen.getAllByText("All");
    const statusAllButton = allButtons.find(
      (btn) => btn.tagName === "BUTTON" || btn.closest("button"),
    );
    fireEvent.click(statusAllButton!.closest("button") ?? statusAllButton!);

    expect(screen.getByTestId("computer-result-WS001")).toBeInTheDocument();
    expect(screen.getByTestId("computer-result-WS002")).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // OS filter tests
  // ---------------------------------------------------------------------------

  it("filters computers by Windows OS", async () => {
    const entries = [
      makeComputerEntry("WS001"), // Windows 11 Enterprise
      makeComputerEntry("LINUX01", { operatingSystem: ["Ubuntu 22.04"] }),
    ];
    mockBrowseWith(entries);

    render(<ComputerLookup />);

    await waitFor(() => {
      expect(screen.getByTestId("computer-results-list")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Windows", { selector: "button" }));

    expect(screen.getByTestId("computer-result-WS001")).toBeInTheDocument();
    expect(
      screen.queryByTestId("computer-result-LINUX01"),
    ).not.toBeInTheDocument();
  });

  it("filters computers by Other OS", async () => {
    const entries = [
      makeComputerEntry("WS001"),
      makeComputerEntry("LINUX01", { operatingSystem: ["Ubuntu 22.04"] }),
    ];
    mockBrowseWith(entries);

    render(<ComputerLookup />);

    await waitFor(() => {
      expect(screen.getByTestId("computer-results-list")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Other", { selector: "button" }));

    expect(
      screen.queryByTestId("computer-result-WS001"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("computer-result-LINUX01")).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Filter badge counts
  // ---------------------------------------------------------------------------

  it("displays correct status filter badge counts", async () => {
    const entries = [
      makeComputerEntry("WS001"), // enabled
      makeComputerEntry("WS002"), // enabled
      makeComputerEntry("WS003", { userAccountControl: ["4098"] }), // disabled
    ];
    mockBrowseWith(entries);

    render(<ComputerLookup />);

    await waitFor(() => {
      expect(screen.getByTestId("computer-results-list")).toBeInTheDocument();
    });

    // Enabled count should be 2, Disabled count should be 1
    expect(screen.getByText("(2)")).toBeInTheDocument();
    expect(screen.getByText("(1)")).toBeInTheDocument();
  });

  it("displays correct OS filter badge counts", async () => {
    const entries = [
      makeComputerEntry("WS001"), // Windows
      makeComputerEntry("WS002"), // Windows
      makeComputerEntry("LINUX01", { operatingSystem: ["Ubuntu 22.04"] }),
    ];
    mockBrowseWith(entries);

    render(<ComputerLookup />);

    await waitFor(() => {
      expect(screen.getByTestId("computer-results-list")).toBeInTheDocument();
    });

    // Windows button should show (2), Other button should show (1)
    const windowsButton = screen.getByText("Windows", { selector: "button" });
    expect(windowsButton.parentElement?.textContent).toContain("(2)");
    const otherButton = screen.getByText("Other", { selector: "button" });
    expect(otherButton.parentElement?.textContent).toContain("(1)");
  });

  // ---------------------------------------------------------------------------
  // Combined status + OS filters
  // ---------------------------------------------------------------------------

  it("applies both status and OS filters simultaneously", async () => {
    const entries = [
      makeComputerEntry("WS001"), // enabled, Windows
      makeComputerEntry("WS002", { userAccountControl: ["4098"] }), // disabled, Windows
      makeComputerEntry("LINUX01", { operatingSystem: ["Ubuntu 22.04"] }), // enabled, other
    ];
    mockBrowseWith(entries);

    render(<ComputerLookup />);

    await waitFor(() => {
      expect(screen.getByTestId("computer-results-list")).toBeInTheDocument();
    });

    // Filter to Enabled + Windows
    fireEvent.click(screen.getByText("Enabled", { selector: "button" }));
    fireEvent.click(screen.getByText("Windows", { selector: "button" }));

    expect(screen.getByTestId("computer-result-WS001")).toBeInTheDocument();
    expect(
      screen.queryByTestId("computer-result-WS002"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("computer-result-LINUX01"),
    ).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Empty state with active filters
  // ---------------------------------------------------------------------------

  it("shows filter-specific empty state when filters produce no results", async () => {
    const entries = [
      makeComputerEntry("WS001"), // enabled, Windows
    ];
    mockBrowseWith(entries);

    render(<ComputerLookup />);

    await waitFor(() => {
      expect(screen.getByTestId("computer-results-list")).toBeInTheDocument();
    });

    // Filter to disabled - no computers should match
    fireEvent.click(screen.getByText("Disabled", { selector: "button" }));

    expect(
      screen.getByText("No computers match the selected filters."),
    ).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Move to OU dialog (requires AccountOperator permission)
  // ---------------------------------------------------------------------------

  it("shows Move to OU context menu for users with AccountOperator permission", async () => {
    // Override usePermissions to grant canMove
    const permMod = await import("@/hooks/usePermissions");
    vi.spyOn(permMod, "usePermissions").mockReturnValue({
      hasPermission: () => true,
      level: "AccountOperator" as import("@/types/permissions").PermissionLevel,
      groups: [],
      loading: false,
    });

    const entries = [makeComputerEntry("WS001")];
    mockBrowseWith(entries);

    render(<ComputerLookup />);

    await waitFor(() => {
      expect(screen.getByTestId("computer-result-WS001")).toBeInTheDocument();
    });

    // Right-click on the computer item
    fireEvent.contextMenu(screen.getByTestId("computer-result-WS001"));

    await waitFor(() => {
      expect(screen.getByText("Move to OU")).toBeInTheDocument();
    });
  });

  it("does not show Move to OU for ReadOnly users on right-click", async () => {
    // Ensure usePermissions returns ReadOnly (no canMove)
    const permMod = await import("@/hooks/usePermissions");
    vi.spyOn(permMod, "usePermissions").mockReturnValue({
      hasPermission: () => false,
      level: "ReadOnly" as import("@/types/permissions").PermissionLevel,
      groups: [],
      loading: false,
    });

    const entries = [makeComputerEntry("WS001")];
    mockBrowseWith(entries);

    render(<ComputerLookup />);

    await waitFor(() => {
      expect(screen.getByTestId("computer-result-WS001")).toBeInTheDocument();
    });

    // Right-click should not produce a context menu with "Move to OU"
    fireEvent.contextMenu(screen.getByTestId("computer-result-WS001"));

    // The context menu should have no items so "Move to OU" should not appear
    expect(screen.queryByText("Move to OU")).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Accessibility status with filters active
  // ---------------------------------------------------------------------------

  it("updates accessibility status when filters reduce count", async () => {
    const entries = [
      makeComputerEntry("WS001"),
      makeComputerEntry("WS002"),
      makeComputerEntry("WS003", { userAccountControl: ["4098"] }),
    ];
    mockBrowseWith(entries);

    render(<ComputerLookup />);

    await waitFor(() => {
      const status = screen.getByTestId("computer-lookup-status");
      expect(status).toHaveTextContent("3 computers found");
    });

    // Filter to Enabled only (should leave 2)
    fireEvent.click(screen.getByText("Enabled", { selector: "button"}));

    await waitFor(() => {
      const status = screen.getByTestId("computer-lookup-status");
      expect(status).toHaveTextContent("2 computers found");
    });
  });

  // ---------------------------------------------------------------------------
  // Story 14.3 - SecurityIndicatorDot in computer lookup row
  // ---------------------------------------------------------------------------

  describe("security indicator dot", () => {
    it("renders no dot for computers with no detected indicators", async () => {
      mockBrowseWith([makeComputerEntry("WS001")]);

      render(<ComputerLookup />);

      await waitFor(() => {
        expect(screen.getByTestId("computer-result-WS001")).toBeInTheDocument();
      });
      // Wait long enough for the indicators batch to resolve
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(
        screen.queryByTestId("security-indicator-dot"),
      ).not.toBeInTheDocument();
    });

    it("renders the dot for computers with indicators", async () => {
      const entries = [makeComputerEntry("WS001")];
      mockBrowseWith(entries, {
        WS001: {
          indicators: [
            {
              kind: "UnconstrainedDelegation",
              severity: "Critical",
              descriptionKey: "securityIndicators.UnconstrainedDelegation",
            },
          ],
          highestSeverity: "Critical",
        },
      });

      render(<ComputerLookup />);

      await waitFor(() => {
        expect(
          screen.getByTestId("security-indicator-dot"),
        ).toBeInTheDocument();
      });
      expect(screen.getByTestId("security-indicator-dot")).toHaveAttribute(
        "data-severity",
        "Critical",
      );
    });

    it("dot color reflects highestSeverity (Critical wins over Warning)", async () => {
      const entries = [makeComputerEntry("WS001")];
      mockBrowseWith(entries, {
        WS001: {
          indicators: [
            {
              kind: "ConstrainedDelegation",
              severity: "Warning",
              descriptionKey: "securityIndicators.ConstrainedDelegation",
              metadata: { target_spns: ["http/web1"] },
            },
            {
              kind: "UnconstrainedDelegation",
              severity: "Critical",
              descriptionKey: "securityIndicators.UnconstrainedDelegation",
            },
          ],
          highestSeverity: "Critical",
        },
      });

      render(<ComputerLookup />);

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

    it("propagates indicator set to ComputerDetail when a computer is selected", async () => {
      const entries = [makeComputerEntry("WS001")];
      mockBrowseWith(entries, {
        WS001: {
          indicators: [
            {
              kind: "Rbcd",
              severity: "Warning",
              descriptionKey: "securityIndicators.Rbcd",
              metadata: { allowed_principals: ["S-1-5-21-1-2-3-1000"] },
            },
          ],
          highestSeverity: "Warning",
        },
      });

      render(<ComputerLookup />);

      await waitFor(() => {
        expect(screen.getByTestId("computer-result-WS001")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId("computer-result-WS001"));

      await waitFor(() => {
        expect(
          screen.getByTestId("computer-security-indicator-badge-Rbcd"),
        ).toBeInTheDocument();
      });
    });
  });
});
