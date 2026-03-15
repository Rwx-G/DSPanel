import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { GroupManagement } from "./GroupManagement";
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

function makeGroupEntry(
  name: string,
  scope: "Global" | "DomainLocal" | "Universal" = "Global",
  category: "Security" | "Distribution" = "Security",
  memberCount = 0,
): DirectoryEntry {
  let groupType: number;
  let scopeBit = 0;
  if (scope === "Global") scopeBit = 0x2;
  else if (scope === "DomainLocal") scopeBit = 0x4;
  else if (scope === "Universal") scopeBit = 0x8;

  if (category === "Security") {
    groupType = (scopeBit | 0x80000000) >>> 0;
    // Use signed representation for Security groups
    groupType = groupType | 0; // force signed
  } else {
    groupType = scopeBit;
  }

  const members = Array.from(
    { length: memberCount },
    (_, i) => `CN=Member${i},OU=Users,OU=Corp,DC=example,DC=com`,
  );

  return {
    distinguishedName: `CN=${name},OU=Groups,DC=example,DC=com`,
    samAccountName: name,
    displayName: name,
    objectClass: "group",
    attributes: {
      groupType: [groupType.toString()],
      description: [`${name} group description`],
      member: members,
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
  options?: {
    permissionLevel?: string;
    members?: DirectoryEntry[];
    searchResults?: DirectoryEntry[];
  },
) {
  const permLevel = options?.permissionLevel ?? "ReadOnly";
  const memberEntries = options?.members ?? [];
  const searchResults = options?.searchResults ?? [];

  mockInvoke.mockImplementation(((cmd: string) => {
    if (cmd === "browse_groups")
      return Promise.resolve(makeBrowseResult(entries));
    if (cmd === "search_groups") return Promise.resolve(entries);
    if (cmd === "get_group_members") return Promise.resolve(memberEntries);
    if (cmd === "get_ou_tree") return Promise.resolve([]);
    if (cmd === "get_permission_level") return Promise.resolve(permLevel);
    if (cmd === "get_user_groups") return Promise.resolve([]);
    if (cmd === "search_users") return Promise.resolve(searchResults);
    if (cmd === "add_user_to_group") return Promise.resolve(null);
    if (cmd === "remove_group_member") return Promise.resolve(null);
    return Promise.resolve(null);
  }) as typeof invoke);
}

describe("GroupManagement", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("renders with search bar and loads groups on mount (flat view default)", async () => {
    const entries = [
      makeGroupEntry("Developers"),
      makeGroupEntry("Finance-Analysts"),
    ];
    mockBrowseWith(entries);

    render(<GroupManagement />, { wrapper: TestProviders });
    expect(screen.getByTestId("group-management")).toBeInTheDocument();
    expect(screen.getByTestId("search-bar")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId("group-results-list")).toBeInTheDocument();
    });

    expect(screen.getByTestId("group-result-Developers")).toBeInTheDocument();
    expect(
      screen.getByTestId("group-result-Finance-Analysts"),
    ).toBeInTheDocument();
  });

  it("shows loading state during initial load", () => {
    mockInvoke.mockImplementation(
      (() => new Promise(() => {})) as typeof invoke,
    );
    render(<GroupManagement />, { wrapper: TestProviders });
    expect(screen.getByTestId("group-management-loading")).toBeInTheDocument();
  });

  it("shows error state when browse fails", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "browse_groups")
        return Promise.reject(new Error("Connection failed"));
      if (cmd === "get_ou_tree") return Promise.resolve([]);
      if (cmd === "get_permission_level") return Promise.resolve("ReadOnly");
      if (cmd === "get_user_groups") return Promise.resolve([]);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(<GroupManagement />, { wrapper: TestProviders });

    await waitFor(() => {
      expect(screen.getByTestId("group-management-error")).toBeInTheDocument();
    });

    expect(screen.getByText("Failed to load groups")).toBeInTheDocument();
  });

  it("shows empty state when no groups", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "browse_groups") return Promise.resolve(makeBrowseResult([]));
      if (cmd === "get_ou_tree") return Promise.resolve([]);
      if (cmd === "get_permission_level") return Promise.resolve("ReadOnly");
      if (cmd === "get_user_groups") return Promise.resolve([]);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(<GroupManagement />, { wrapper: TestProviders });

    await waitFor(() => {
      expect(screen.getByTestId("group-management-empty")).toBeInTheDocument();
    });

    expect(
      screen.getByTestId("empty-state-title"),
    ).toHaveTextContent("No groups found");
  });

  it("displays group details when a group is selected", async () => {
    const entries = [makeGroupEntry("Developers", "Global", "Security", 3)];
    mockBrowseWith(entries);

    render(<GroupManagement />, { wrapper: TestProviders });

    await waitFor(() => {
      expect(screen.getByTestId("group-result-Developers")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("group-result-Developers"));

    await waitFor(() => {
      expect(screen.getByTestId("group-detail")).toBeInTheDocument();
    });

    const detail = screen.getByTestId("group-detail");
    expect(detail.querySelector("h2")).toHaveTextContent("Developers");
  });

  it("shows member list in detail panel", async () => {
    const entries = [makeGroupEntry("Developers")];
    const memberEntries: DirectoryEntry[] = [
      {
        distinguishedName: "CN=John Doe,OU=Users,OU=Corp,DC=example,DC=com",
        samAccountName: "jdoe",
        displayName: "John Doe",
        objectClass: "user",
        attributes: {},
      },
    ];

    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "browse_groups")
        return Promise.resolve(makeBrowseResult(entries));
      if (cmd === "get_group_members") return Promise.resolve(memberEntries);
      if (cmd === "get_ou_tree") return Promise.resolve([]);
      if (cmd === "get_permission_level") return Promise.resolve("ReadOnly");
      if (cmd === "get_user_groups") return Promise.resolve([]);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(<GroupManagement />, { wrapper: TestProviders });

    await waitFor(() => {
      expect(screen.getByTestId("group-result-Developers")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("group-result-Developers"));

    await waitFor(() => {
      expect(screen.getByTestId("group-members-section")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText("John Doe")).toBeInTheDocument();
    });
  });

  it("toggles between tree and flat views", async () => {
    const entries = [makeGroupEntry("Developers")];
    mockBrowseWith(entries);

    render(<GroupManagement />, { wrapper: TestProviders });

    await waitFor(() => {
      expect(screen.getByTestId("group-results-list")).toBeInTheDocument();
    });

    // Default is flat - no tree panel
    expect(screen.queryByTestId("group-tree-panel")).not.toBeInTheDocument();

    // Switch to tree
    fireEvent.click(screen.getByTestId("view-toggle-tree"));

    await waitFor(() => {
      expect(screen.getByTestId("group-tree-panel")).toBeInTheDocument();
    });

    // Switch back to flat
    fireEvent.click(screen.getByTestId("view-toggle-flat"));

    await waitFor(() => {
      expect(screen.queryByTestId("group-tree-panel")).not.toBeInTheDocument();
    });
  });

  it("search filters groups in flat view", async () => {
    const entries = [
      makeGroupEntry("Developers"),
      makeGroupEntry("Finance-Analysts"),
    ];
    mockBrowseWith(entries);

    render(<GroupManagement />, { wrapper: TestProviders });

    await waitFor(() => {
      expect(screen.getByTestId("group-results-list")).toBeInTheDocument();
    });

    expect(mockInvoke).toHaveBeenCalledWith("browse_groups", {
      page: 0,
      pageSize: 50,
    });
  });

  it("tree view renders OU tree", async () => {
    const entries = [makeGroupEntry("Developers")];
    const ouTree = [
      {
        distinguishedName: "OU=Groups,DC=example,DC=com",
        name: "Groups",
        children: [],
        hasChildren: false,
      },
    ];

    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "browse_groups")
        return Promise.resolve(makeBrowseResult(entries));
      if (cmd === "get_ou_tree") return Promise.resolve(ouTree);
      if (cmd === "get_group_members") return Promise.resolve([]);
      if (cmd === "get_permission_level") return Promise.resolve("ReadOnly");
      if (cmd === "get_user_groups") return Promise.resolve([]);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(<GroupManagement />, { wrapper: TestProviders });

    await waitFor(() => {
      expect(screen.getByTestId("group-results-list")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("view-toggle-tree"));

    await waitFor(() => {
      expect(screen.getByTestId("group-tree-panel")).toBeInTheDocument();
    });

    expect(screen.getByText("Groups")).toBeInTheDocument();
  });

  it("group detail shows correct scope and category values via badges", async () => {
    const entries = [makeGroupEntry("DL-Group", "DomainLocal", "Distribution")];
    mockBrowseWith(entries);

    render(<GroupManagement />, { wrapper: TestProviders });

    await waitFor(() => {
      expect(screen.getByTestId("group-result-DL-Group")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("group-result-DL-Group"));

    await waitFor(() => {
      expect(screen.getByTestId("group-detail")).toBeInTheDocument();
    });

    // Scope and category are now shown in PropertyGrid and StatusBadge
    const badges = screen.getAllByTestId("status-badge");
    const badgeTexts = badges.map((b) => b.textContent);
    expect(badgeTexts).toContain("DomainLocal");
    expect(badgeTexts).toContain("Distribution");
  });

  it("shows placeholder when no group is selected", async () => {
    const entries = [makeGroupEntry("Developers")];
    mockBrowseWith(entries);

    render(<GroupManagement />, { wrapper: TestProviders });

    await waitFor(() => {
      expect(screen.getByTestId("group-results-list")).toBeInTheDocument();
    });

    expect(
      screen.getByText("Select a group to view details"),
    ).toBeInTheDocument();
  });

  it("has aria-live status region", async () => {
    const entries = [makeGroupEntry("Developers")];
    mockBrowseWith(entries);

    render(<GroupManagement />, { wrapper: TestProviders });

    await waitFor(() => {
      expect(screen.getByTestId("group-management-status")).toBeInTheDocument();
    });

    const status = screen.getByTestId("group-management-status");
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("shows view mode toolbar with all buttons", async () => {
    const entries = [makeGroupEntry("Developers")];
    mockBrowseWith(entries, { permissionLevel: "AccountOperator" });

    render(<GroupManagement />, { wrapper: TestProviders });

    await waitFor(() => {
      expect(screen.getByTestId("view-toggle-flat")).toBeInTheDocument();
    });

    expect(screen.getByTestId("view-toggle-tree")).toBeInTheDocument();
    expect(screen.getByTestId("view-toggle-bulk")).toBeInTheDocument();
    expect(screen.getByTestId("view-toggle-hygiene")).toBeInTheDocument();
  });

  it("shows category badge on list items", async () => {
    const entries = [makeGroupEntry("Developers", "Global", "Security")];
    mockBrowseWith(entries);

    render(<GroupManagement />, { wrapper: TestProviders });

    await waitFor(() => {
      expect(screen.getByTestId("group-result-Developers")).toBeInTheDocument();
    });

    // List item should have a StatusBadge
    const listItem = screen.getByTestId("group-result-Developers");
    const badge = listItem.querySelector("[data-testid='status-badge']");
    expect(badge).toBeInTheDocument();
    expect(badge?.textContent).toBe("Security");
  });

  describe("Member Management (Story 4.2)", () => {
    const memberEntries: DirectoryEntry[] = [
      {
        distinguishedName: "CN=John Doe,OU=Users,OU=Corp,DC=example,DC=com",
        samAccountName: "jdoe",
        displayName: "John Doe",
        objectClass: "user",
        attributes: {},
      },
      {
        distinguishedName: "CN=Alice Smith,OU=Users,OU=Corp,DC=example,DC=com",
        samAccountName: "asmith",
        displayName: "Alice Smith",
        objectClass: "user",
        attributes: {},
      },
    ];

    const searchResults: DirectoryEntry[] = [
      {
        distinguishedName: "CN=New User,OU=Users,OU=Corp,DC=example,DC=com",
        samAccountName: "nuser",
        displayName: "New User",
        objectClass: "user",
        attributes: {},
      },
    ];

    async function selectGroupWithMembers(
      permissionLevel: string,
      members: DirectoryEntry[] = memberEntries,
    ) {
      const entries = [makeGroupEntry("Developers")];
      mockBrowseWith(entries, {
        permissionLevel,
        members,
        searchResults,
      });

      render(<GroupManagement />, { wrapper: TestProviders });

      await waitFor(() => {
        expect(
          screen.getByTestId("group-result-Developers"),
        ).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("group-result-Developers"));

      await waitFor(() => {
        expect(screen.getByTestId("group-members-section")).toBeInTheDocument();
      });
    }

    it("shows add/remove controls when user has AccountOperator permission", async () => {
      await selectGroupWithMembers("AccountOperator");

      await waitFor(() => {
        expect(
          screen.getByTestId("member-management-controls"),
        ).toBeInTheDocument();
      });

      expect(screen.getByTestId("add-member-section")).toBeInTheDocument();
      expect(screen.getByTestId("select-all-checkbox")).toBeInTheDocument();
    });

    it("hides add/remove controls for ReadOnly users", async () => {
      await selectGroupWithMembers("ReadOnly");

      await waitFor(() => {
        expect(screen.getByText("John Doe")).toBeInTheDocument();
      });

      expect(
        screen.queryByTestId("member-management-controls"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("add-member-section"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("select-all-checkbox"),
      ).not.toBeInTheDocument();
    });

    it("multi-select on member list works", async () => {
      await selectGroupWithMembers("AccountOperator");

      await waitFor(() => {
        expect(screen.getByText("John Doe")).toBeInTheDocument();
      });

      const checkbox = screen.getByTestId("member-checkbox-John Doe");
      fireEvent.click(checkbox);

      await waitFor(() => {
        expect(screen.getByTestId("remove-selected-btn")).toBeInTheDocument();
      });

      expect(screen.getByTestId("remove-selected-btn")).toHaveTextContent(
        "Remove Selected (1)",
      );
    });

    it("remove selected adds pending removals", async () => {
      await selectGroupWithMembers("AccountOperator");

      await waitFor(() => {
        expect(screen.getByText("John Doe")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("member-checkbox-John Doe"));

      await waitFor(() => {
        expect(screen.getByTestId("remove-selected-btn")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("remove-selected-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("preview-changes-btn")).toBeInTheDocument();
      });

      expect(screen.getByTestId("preview-changes-btn")).toHaveTextContent(
        "Preview (1)",
      );
    });

    it("preview dialog shows pending removals", async () => {
      await selectGroupWithMembers("AccountOperator");

      await waitFor(() => {
        expect(screen.getByText("John Doe")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("member-checkbox-John Doe"));

      await waitFor(() => {
        expect(screen.getByTestId("remove-selected-btn")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("remove-selected-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("preview-changes-btn")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("preview-changes-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("member-change-preview")).toBeInTheDocument();
      });

      expect(screen.getByTestId("member-change-summary")).toHaveTextContent(
        "1 member to remove",
      );
    });

    it("apply removes members and refreshes list", async () => {
      await selectGroupWithMembers("AccountOperator");

      await waitFor(() => {
        expect(screen.getByText("John Doe")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("member-checkbox-John Doe"));

      await waitFor(() => {
        expect(screen.getByTestId("remove-selected-btn")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("remove-selected-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("preview-changes-btn")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("preview-changes-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("member-change-preview")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("member-change-apply"));

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("remove_group_member", {
          memberDn: "CN=John Doe,OU=Users,OU=Corp,DC=example,DC=com",
          groupDn: "CN=Developers,OU=Groups,DC=example,DC=com",
        });
      });
    });

    it("add member search returns results", async () => {
      await selectGroupWithMembers("AccountOperator");

      await waitFor(() => {
        expect(screen.getByTestId("add-member-section")).toBeInTheDocument();
      });

      const searchInput = screen.getByTestId("member-search-input");
      fireEvent.change(searchInput, { target: { value: "New" } });

      await waitFor(() => {
        expect(screen.getByTestId("member-search-results")).toBeInTheDocument();
      });

      expect(screen.getByText("New User")).toBeInTheDocument();
    });

    it("add to group adds pending change", async () => {
      await selectGroupWithMembers("AccountOperator");

      await waitFor(() => {
        expect(screen.getByTestId("add-member-section")).toBeInTheDocument();
      });

      const searchInput = screen.getByTestId("member-search-input");
      fireEvent.change(searchInput, { target: { value: "New" } });

      await waitFor(() => {
        expect(screen.getByTestId("member-search-results")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("add-member-btn-New User"));

      await waitFor(() => {
        expect(screen.getByTestId("preview-changes-btn")).toBeInTheDocument();
      });

      expect(screen.getByTestId("preview-changes-btn")).toHaveTextContent(
        "Preview (1)",
      );
    });

    it("select-all checkbox selects all members", async () => {
      await selectGroupWithMembers("AccountOperator");

      await waitFor(() => {
        expect(screen.getByTestId("select-all-checkbox")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("select-all-checkbox"));

      await waitFor(() => {
        expect(screen.getByTestId("remove-selected-btn")).toBeInTheDocument();
      });

      expect(screen.getByTestId("remove-selected-btn")).toHaveTextContent(
        "Remove Selected (2)",
      );
    });
  });

  describe("Hygiene Tab (Story 4.4)", () => {
    it("shows hygiene toggle for AccountOperator users", async () => {
      const entries = [makeGroupEntry("Developers")];
      mockBrowseWith(entries, { permissionLevel: "AccountOperator" });

      render(<GroupManagement />, { wrapper: TestProviders });

      await waitFor(() => {
        expect(screen.getByTestId("group-results-list")).toBeInTheDocument();
      });

      expect(screen.getByTestId("view-toggle-hygiene")).toBeInTheDocument();
    });

    it("hides hygiene toggle for ReadOnly users", async () => {
      const entries = [makeGroupEntry("Developers")];
      mockBrowseWith(entries, { permissionLevel: "ReadOnly" });

      render(<GroupManagement />, { wrapper: TestProviders });

      await waitFor(() => {
        expect(screen.getByTestId("group-results-list")).toBeInTheDocument();
      });

      expect(
        screen.queryByTestId("view-toggle-hygiene"),
      ).not.toBeInTheDocument();
    });

    it("switches to hygiene view when hygiene toggle is clicked", async () => {
      const entries = [makeGroupEntry("Developers")];
      mockBrowseWith(entries, { permissionLevel: "AccountOperator" });

      render(<GroupManagement />, { wrapper: TestProviders });

      await waitFor(() => {
        expect(screen.getByTestId("view-toggle-hygiene")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("view-toggle-hygiene"));

      await waitFor(() => {
        expect(screen.getByTestId("hygiene-view")).toBeInTheDocument();
      });

      expect(screen.getByTestId("group-hygiene")).toBeInTheDocument();
    });
  });

  describe("Bulk Operations (Story 4.3)", () => {
    it("shows bulk operations toggle for AccountOperator users", async () => {
      const entries = [makeGroupEntry("Developers")];
      mockBrowseWith(entries, { permissionLevel: "AccountOperator" });

      render(<GroupManagement />, { wrapper: TestProviders });

      await waitFor(() => {
        expect(screen.getByTestId("group-results-list")).toBeInTheDocument();
      });

      expect(screen.getByTestId("view-toggle-bulk")).toBeInTheDocument();
    });

    it("hides bulk operations toggle for ReadOnly users", async () => {
      const entries = [makeGroupEntry("Developers")];
      mockBrowseWith(entries, { permissionLevel: "ReadOnly" });

      render(<GroupManagement />, { wrapper: TestProviders });

      await waitFor(() => {
        expect(screen.getByTestId("group-results-list")).toBeInTheDocument();
      });

      expect(screen.queryByTestId("view-toggle-bulk")).not.toBeInTheDocument();
    });

    it("switches to bulk operations view when bulk toggle is clicked", async () => {
      const entries = [makeGroupEntry("Developers")];
      mockBrowseWith(entries, { permissionLevel: "AccountOperator" });

      render(<GroupManagement />, { wrapper: TestProviders });

      await waitFor(() => {
        expect(screen.getByTestId("view-toggle-bulk")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("view-toggle-bulk"));

      await waitFor(() => {
        expect(screen.getByTestId("bulk-operations-view")).toBeInTheDocument();
      });

      expect(screen.getByTestId("bulk-operations")).toBeInTheDocument();
    });
  });
});
