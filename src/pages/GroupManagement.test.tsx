import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { type ReactNode, useEffect, useRef } from "react";
import { GroupManagement } from "./GroupManagement";
import { DialogProvider } from "@/contexts/DialogContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import {
  NavigationProvider,
  useNavigation,
} from "@/contexts/NavigationContext";
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

/**
 * Wrapper that opens a "groups" tab with data for deep-link testing.
 */
function DeepLinkWrapper({
  children,
  selectedGroupDn,
}: {
  children: ReactNode;
  selectedGroupDn: string;
}) {
  const { openTab } = useNavigation();
  const opened = useRef(false);

  useEffect(() => {
    if (!opened.current) {
      opened.current = true;
      openTab("Group Management", "groups", "users-group", {
        selectedGroupDn,
      });
    }
  }, [openTab, selectedGroupDn]);

  return <>{children}</>;
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

  it("renders with search bar and loads groups on mount (list view default)", async () => {
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

  it("search filters groups in list view", async () => {
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

    // Scope and category are shown in the group detail (badge + PropertyGrid)
    expect(screen.getAllByText("Domain Local").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Distribution").length).toBeGreaterThanOrEqual(1);
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

  it("shows category and scope info on list items", async () => {
    const entries = [makeGroupEntry("Developers", "Global", "Security")];
    mockBrowseWith(entries);

    render(<GroupManagement />, { wrapper: TestProviders });

    await waitFor(() => {
      expect(screen.getByTestId("group-result-Developers")).toBeInTheDocument();
    });

    // List item shows scope/category info inline with abbreviation
    const listItem = screen.getByTestId("group-result-Developers");
    // Scope abbreviation "G" for Global should be visible
    expect(listItem.textContent).toContain("G");
    // Category and scope details appear in subtitle line
    expect(listItem.textContent).toContain("Security");
  });

  describe("Deep-link and member loading", () => {
    it("deep-link selects group from browse results when selectedGroupDn matches", async () => {
      const entries = [
        makeGroupEntry("Developers"),
        makeGroupEntry("Finance-Analysts"),
      ];
      mockBrowseWith(entries);

      // We need to render with NavigationProvider and set tab data
      // First render the component, open a tab with data, then mount GroupManagement
      const { unmount } = render(
        <TestProviders>
          <DeepLinkWrapper selectedGroupDn="CN=Finance-Analysts,OU=Groups,DC=example,DC=com">
            <GroupManagement />
          </DeepLinkWrapper>
        </TestProviders>,
      );

      await waitFor(() => {
        expect(screen.getByTestId("group-detail")).toBeInTheDocument();
      });

      const detail = screen.getByTestId("group-detail");
      expect(detail.querySelector("h2")).toHaveTextContent("Finance-Analysts");
      unmount();
    });

    it("deep-link searches via search_groups when group not in browse results", async () => {
      const browseEntries = [makeGroupEntry("Developers")];
      const searchEntry: DirectoryEntry = {
        distinguishedName: "CN=Remote-Group,OU=Groups,DC=example,DC=com",
        samAccountName: "Remote-Group",
        displayName: "Remote-Group",
        objectClass: "group",
        attributes: {
          groupType: ["-2147483646"],
          description: ["Remote group"],
        },
      };

      mockInvoke.mockImplementation(((cmd: string, _args?: Record<string, unknown>) => {
        if (cmd === "browse_groups") return Promise.resolve(makeBrowseResult(browseEntries));
        if (cmd === "search_groups") return Promise.resolve([searchEntry]);
        if (cmd === "get_group_members") return Promise.resolve([]);
        if (cmd === "get_permission_level") return Promise.resolve("ReadOnly");
        if (cmd === "get_user_groups") return Promise.resolve([]);
        return Promise.resolve(null);
      }) as typeof invoke);

      render(
        <TestProviders>
          <DeepLinkWrapper selectedGroupDn="CN=Remote-Group,OU=Groups,DC=example,DC=com">
            <GroupManagement />
          </DeepLinkWrapper>
        </TestProviders>,
      );

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("search_groups", { query: "Remote-Group" });
      });

      await waitFor(() => {
        expect(screen.getByTestId("group-detail")).toBeInTheDocument();
      });

      const detail = screen.getByTestId("group-detail");
      expect(detail.querySelector("h2")).toHaveTextContent("Remote-Group");
    });

    it("members load when a group is selected", async () => {
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
      mockBrowseWith(entries, { members: memberEntries });

      render(<GroupManagement />, { wrapper: TestProviders });

      await waitFor(() => {
        expect(screen.getByTestId("group-result-Developers")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId("group-result-Developers"));

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("get_group_members", {
          groupDn: "CN=Developers,OU=Groups,DC=example,DC=com",
        });
      });

      await waitFor(() => {
        expect(screen.getByText("John Doe")).toBeInTheDocument();
      });
    });

    it("members clear when no group is selected (placeholder shown)", async () => {
      const entries = [makeGroupEntry("Developers")];
      mockBrowseWith(entries);

      render(<GroupManagement />, { wrapper: TestProviders });

      await waitFor(() => {
        expect(screen.getByTestId("group-results-list")).toBeInTheDocument();
      });

      // No group selected - should show placeholder
      expect(screen.getByText("Select a group to view details")).toBeInTheDocument();
      expect(screen.queryByTestId("group-members-section")).not.toBeInTheDocument();
    });
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

      expect(screen.getByTestId("add-member-btn")).toBeInTheDocument();
      expect(screen.getByTestId("select-all-checkbox")).toBeInTheDocument();
    });

    it("disables add/remove controls for ReadOnly users", async () => {
      await selectGroupWithMembers("ReadOnly");

      await waitFor(() => {
        expect(screen.getByText("John Doe")).toBeInTheDocument();
      });

      // Controls are rendered but disabled for ReadOnly
      expect(screen.getByTestId("add-member-btn")).toBeDisabled();
      expect(screen.getByTestId("remove-selected-btn")).toBeDisabled();
      expect(screen.getByTestId("preview-changes-btn")).toBeDisabled();
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
        "Remove (1)",
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

      // Open the add dropdown
      fireEvent.click(screen.getByTestId("add-member-btn"));

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

      // Open the add dropdown
      fireEvent.click(screen.getByTestId("add-member-btn"));

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
        "Remove (2)",
      );
    });
  });

});
