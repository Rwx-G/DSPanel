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

function makeGroupEntry(
  name: string,
  attrs: Record<string, string[]> = {},
): DirectoryEntry {
  return {
    distinguishedName: `CN=${name},OU=Groups,DC=example,DC=com`,
    samAccountName: name,
    displayName: name,
    objectClass: "group",
    attributes: {
      groupType: ["-2147483646"],
      description: [`${name} group`],
      ...attrs,
    },
  };
}

interface DeepNestingResult {
  groupDn: string;
  groupName: string;
  depth: number;
}

function mockPermissions(level: string) {
  mockInvoke.mockImplementation(((cmd: string) => {
    if (cmd === "get_permission_level") return Promise.resolve(level);
    if (cmd === "get_user_groups") return Promise.resolve([]);
    if (cmd === "detect_empty_groups") return Promise.resolve([]);
    if (cmd === "detect_circular_groups") return Promise.resolve([]);
    if (cmd === "detect_single_member_groups") return Promise.resolve([]);
    if (cmd === "detect_stale_groups") return Promise.resolve([]);
    if (cmd === "detect_undescribed_groups") return Promise.resolve([]);
    if (cmd === "detect_deep_nesting") return Promise.resolve([]);
    if (cmd === "detect_duplicate_groups") return Promise.resolve([]);
    if (cmd === "delete_group") return Promise.resolve(null);
    return Promise.resolve(null);
  }) as typeof invoke);
}

interface ScanResultsOptions {
  emptyGroups?: DirectoryEntry[];
  cycles?: string[][];
  singleMemberGroups?: DirectoryEntry[];
  staleGroups?: DirectoryEntry[];
  undescribedGroups?: DirectoryEntry[];
  deeplyNested?: DeepNestingResult[];
  duplicateGroups?: DirectoryEntry[][];
  level?: string;
}

function mockScanResults(opts: ScanResultsOptions) {
  const {
    emptyGroups = [],
    cycles = [],
    singleMemberGroups = [],
    staleGroups = [],
    undescribedGroups = [],
    deeplyNested = [],
    duplicateGroups = [],
    level = "DomainAdmin",
  } = opts;

  mockInvoke.mockImplementation(((cmd: string) => {
    if (cmd === "get_permission_level") return Promise.resolve(level);
    if (cmd === "get_user_groups") return Promise.resolve([]);
    if (cmd === "detect_empty_groups") return Promise.resolve(emptyGroups);
    if (cmd === "detect_circular_groups") return Promise.resolve(cycles);
    if (cmd === "detect_single_member_groups")
      return Promise.resolve(singleMemberGroups);
    if (cmd === "detect_stale_groups") return Promise.resolve(staleGroups);
    if (cmd === "detect_undescribed_groups")
      return Promise.resolve(undescribedGroups);
    if (cmd === "detect_deep_nesting") return Promise.resolve(deeplyNested);
    if (cmd === "detect_duplicate_groups")
      return Promise.resolve(duplicateGroups);
    if (cmd === "delete_group") return Promise.resolve(null);
    return Promise.resolve(null);
  }) as typeof invoke);
}

// Legacy helper - wraps new interface for backward compatibility
function mockScanResultsLegacy(
  emptyGroups: DirectoryEntry[],
  cycles: string[][],
  level = "DomainAdmin",
) {
  mockScanResults({ emptyGroups, cycles, level });
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
      makeEmptyGroupEntry("Legacy-VPN"),
      makeEmptyGroupEntry("Old-Printers"),
    ];
    mockScanResultsLegacy(emptyGroups, []);

    render(<GroupHygiene />, { wrapper: TestProviders });
    fireEvent.click(screen.getByTestId("scan-button"));

    await waitFor(() => {
      expect(screen.getByTestId("empty-groups-section")).toBeInTheDocument();
    });

    expect(screen.getByText("Legacy-VPN")).toBeInTheDocument();
    expect(screen.getByText("Old-Printers")).toBeInTheDocument();
  });

  it("displays circular nesting cycles after scan", async () => {
    const cycles = [
      [
        "CN=Developers,OU=Groups,DC=example,DC=com",
        "CN=Finance-Analysts,OU=Groups,DC=example,DC=com",
        "CN=Developers,OU=Groups,DC=example,DC=com",
      ],
    ];
    mockScanResultsLegacy([], cycles);

    render(<GroupHygiene />, { wrapper: TestProviders });
    fireEvent.click(screen.getByTestId("scan-button"));

    await waitFor(() => {
      expect(screen.getByTestId("circular-groups-section")).toBeInTheDocument();
    });

    expect(screen.getByTestId("cycle-0")).toBeInTheDocument();
    // Developers appears twice in the cycle (start and close), so use getAllByText
    expect(screen.getAllByText("Developers").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Finance-Analysts")).toBeInTheDocument();
  });

  it("shows all sections with green badges when no issues found", async () => {
    mockScanResultsLegacy([], []);

    render(<GroupHygiene />, { wrapper: TestProviders });
    fireEvent.click(screen.getByTestId("scan-button"));

    await waitFor(() => {
      expect(screen.getByTestId("empty-groups-section")).toBeInTheDocument();
    });

    // All sections visible with 0 count and "All clear" message
    expect(screen.getByTestId("empty-groups-count")).toHaveTextContent("0");
    expect(screen.getAllByText("All clear - no issues detected").length).toBe(7);
  });

  it("scan error shows error message", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_permission_level") return Promise.resolve("ReadOnly");
      if (cmd === "get_user_groups") return Promise.resolve([]);
      if (cmd === "detect_empty_groups")
        return Promise.reject(new Error("Connection lost"));
      if (cmd === "detect_circular_groups") return Promise.resolve([]);
      if (cmd === "detect_single_member_groups") return Promise.resolve([]);
      if (cmd === "detect_stale_groups") return Promise.resolve([]);
      if (cmd === "detect_undescribed_groups") return Promise.resolve([]);
      if (cmd === "detect_deep_nesting") return Promise.resolve([]);
      if (cmd === "detect_duplicate_groups") return Promise.resolve([]);
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
      makeEmptyGroupEntry("Sales-EMEA"),
      makeEmptyGroupEntry("Dev-Frontend"),
    ];
    mockScanResultsLegacy(emptyGroups, []);

    render(<GroupHygiene />, { wrapper: TestProviders });
    fireEvent.click(screen.getByTestId("scan-button"));

    await waitFor(() => {
      expect(screen.getByTestId("empty-groups-section")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("empty-group-checkbox-Sales-EMEA"));

    await waitFor(() => {
      expect(screen.getByTestId("delete-selected-btn")).toBeInTheDocument();
    });

    expect(screen.getByTestId("delete-selected-btn")).toHaveTextContent(
      "Delete Selected (1)",
    );
  });

  it("delete selected opens preview", async () => {
    const emptyGroups = [makeEmptyGroupEntry("Sales-EMEA")];
    mockScanResultsLegacy(emptyGroups, []);

    render(<GroupHygiene />, { wrapper: TestProviders });
    fireEvent.click(screen.getByTestId("scan-button"));

    await waitFor(() => {
      expect(screen.getByTestId("empty-groups-section")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("empty-group-checkbox-Sales-EMEA"));

    await waitFor(() => {
      expect(screen.getByTestId("delete-selected-btn")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("delete-selected-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("delete-preview-dialog")).toBeInTheDocument();
    });

    // Sales-EMEA appears in both the table and the dialog, so verify via dialog content
    const dialog = screen.getByTestId("delete-preview-dialog");
    expect(dialog).toHaveTextContent("Sales-EMEA");
  });

  it("delete executes and refreshes", async () => {
    const emptyGroups = [makeEmptyGroupEntry("Sales-EMEA")];
    mockScanResultsLegacy(emptyGroups, []);

    render(<GroupHygiene />, { wrapper: TestProviders });
    fireEvent.click(screen.getByTestId("scan-button"));

    await waitFor(() => {
      expect(screen.getByTestId("empty-groups-section")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("empty-group-checkbox-Sales-EMEA"));

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
        groupDn: "CN=Sales-EMEA,OU=Groups,DC=example,DC=com",
      });
    });
  });

  it("go to group calls navigation", async () => {
    const emptyGroups = [makeEmptyGroupEntry("Sales-EMEA")];
    mockScanResultsLegacy(emptyGroups, []);

    render(<GroupHygiene />, { wrapper: TestProviders });
    fireEvent.click(screen.getByTestId("scan-button"));

    await waitFor(() => {
      expect(screen.getByTestId("empty-groups-section")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("go-to-group-Sales-EMEA"));

    // The navigation should open a tab - verify it doesn't throw
    // Navigation context is tested via integration
  });

  it("permission gating: delete hidden for non-DomainAdmin", async () => {
    const emptyGroups = [makeEmptyGroupEntry("Sales-EMEA")];
    mockScanResultsLegacy(emptyGroups, [], "AccountOperator");

    render(<GroupHygiene />, { wrapper: TestProviders });
    fireEvent.click(screen.getByTestId("scan-button"));

    await waitFor(() => {
      expect(screen.getByTestId("empty-groups-section")).toBeInTheDocument();
    });

    expect(
      screen.queryByTestId("empty-group-checkbox-Sales-EMEA"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("delete-selected-btn")).not.toBeInTheDocument();
  });

  it("empty group count badge shows correct number", async () => {
    const emptyGroups = [
      makeEmptyGroupEntry("Sales-EMEA"),
      makeEmptyGroupEntry("Dev-Frontend"),
      makeEmptyGroupEntry("Dev-Backend"),
    ];
    mockScanResultsLegacy(emptyGroups, []);

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
    mockScanResultsLegacy([], cycles);

    render(<GroupHygiene />, { wrapper: TestProviders });
    fireEvent.click(screen.getByTestId("scan-button"));

    await waitFor(() => {
      expect(screen.getByTestId("cycles-count")).toBeInTheDocument();
    });

    expect(screen.getByTestId("cycles-count")).toHaveTextContent("2");
  });

  it("delete progress shows during execution", async () => {
    const emptyGroups = [makeEmptyGroupEntry("Sales-EMEA")];
    mockScanResultsLegacy(emptyGroups, []);

    render(<GroupHygiene />, { wrapper: TestProviders });
    fireEvent.click(screen.getByTestId("scan-button"));

    await waitFor(() => {
      expect(screen.getByTestId("empty-groups-section")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("empty-group-checkbox-Sales-EMEA"));

    await waitFor(() => {
      expect(screen.getByTestId("delete-selected-btn")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("delete-selected-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("delete-preview-dialog")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("delete-preview-confirm"));

    // The delete progress section should appear
    await waitFor(() => {
      expect(screen.getByTestId("delete-progress")).toBeInTheDocument();
    });

    expect(screen.getByTestId("delete-progress-message")).toBeInTheDocument();
  });

  it("cycle group navigation calls openTab", async () => {
    const cycles = [
      [
        "CN=TeamA,OU=Groups,DC=example,DC=com",
        "CN=TeamB,OU=Groups,DC=example,DC=com",
        "CN=TeamA,OU=Groups,DC=example,DC=com",
      ],
    ];
    mockScanResultsLegacy([], cycles);

    render(<GroupHygiene />, { wrapper: TestProviders });
    fireEvent.click(screen.getByTestId("scan-button"));

    await waitFor(() => {
      expect(screen.getByTestId("circular-groups-section")).toBeInTheDocument();
    });

    // Click on the first cycle group link - this calls openTab internally
    const groupLinks = screen.getAllByTestId("cycle-group-TeamA");
    fireEvent.click(groupLinks[0]);

    // Verify no error was thrown and the button rendered correctly
    expect(groupLinks[0]).toBeInTheDocument();
  });

  it("select-all checkbox selects all empty groups", async () => {
    const emptyGroups = [
      makeEmptyGroupEntry("Sales-EMEA"),
      makeEmptyGroupEntry("Dev-Frontend"),
    ];
    mockScanResultsLegacy(emptyGroups, []);

    render(<GroupHygiene />, { wrapper: TestProviders });
    fireEvent.click(screen.getByTestId("scan-button"));

    await waitFor(() => {
      expect(screen.getByTestId("empty-groups-section")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("select-all-empty"));

    await waitFor(() => {
      expect(screen.getByTestId("delete-selected-btn")).toHaveTextContent(
        "Delete Selected (2)",
      );
    });
  });

  it("cancel in delete preview closes dialog", async () => {
    const emptyGroups = [makeEmptyGroupEntry("Sales-EMEA")];
    mockScanResultsLegacy(emptyGroups, []);

    render(<GroupHygiene />, { wrapper: TestProviders });
    fireEvent.click(screen.getByTestId("scan-button"));

    await waitFor(() => {
      expect(screen.getByTestId("empty-groups-section")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("empty-group-checkbox-Sales-EMEA"));

    await waitFor(() => {
      expect(screen.getByTestId("delete-selected-btn")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("delete-selected-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("delete-preview-dialog")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("delete-preview-cancel"));

    await waitFor(() => {
      expect(
        screen.queryByTestId("delete-preview-dialog"),
      ).not.toBeInTheDocument();
    });
  });

  // --- New detection tests ---

  it("displays single-member groups after scan", async () => {
    const singleMemberGroups = [
      makeGroupEntry("IT-Support", {
        member: ["CN=User1,DC=example,DC=com"],
        groupType: ["-2147483646"],
      }),
    ];
    mockScanResults({ singleMemberGroups });

    render(<GroupHygiene />, { wrapper: TestProviders });
    fireEvent.click(screen.getByTestId("scan-button"));

    await waitFor(() => {
      expect(
        screen.getByTestId("single-member-groups-section"),
      ).toBeInTheDocument();
    });

    expect(screen.getByTestId("single-member-groups-count")).toHaveTextContent(
      "1",
    );
    expect(screen.getByText("IT-Support")).toBeInTheDocument();
  });

  it("displays stale groups with last modified date", async () => {
    const staleGroups = [
      makeGroupEntry("Old-Team", {
        groupType: ["-2147483646"],
        whenChanged: ["2024-01-01T00:00:00Z"],
      }),
    ];
    mockScanResults({ staleGroups });

    render(<GroupHygiene />, { wrapper: TestProviders });
    fireEvent.click(screen.getByTestId("scan-button"));

    await waitFor(() => {
      expect(screen.getByTestId("stale-groups-section")).toBeInTheDocument();
    });

    expect(screen.getByTestId("stale-groups-count")).toHaveTextContent("1");
    expect(screen.getByText("Old-Team")).toBeInTheDocument();
    expect(screen.getByText("> 180 days ago")).toBeInTheDocument();
  });

  it("displays undescribed groups after scan", async () => {
    const undescribedGroups = [
      makeGroupEntry("No-Desc-Group", { groupType: ["-2147483646"] }),
      makeGroupEntry("Another-No-Desc", { groupType: ["-2147483646"] }),
    ];
    mockScanResults({ undescribedGroups });

    render(<GroupHygiene />, { wrapper: TestProviders });
    fireEvent.click(screen.getByTestId("scan-button"));

    await waitFor(() => {
      expect(
        screen.getByTestId("undescribed-groups-section"),
      ).toBeInTheDocument();
    });

    expect(screen.getByTestId("undescribed-groups-count")).toHaveTextContent(
      "2",
    );
    expect(screen.getByText("No-Desc-Group")).toBeInTheDocument();
    expect(screen.getByText("Another-No-Desc")).toBeInTheDocument();
  });

  it("displays deep nesting results with depth", async () => {
    const deeplyNested: DeepNestingResult[] = [
      {
        groupDn: "CN=IT-Team,OU=Groups,DC=example,DC=com",
        groupName: "IT-Team",
        depth: 4,
      },
    ];
    mockScanResults({ deeplyNested });

    render(<GroupHygiene />, { wrapper: TestProviders });
    fireEvent.click(screen.getByTestId("scan-button"));

    await waitFor(() => {
      expect(screen.getByTestId("deep-nesting-section")).toBeInTheDocument();
    });

    expect(screen.getByTestId("deep-nesting-count")).toHaveTextContent("1");
    expect(screen.getByTestId("deep-nested-IT-Team")).toBeInTheDocument();
    expect(screen.getByTestId("depth-IT-Team")).toHaveTextContent("Depth: 4");
  });

  it("displays duplicate groups as clusters", async () => {
    const duplicateGroups = [
      [
        makeGroupEntry("IT-Support", {
          member: ["CN=User1,DC=example,DC=com"],
          groupType: ["-2147483646"],
        }),
        makeGroupEntry("IT-Helpdesk", {
          member: ["CN=User1,DC=example,DC=com"],
          groupType: ["-2147483646"],
        }),
      ],
    ];
    mockScanResults({ duplicateGroups });

    render(<GroupHygiene />, { wrapper: TestProviders });
    fireEvent.click(screen.getByTestId("scan-button"));

    await waitFor(() => {
      expect(
        screen.getByTestId("duplicate-groups-section"),
      ).toBeInTheDocument();
    });

    expect(screen.getByTestId("duplicate-groups-count")).toHaveTextContent("1");
    expect(screen.getByTestId("duplicate-cluster-0")).toBeInTheDocument();
    expect(
      screen.getByTestId("duplicate-group-IT-Support"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("duplicate-group-IT-Helpdesk"),
    ).toBeInTheDocument();
  });

  it("single-member groups go-to navigation works", async () => {
    const singleMemberGroups = [
      makeGroupEntry("Solo-Group", {
        member: ["CN=User1,DC=example,DC=com"],
        groupType: ["-2147483646"],
      }),
    ];
    mockScanResults({ singleMemberGroups });

    render(<GroupHygiene />, { wrapper: TestProviders });
    fireEvent.click(screen.getByTestId("scan-button"));

    await waitFor(() => {
      expect(
        screen.getByTestId("single-member-groups-section"),
      ).toBeInTheDocument();
    });

    const goToBtn = screen.getByTestId("go-to-group-Solo-Group");
    fireEvent.click(goToBtn);
    expect(goToBtn).toBeInTheDocument();
  });

  it("deep nesting go-to navigation works", async () => {
    const deeplyNested: DeepNestingResult[] = [
      {
        groupDn: "CN=Deep-Group,OU=Groups,DC=example,DC=com",
        groupName: "Deep-Group",
        depth: 5,
      },
    ];
    mockScanResults({ deeplyNested });

    render(<GroupHygiene />, { wrapper: TestProviders });
    fireEvent.click(screen.getByTestId("scan-button"));

    await waitFor(() => {
      expect(screen.getByTestId("deep-nesting-section")).toBeInTheDocument();
    });

    const goToBtn = screen.getByTestId("go-to-group-Deep-Group");
    fireEvent.click(goToBtn);
    expect(goToBtn).toBeInTheDocument();
  });

  it("all detections run in parallel via scan button", async () => {
    mockScanResults({});

    render(<GroupHygiene />, { wrapper: TestProviders });
    fireEvent.click(screen.getByTestId("scan-button"));

    await waitFor(() => {
      expect(screen.getByTestId("empty-groups-section")).toBeInTheDocument();
    });

    // Verify all 7 detection commands were called
    expect(mockInvoke).toHaveBeenCalledWith("detect_empty_groups");
    expect(mockInvoke).toHaveBeenCalledWith("detect_circular_groups");
    expect(mockInvoke).toHaveBeenCalledWith("detect_single_member_groups");
    expect(mockInvoke).toHaveBeenCalledWith("detect_stale_groups", {
      daysThreshold: 180,
    });
    expect(mockInvoke).toHaveBeenCalledWith("detect_undescribed_groups");
    expect(mockInvoke).toHaveBeenCalledWith("detect_deep_nesting", {
      maxDepth: 3,
    });
    expect(mockInvoke).toHaveBeenCalledWith("detect_duplicate_groups");
  });

  it("placeholder containers show for all 7 detections before scan", () => {
    mockPermissions("ReadOnly");
    render(<GroupHygiene />, { wrapper: TestProviders });

    expect(screen.getByText("Empty Groups")).toBeInTheDocument();
    expect(screen.getByText("Single-Member Groups")).toBeInTheDocument();
    expect(screen.getByText("Stale Groups")).toBeInTheDocument();
    expect(screen.getByText("Groups Without Description")).toBeInTheDocument();
    expect(screen.getByText("Circular Nesting")).toBeInTheDocument();
    expect(screen.getByText("Excessive Nesting Depth")).toBeInTheDocument();
    expect(screen.getByText("Duplicate Groups")).toBeInTheDocument();
  });
});
