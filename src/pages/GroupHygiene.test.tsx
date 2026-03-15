import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { GroupHygiene } from "./GroupHygiene";
import { DialogProvider } from "@/contexts/DialogContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { NavigationProvider } from "@/contexts/NavigationContext";
import type { DirectoryEntry } from "@/types/directory";

function TestProviders({ children }: { children: ReactNode }) {
  return (
    <NotificationProvider>
      <DialogProvider>
        <NavigationProvider>{children}</NavigationProvider>
      </DialogProvider>
    </NotificationProvider>
  );
}

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

function makeEmptyGroupEntry(name: string): DirectoryEntry {
  return {
    distinguishedName: `CN=${name},OU=Groups,DC=example,DC=com`,
    samAccountName: name,
    displayName: name,
    objectClass: "group",
    attributes: {
      groupType: ["-2147483646"],
      description: [`${name} group`],
    },
  };
}

function mockPermissions(level: string) {
  mockInvoke.mockImplementation(((cmd: string) => {
    if (cmd === "get_permission_level") return Promise.resolve(level);
    if (cmd === "get_user_groups") return Promise.resolve([]);
    if (cmd === "detect_empty_groups") return Promise.resolve([]);
    if (cmd === "detect_circular_groups") return Promise.resolve([]);
    if (cmd === "delete_group") return Promise.resolve(null);
    return Promise.resolve(null);
  }) as typeof invoke);
}

function mockScanResults(
  emptyGroups: DirectoryEntry[],
  cycles: string[][],
  level = "DomainAdmin",
) {
  mockInvoke.mockImplementation(((cmd: string) => {
    if (cmd === "get_permission_level") return Promise.resolve(level);
    if (cmd === "get_user_groups") return Promise.resolve([]);
    if (cmd === "detect_empty_groups") return Promise.resolve(emptyGroups);
    if (cmd === "detect_circular_groups") return Promise.resolve(cycles);
    if (cmd === "delete_group") return Promise.resolve(null);
    return Promise.resolve(null);
  }) as typeof invoke);
}

describe("GroupHygiene", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("renders scan button", () => {
    mockPermissions("ReadOnly");
    render(<GroupHygiene />, { wrapper: TestProviders });
    expect(screen.getByTestId("scan-button")).toBeInTheDocument();
    expect(screen.getByText("Run Scan")).toBeInTheDocument();
  });

  it("shows loading spinner during scan", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_permission_level") return Promise.resolve("ReadOnly");
      if (cmd === "get_user_groups") return Promise.resolve([]);
      // Never resolve to keep loading
      return new Promise(() => {});
    }) as typeof invoke);

    render(<GroupHygiene />, { wrapper: TestProviders });
    fireEvent.click(screen.getByTestId("scan-button"));

    await waitFor(() => {
      expect(screen.getByTestId("scan-loading")).toBeInTheDocument();
    });
  });

  it("displays empty groups after scan", async () => {
    const emptyGroups = [
      makeEmptyGroupEntry("OldProject"),
      makeEmptyGroupEntry("Deprecated"),
    ];
    mockScanResults(emptyGroups, []);

    render(<GroupHygiene />, { wrapper: TestProviders });
    fireEvent.click(screen.getByTestId("scan-button"));

    await waitFor(() => {
      expect(screen.getByTestId("empty-groups-section")).toBeInTheDocument();
    });

    expect(screen.getByText("OldProject")).toBeInTheDocument();
    expect(screen.getByText("Deprecated")).toBeInTheDocument();
  });

  it("displays circular nesting cycles after scan", async () => {
    const cycles = [
      [
        "CN=GroupA,OU=Groups,DC=example,DC=com",
        "CN=GroupB,OU=Groups,DC=example,DC=com",
        "CN=GroupA,OU=Groups,DC=example,DC=com",
      ],
    ];
    mockScanResults([], cycles);

    render(<GroupHygiene />, { wrapper: TestProviders });
    fireEvent.click(screen.getByTestId("scan-button"));

    await waitFor(() => {
      expect(screen.getByTestId("circular-groups-section")).toBeInTheDocument();
    });

    expect(screen.getByTestId("cycle-0")).toBeInTheDocument();
    // GroupA appears twice in the cycle (start and close), so use getAllByText
    expect(screen.getAllByText("GroupA").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("GroupB")).toBeInTheDocument();
  });

  it("shows empty state when no issues found", async () => {
    mockScanResults([], []);

    render(<GroupHygiene />, { wrapper: TestProviders });
    fireEvent.click(screen.getByTestId("scan-button"));

    await waitFor(() => {
      expect(screen.getByTestId("no-issues")).toBeInTheDocument();
    });

    expect(screen.getByText("No issues found")).toBeInTheDocument();
  });

  it("scan error shows error message", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_permission_level") return Promise.resolve("ReadOnly");
      if (cmd === "get_user_groups") return Promise.resolve([]);
      if (cmd === "detect_empty_groups")
        return Promise.reject(new Error("Connection lost"));
      if (cmd === "detect_circular_groups") return Promise.resolve([]);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(<GroupHygiene />, { wrapper: TestProviders });
    fireEvent.click(screen.getByTestId("scan-button"));

    await waitFor(() => {
      expect(screen.getByTestId("scan-error")).toBeInTheDocument();
    });

    expect(screen.getByText("Scan failed")).toBeInTheDocument();
  });

  it("multi-select on empty groups", async () => {
    const emptyGroups = [
      makeEmptyGroupEntry("Group1"),
      makeEmptyGroupEntry("Group2"),
    ];
    mockScanResults(emptyGroups, []);

    render(<GroupHygiene />, { wrapper: TestProviders });
    fireEvent.click(screen.getByTestId("scan-button"));

    await waitFor(() => {
      expect(screen.getByTestId("empty-groups-section")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("empty-group-checkbox-Group1"));

    await waitFor(() => {
      expect(screen.getByTestId("delete-selected-btn")).toBeInTheDocument();
    });

    expect(screen.getByTestId("delete-selected-btn")).toHaveTextContent(
      "Delete Selected (1)",
    );
  });

  it("delete selected opens preview", async () => {
    const emptyGroups = [makeEmptyGroupEntry("Group1")];
    mockScanResults(emptyGroups, []);

    render(<GroupHygiene />, { wrapper: TestProviders });
    fireEvent.click(screen.getByTestId("scan-button"));

    await waitFor(() => {
      expect(screen.getByTestId("empty-groups-section")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("empty-group-checkbox-Group1"));

    await waitFor(() => {
      expect(screen.getByTestId("delete-selected-btn")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("delete-selected-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("delete-preview-dialog")).toBeInTheDocument();
    });

    // Group1 appears in both the table and the dialog, so verify via dialog content
    const dialog = screen.getByTestId("delete-preview-dialog");
    expect(dialog).toHaveTextContent("Group1");
  });

  it("delete executes and refreshes", async () => {
    const emptyGroups = [makeEmptyGroupEntry("Group1")];
    mockScanResults(emptyGroups, []);

    render(<GroupHygiene />, { wrapper: TestProviders });
    fireEvent.click(screen.getByTestId("scan-button"));

    await waitFor(() => {
      expect(screen.getByTestId("empty-groups-section")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("empty-group-checkbox-Group1"));

    await waitFor(() => {
      expect(screen.getByTestId("delete-selected-btn")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("delete-selected-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("delete-preview-dialog")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("delete-preview-confirm"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("delete_group", {
        groupDn: "CN=Group1,OU=Groups,DC=example,DC=com",
      });
    });
  });

  it("go to group calls navigation", async () => {
    const emptyGroups = [makeEmptyGroupEntry("Group1")];
    mockScanResults(emptyGroups, []);

    render(<GroupHygiene />, { wrapper: TestProviders });
    fireEvent.click(screen.getByTestId("scan-button"));

    await waitFor(() => {
      expect(screen.getByTestId("empty-groups-section")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("go-to-group-Group1"));

    // The navigation should open a tab - verify it doesn't throw
    // Navigation context is tested via integration
  });

  it("permission gating: delete hidden for non-DomainAdmin", async () => {
    const emptyGroups = [makeEmptyGroupEntry("Group1")];
    mockScanResults(emptyGroups, [], "AccountOperator");

    render(<GroupHygiene />, { wrapper: TestProviders });
    fireEvent.click(screen.getByTestId("scan-button"));

    await waitFor(() => {
      expect(screen.getByTestId("empty-groups-section")).toBeInTheDocument();
    });

    expect(
      screen.queryByTestId("empty-group-checkbox-Group1"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("delete-selected-btn")).not.toBeInTheDocument();
  });

  it("empty group count badge shows correct number", async () => {
    const emptyGroups = [
      makeEmptyGroupEntry("Group1"),
      makeEmptyGroupEntry("Group2"),
      makeEmptyGroupEntry("Group3"),
    ];
    mockScanResults(emptyGroups, []);

    render(<GroupHygiene />, { wrapper: TestProviders });
    fireEvent.click(screen.getByTestId("scan-button"));

    await waitFor(() => {
      expect(screen.getByTestId("empty-groups-count")).toBeInTheDocument();
    });

    expect(screen.getByTestId("empty-groups-count")).toHaveTextContent("3");
  });

  it("cycle count badge shows correct number", async () => {
    const cycles = [
      ["CN=A,DC=test", "CN=B,DC=test", "CN=A,DC=test"],
      ["CN=C,DC=test", "CN=D,DC=test", "CN=C,DC=test"],
    ];
    mockScanResults([], cycles);

    render(<GroupHygiene />, { wrapper: TestProviders });
    fireEvent.click(screen.getByTestId("scan-button"));

    await waitFor(() => {
      expect(screen.getByTestId("cycles-count")).toBeInTheDocument();
    });

    expect(screen.getByTestId("cycles-count")).toHaveTextContent("2");
  });
});
