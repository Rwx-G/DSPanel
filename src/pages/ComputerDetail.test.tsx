import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ComputerDetail } from "./ComputerDetail";
import type { DirectoryComputer } from "@/types/directory";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@/components/comparison/StateInTimeView", () => ({
  StateInTimeView: () => <div data-testid="state-in-time-view" />,
}));

vi.mock("@/components/dialogs/GroupMembersDialog", () => ({
  GroupMembersDialog: ({
    onClose,
    groupName,
  }: {
    onClose: () => void;
    groupDn: string;
    groupName: string;
  }) => (
    <div data-testid="group-members-dialog">
      <span>{groupName}</span>
      <button data-testid="close-group-dialog" onClick={onClose}>
        Close
      </button>
    </div>
  ),
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

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

function makeComputer(
  overrides: Partial<DirectoryComputer> = {},
): DirectoryComputer {
  return {
    distinguishedName: "CN=WS001,OU=Computers,DC=example,DC=com",
    name: "WS001",
    dnsHostName: "ws001.example.com",
    operatingSystem: "Windows 11 Enterprise",
    osVersion: "10.0 (22631)",
    lastLogon: "2026-03-12T08:00:00Z",
    organizationalUnit: "Computers",
    enabled: true,
    memberOf: [
      "CN=Domain Computers,CN=Users,DC=example,DC=com",
      "CN=IT Workstations,OU=Groups,DC=example,DC=com",
    ],
    rawAttributes: {},
    ...overrides,
  };
}

describe("ComputerDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: DNS resolves successfully
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "resolve_dns") return Promise.resolve(["10.0.0.1"]);
      if (cmd === "ping_host") return Promise.resolve("Reachable (1ms)");
      return Promise.resolve(null);
    }) as typeof invoke);
  });

  it("renders computer detail container", () => {
    render(<ComputerDetail computer={makeComputer()} />);
    expect(screen.getByTestId("computer-detail")).toBeInTheDocument();
  });

  it("displays computer name as heading", async () => {
    render(<ComputerDetail computer={makeComputer({ name: "SRV-DC01" })} />);
    const heading = screen.getByTestId("computer-detail").querySelector("h2");
    expect(heading).toHaveTextContent("SRV-DC01");
    // Wait for DNS resolution to settle
    await waitFor(() => {
      expect(screen.getByText("10.0.0.1")).toBeInTheDocument();
    });
  });

  it("shows Enabled status badge for enabled computer", () => {
    render(<ComputerDetail computer={makeComputer({ enabled: true })} />);
    const badges = screen.getAllByText("Enabled");
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });

  it("shows Disabled status badge for disabled computer", () => {
    render(<ComputerDetail computer={makeComputer({ enabled: false })} />);
    const badges = screen.getAllByText("Disabled");
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });

  it("displays DNS hostname with copy button", async () => {
    render(<ComputerDetail computer={makeComputer()} />);
    // DNS hostname appears in both the header area and property grid
    const hostnames = screen.getAllByText("ws001.example.com");
    expect(hostnames.length).toBeGreaterThanOrEqual(1);
    // Wait for DNS resolution to complete
    await waitFor(() => {
      expect(screen.getByText("10.0.0.1")).toBeInTheDocument();
    });
  });

  it("renders property groups for Identity, Status, Location, Network", () => {
    render(<ComputerDetail computer={makeComputer()} />);
    expect(screen.getByText("Identity")).toBeInTheDocument();
    expect(screen.getAllByText("Status").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Location")).toBeInTheDocument();
    expect(screen.getByText("Network")).toBeInTheDocument();
  });

  it("displays OS information in Identity section", () => {
    render(<ComputerDetail computer={makeComputer()} />);
    expect(screen.getByText("Windows 11 Enterprise")).toBeInTheDocument();
  });

  it("shows ping button", async () => {
    render(<ComputerDetail computer={makeComputer()} />);
    expect(screen.getByTestId("ping-button")).toBeInTheDocument();
    // "Ping" appears in both button and property grid label
    const pingTexts = screen.getAllByText("Ping");
    expect(pingTexts.length).toBeGreaterThanOrEqual(1);
    // Wait for DNS resolution to complete
    await waitFor(() => {
      expect(screen.getByText("10.0.0.1")).toBeInTheDocument();
    });
  });

  it("disables ping button when no DNS hostname", () => {
    render(<ComputerDetail computer={makeComputer({ dnsHostName: "" })} />);
    expect(screen.getByTestId("ping-button")).toBeDisabled();
  });

  it("performs ping and shows result", async () => {
    render(<ComputerDetail computer={makeComputer()} />);
    fireEvent.click(screen.getByTestId("ping-button"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("ping_host", {
        hostname: "ws001.example.com",
      });
    });

    await waitFor(() => {
      // Ping result appears in both StatusBadge and PropertyGrid
      const results = screen.getAllByText("Reachable (1ms)");
      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows unreachable result when ping fails", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "resolve_dns") return Promise.resolve(["10.0.0.1"]);
      if (cmd === "ping_host") return Promise.reject(new Error("timeout"));
      return Promise.resolve(null);
    }) as typeof invoke);

    render(<ComputerDetail computer={makeComputer()} />);
    fireEvent.click(screen.getByTestId("ping-button"));

    await waitFor(() => {
      // Ping result appears in both StatusBadge and PropertyGrid
      const results = screen.getAllByText("Unreachable (ping failed)");
      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("resolves DNS on mount", async () => {
    render(<ComputerDetail computer={makeComputer()} />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("resolve_dns", {
        hostname: "ws001.example.com",
      });
    });

    await waitFor(() => {
      expect(screen.getByText("10.0.0.1")).toBeInTheDocument();
    });
  });

  it("shows DNS resolution failed on error", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "resolve_dns")
        return Promise.reject(new Error("DNS lookup failed"));
      return Promise.resolve(null);
    }) as typeof invoke);

    render(<ComputerDetail computer={makeComputer()} />);

    await waitFor(() => {
      expect(screen.getByText("DNS resolution failed")).toBeInTheDocument();
    });
  });

  it("renders group memberships section with correct count", () => {
    render(<ComputerDetail computer={makeComputer()} />);
    expect(screen.getByTestId("computer-groups-section")).toBeInTheDocument();
    expect(screen.getByText("Group Memberships (2)")).toBeInTheDocument();
  });

  it("displays group names in the groups section", () => {
    render(<ComputerDetail computer={makeComputer()} />);
    expect(screen.getByText("Domain Computers")).toBeInTheDocument();
    expect(screen.getByText("IT Workstations")).toBeInTheDocument();
  });

  it("renders Replication History section", () => {
    render(<ComputerDetail computer={makeComputer()} />);
    expect(screen.getByTestId("computer-history-section")).toBeInTheDocument();
    expect(screen.getByText("Replication History")).toBeInTheDocument();
  });

  it("shows Never for null lastLogon", () => {
    render(<ComputerDetail computer={makeComputer({ lastLogon: null })} />);
    expect(screen.getByText("Never")).toBeInTheDocument();
  });

  it("renders empty group section when computer has no groups", () => {
    render(<ComputerDetail computer={makeComputer({ memberOf: [] })} />);
    expect(screen.getByText("Group Memberships (0)")).toBeInTheDocument();
  });

  it("does not resolve DNS when hostname is empty", () => {
    render(<ComputerDetail computer={makeComputer({ dnsHostName: "" })} />);
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "resolve_dns",
      expect.anything(),
    );
  });

  describe("Group memberships - filter", () => {
    it("filters groups by text input", async () => {
      render(<ComputerDetail computer={makeComputer()} />);

      // Both groups should be visible initially
      expect(screen.getByText("Domain Computers")).toBeInTheDocument();
      expect(screen.getByText("IT Workstations")).toBeInTheDocument();

      // Filter to only show IT Workstations
      const filterInput = screen.getByTestId("filter-text-input");
      fireEvent.change(filterInput, { target: { value: "IT" } });

      await waitFor(() => {
        expect(screen.getByText("IT Workstations")).toBeInTheDocument();
        expect(screen.queryByText("Domain Computers")).not.toBeInTheDocument();
      });
    });

    it("shows no rows when filter matches nothing", async () => {
      render(<ComputerDetail computer={makeComputer()} />);

      const filterInput = screen.getByTestId("filter-text-input");
      fireEvent.change(filterInput, { target: { value: "zzz-nonexistent" } });

      await waitFor(() => {
        expect(screen.queryByText("Domain Computers")).not.toBeInTheDocument();
        expect(screen.queryByText("IT Workstations")).not.toBeInTheDocument();
      });
    });
  });

  describe("Group memberships - export", () => {
    it("renders export toolbar in groups section", () => {
      render(<ComputerDetail computer={makeComputer()} />);
      const groupsSection = screen.getByTestId("computer-groups-section");
      const exportToolbar = groupsSection.querySelector('[data-testid="export-toolbar"]');
      expect(exportToolbar).toBeInTheDocument();
    });

    it("shows export menu when clicking export button", async () => {
      render(<ComputerDetail computer={makeComputer()} />);

      const exportBtn = screen.getByTestId("export-button");
      fireEvent.click(exportBtn);

      await waitFor(() => {
        expect(screen.getByTestId("export-menu")).toBeInTheDocument();
      });
    });

    it("disables export button when no groups", () => {
      render(<ComputerDetail computer={makeComputer({ memberOf: [] })} />);
      const exportBtn = screen.getByTestId("export-button");
      expect(exportBtn).toBeDisabled();
    });
  });

  describe("Group memberships - context menu", () => {
    it("opens context menu on right-click of a group row", async () => {
      render(<ComputerDetail computer={makeComputer()} />);

      const groupRow = screen.getByText("Domain Computers").closest("tr");
      expect(groupRow).not.toBeNull();
      fireEvent.contextMenu(groupRow!);

      await waitFor(() => {
        expect(screen.getByText("View group members")).toBeInTheDocument();
      });
    });

    it("opens GroupMembersDialog when clicking view group members", async () => {
      render(<ComputerDetail computer={makeComputer()} />);

      // Find "IT Workstations" text and locate the parent row element
      const itText = screen.getByText("IT Workstations");
      const groupRow = itText.closest("tr") ?? itText.closest("[data-testid]")?.parentElement;
      expect(groupRow).not.toBeNull();
      fireEvent.contextMenu(groupRow!);

      await waitFor(() => {
        expect(screen.getByText("View group members")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("View group members"));

      await waitFor(() => {
        expect(screen.getByTestId("group-members-dialog")).toBeInTheDocument();
      });
    });

    it("closes GroupMembersDialog on close button click", async () => {
      render(<ComputerDetail computer={makeComputer()} />);

      const itText = screen.getByText("IT Workstations");
      const groupRow = itText.closest("tr") ?? itText.closest("[data-testid]")?.parentElement;
      fireEvent.contextMenu(groupRow!);

      await waitFor(() => {
        expect(screen.getByText("View group members")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("View group members"));

      await waitFor(() => {
        expect(screen.getByTestId("group-members-dialog")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("close-group-dialog"));

      await waitFor(() => {
        expect(screen.queryByTestId("group-members-dialog")).not.toBeInTheDocument();
      });
    });
  });

  describe("DNS cache and timeout indicator", () => {
    it("uses DNS cache on re-render with same hostname", async () => {
      const { rerender } = render(
        <ComputerDetail computer={makeComputer()} />,
      );

      // Wait for initial DNS resolution
      await waitFor(() => {
        expect(screen.getByText("10.0.0.1")).toBeInTheDocument();
      });

      const callCountBefore = mockInvoke.mock.calls.filter(
        (c) => c[0] === "resolve_dns",
      ).length;

      // Re-render with same hostname - should use cache
      rerender(
        <ComputerDetail computer={makeComputer()} />,
      );

      // Wait a tick and verify no additional resolve_dns call
      await waitFor(() => {
        const callCountAfter = mockInvoke.mock.calls.filter(
          (c) => c[0] === "resolve_dns",
        ).length;
        expect(callCountAfter).toBe(callCountBefore);
      });
    });

    it("shows Resolving text while DNS is in progress", () => {
      // Use a DNS resolve that never completes
      mockInvoke.mockImplementation(((cmd: string) => {
        if (cmd === "resolve_dns") return new Promise(() => {});
        if (cmd === "get_platform") return Promise.resolve("unknown");
        return Promise.resolve(null);
      }) as typeof invoke);

      render(<ComputerDetail computer={makeComputer()} />);

      // While resolving, should show "Resolving..."
      expect(screen.getByText("Resolving...")).toBeInTheDocument();
    });

    it("clears DNS state when hostname is empty", () => {
      render(<ComputerDetail computer={makeComputer({ dnsHostName: "" })} />);
      expect(screen.getByText("N/A")).toBeInTheDocument();
    });
  });

  describe("Delete computer", () => {
    it("does not show delete button for ReadOnly users", () => {
      render(<ComputerDetail computer={makeComputer()} />);
      expect(screen.queryByTestId("computer-delete-btn")).not.toBeInTheDocument();
    });
  });
});
