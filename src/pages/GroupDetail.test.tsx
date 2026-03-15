import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { GroupDetail, type GroupDetailProps } from "./GroupDetail";
import { NavigationProvider } from "@/contexts/NavigationContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { DialogProvider } from "@/contexts/DialogContext";
import type { DirectoryEntry, DirectoryGroup } from "@/types/directory";

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

function makeGroup(overrides: Partial<DirectoryGroup> = {}): DirectoryGroup {
  return {
    distinguishedName: "CN=Developers,OU=Groups,DC=example,DC=com",
    samAccountName: "Developers",
    displayName: "Developers",
    description: "Development team group",
    scope: "Global",
    category: "Security",
    memberCount: 3,
    organizationalUnit: "Groups",
    ...overrides,
  };
}

const defaultMembers: DirectoryEntry[] = [
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

function renderGroupDetail(props: Partial<GroupDetailProps> = {}) {
  const defaultProps: GroupDetailProps = {
    group: makeGroup(),
    members: defaultMembers,
    membersLoading: false,
    canManageMembers: false,
    onMembersRefresh: vi.fn(),
    ...props,
  };
  return render(<GroupDetail {...defaultProps} />, {
    wrapper: TestProviders,
  });
}

describe("GroupDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "search_users") return Promise.resolve([]);
      if (cmd === "search_groups") return Promise.resolve([]);
      if (cmd === "add_user_to_group") return Promise.resolve(null);
      if (cmd === "remove_group_member") return Promise.resolve(null);
      if (cmd === "get_group_members") return Promise.resolve([]);
      return Promise.resolve(null);
    }) as typeof invoke);
  });

  it("renders group detail with property grid", () => {
    renderGroupDetail();
    expect(screen.getByTestId("group-detail")).toBeInTheDocument();
    expect(screen.getByText("Identity")).toBeInTheDocument();
    expect(screen.getByText("Location")).toBeInTheDocument();
    expect(screen.getByText("Group Type")).toBeInTheDocument();
  });

  it("displays group name as heading", () => {
    renderGroupDetail({ group: makeGroup({ displayName: "My Team" }) });
    const heading = screen.getByTestId("group-detail").querySelector("h2");
    expect(heading).toHaveTextContent("My Team");
  });

  it("shows scope and category badges", () => {
    renderGroupDetail({
      group: makeGroup({ scope: "Universal", category: "Distribution" }),
    });
    const badges = screen.getAllByTestId("status-badge");
    const texts = badges.map((b) => b.textContent);
    expect(texts).toContain("Universal");
    expect(texts).toContain("Distribution");
  });

  it("shows scope badge with info variant", () => {
    renderGroupDetail({ group: makeGroup({ scope: "Global" }) });
    const badges = screen.getAllByTestId("status-badge");
    const scopeBadge = badges.find((b) => b.textContent === "Global");
    expect(scopeBadge).toBeDefined();
    expect(scopeBadge?.getAttribute("data-variant")).toBe("info");
  });

  it("shows category badge with neutral variant for Security", () => {
    renderGroupDetail({ group: makeGroup({ category: "Security" }) });
    const badges = screen.getAllByTestId("status-badge");
    const catBadge = badges.find((b) => b.textContent === "Security");
    expect(catBadge).toBeDefined();
    expect(catBadge?.getAttribute("data-variant")).toBe("neutral");
  });

  it("shows category badge with warning variant for Distribution", () => {
    renderGroupDetail({ group: makeGroup({ category: "Distribution" }) });
    const badges = screen.getAllByTestId("status-badge");
    const catBadge = badges.find((b) => b.textContent === "Distribution");
    expect(catBadge).toBeDefined();
    expect(catBadge?.getAttribute("data-variant")).toBe("warning");
  });

  it("shows CopyButton for samAccountName", () => {
    renderGroupDetail();
    // Copy button appears in subtitle area and in PropertyGrid rows
    const copyButtons = screen.getAllByTestId("copy-button");
    expect(copyButtons.length).toBeGreaterThanOrEqual(1);
    // samAccountName appears in subtitle area alongside the copy button
    const allDevs = screen.getAllByText("Developers");
    expect(allDevs.length).toBeGreaterThanOrEqual(2);
  });

  it("shows member list", () => {
    renderGroupDetail();
    expect(screen.getByTestId("group-members-section")).toBeInTheDocument();
    expect(screen.getByText("John Doe")).toBeInTheDocument();
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
  });

  it("shows member count in properties", () => {
    renderGroupDetail({ group: makeGroup({ memberCount: 42 }) });
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("shows management controls for AccountOperator", () => {
    renderGroupDetail({ canManageMembers: true });
    expect(
      screen.getByTestId("member-management-controls"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("add-member-btn")).toBeInTheDocument();
    expect(screen.getByTestId("select-all-checkbox")).toBeInTheDocument();
    // Buttons always visible but disabled by default
    expect(screen.getByTestId("remove-selected-btn")).toBeDisabled();
    expect(screen.getByTestId("preview-changes-btn")).toBeDisabled();
  });

  it("shows help button with info popup", async () => {
    renderGroupDetail({ canManageMembers: true });
    expect(screen.getByTestId("member-help-btn")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("member-help-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("member-help-popup")).toBeInTheDocument();
    });

    expect(screen.getByText("Member Management")).toBeInTheDocument();
  });

  it("hides management controls for ReadOnly", () => {
    renderGroupDetail({ canManageMembers: false });
    expect(
      screen.queryByTestId("member-management-controls"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("add-member-btn")).not.toBeInTheDocument();
    expect(screen.queryByTestId("select-all-checkbox")).not.toBeInTheDocument();
  });

  it("shows loading spinner when members are loading", () => {
    renderGroupDetail({ membersLoading: true, members: [] });
    expect(screen.getByText("Loading members...")).toBeInTheDocument();
  });

  it("shows no members message when members list is empty", () => {
    renderGroupDetail({ members: [] });
    expect(screen.getByText("No members found")).toBeInTheDocument();
  });

  it("displays property values in the grid", () => {
    renderGroupDetail({
      group: makeGroup({
        description: "A test group",
        organizationalUnit: "TestOU",
      }),
    });
    expect(screen.getByText("A test group")).toBeInTheDocument();
    expect(screen.getByText("TestOU")).toBeInTheDocument();
  });

  it("multi-select enables remove button", async () => {
    renderGroupDetail({ canManageMembers: true });

    // Button starts disabled
    expect(screen.getByTestId("remove-selected-btn")).toBeDisabled();

    fireEvent.click(screen.getByTestId("member-checkbox-John Doe"));

    await waitFor(() => {
      expect(screen.getByTestId("remove-selected-btn")).not.toBeDisabled();
    });

    expect(screen.getByTestId("remove-selected-btn")).toHaveTextContent(
      "Remove (1)",
    );
  });

  it("add member dropdown opens and search returns results", async () => {
    const searchResults: DirectoryEntry[] = [
      {
        distinguishedName: "CN=New User,OU=Users,OU=Corp,DC=example,DC=com",
        samAccountName: "nuser",
        displayName: "New User",
        objectClass: "user",
        attributes: {},
      },
    ];

    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "search_users") return Promise.resolve(searchResults);
      if (cmd === "search_groups") return Promise.resolve([]);
      return Promise.resolve(null);
    }) as typeof invoke);

    renderGroupDetail({ canManageMembers: true });

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

  it("select-all checkbox selects all members", async () => {
    renderGroupDetail({ canManageMembers: true });

    fireEvent.click(screen.getByTestId("select-all-checkbox"));

    await waitFor(() => {
      expect(screen.getByTestId("remove-selected-btn")).not.toBeDisabled();
    });

    expect(screen.getByTestId("remove-selected-btn")).toHaveTextContent(
      "Remove (2)",
    );
  });

  it("shows members title with direct members count", () => {
    renderGroupDetail();
    const title = screen.getByTestId("members-title");
    expect(title).toHaveTextContent("Members (2)");
  });

  it("shows nested groups count in members title", () => {
    const membersWithGroup: DirectoryEntry[] = [
      ...defaultMembers,
      {
        distinguishedName: "CN=SubGroup,OU=Groups,DC=example,DC=com",
        samAccountName: "SubGroup",
        displayName: "SubGroup",
        objectClass: "group",
        attributes: {},
      },
    ];

    renderGroupDetail({ members: membersWithGroup });
    const title = screen.getByTestId("members-title");
    expect(title).toHaveTextContent("Members (2)");
    expect(title).toHaveTextContent("and 1 nested group(s)");
  });

  it("shows nested groups in unified member list", () => {
    const membersWithGroup: DirectoryEntry[] = [
      ...defaultMembers,
      {
        distinguishedName: "CN=SubGroup,OU=Groups,DC=example,DC=com",
        samAccountName: "SubGroup",
        displayName: "SubGroup",
        objectClass: "group",
        attributes: {},
      },
    ];

    renderGroupDetail({ members: membersWithGroup });
    expect(screen.getByTestId("member-list")).toBeInTheDocument();
    // Group appears first with expand button
    expect(screen.getByTestId("nested-group-SubGroup")).toBeInTheDocument();
    expect(screen.getByTestId("expand-SubGroup")).toBeInTheDocument();
  });

  it("expands nested group and loads members on click", async () => {
    const nestedMembers: DirectoryEntry[] = [
      {
        distinguishedName: "CN=Nested User,OU=Users,DC=example,DC=com",
        samAccountName: "nuser",
        displayName: "Nested User",
        objectClass: "user",
        attributes: {},
      },
    ];

    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_group_members") return Promise.resolve(nestedMembers);
      if (cmd === "search_users") return Promise.resolve([]);
      if (cmd === "search_groups") return Promise.resolve([]);
      return Promise.resolve(null);
    }) as typeof invoke);

    const membersWithGroup: DirectoryEntry[] = [
      ...defaultMembers,
      {
        distinguishedName: "CN=SubGroup,OU=Groups,DC=example,DC=com",
        samAccountName: "SubGroup",
        displayName: "SubGroup",
        objectClass: "group",
        attributes: {},
      },
    ];

    renderGroupDetail({ members: membersWithGroup });

    fireEvent.click(screen.getByTestId("expand-SubGroup"));

    await waitFor(() => {
      expect(screen.getByTestId("nested-group-members-SubGroup")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText("Nested User")).toBeInTheDocument();
    });

    expect(mockInvoke).toHaveBeenCalledWith("get_group_members", {
      groupDn: "CN=SubGroup,OU=Groups,DC=example,DC=com",
    });
  });

  it("shows groups before users in unified list", () => {
    const membersWithGroup: DirectoryEntry[] = [
      ...defaultMembers,
      {
        distinguishedName: "CN=SubGroup,OU=Groups,DC=example,DC=com",
        samAccountName: "SubGroup",
        displayName: "SubGroup",
        objectClass: "group",
        attributes: {},
      },
    ];

    renderGroupDetail({ members: membersWithGroup });
    const list = screen.getByTestId("member-list");
    const items = list.querySelectorAll("[data-testid^='nested-group-'], [data-testid^='member-row-']");
    // First item should be the group
    expect(items[0]).toHaveAttribute("data-testid", "nested-group-SubGroup");
    // Users follow
    expect(items[1]).toHaveAttribute("data-testid", "member-row-John Doe");
  });

  it("does not show expand buttons when no group members exist", () => {
    renderGroupDetail();
    // No expand chevrons since no groups in members
    expect(screen.queryByTestId("expand-John Doe")).not.toBeInTheDocument();
    expect(screen.queryByTestId("expand-Alice Smith")).not.toBeInTheDocument();
  });

  it("shows search placeholder for users or groups", async () => {
    renderGroupDetail({ canManageMembers: true });

    fireEvent.click(screen.getByTestId("add-member-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("add-member-section")).toBeInTheDocument();
    });

    const input = screen.getByTestId("member-search-input");
    expect(input).toHaveAttribute("placeholder", "Search users or groups to add...");
    expect(screen.getByText("Type to search for users or groups")).toBeInTheDocument();
  });

  it("shows no results found when search returns empty", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "search_users") return Promise.resolve([]);
      if (cmd === "search_groups") return Promise.resolve([]);
      return Promise.resolve(null);
    }) as typeof invoke);

    renderGroupDetail({ canManageMembers: true });

    fireEvent.click(screen.getByTestId("add-member-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("add-member-section")).toBeInTheDocument();
    });

    const searchInput = screen.getByTestId("member-search-input");
    fireEvent.change(searchInput, { target: { value: "nonexistent" } });

    await waitFor(() => {
      expect(screen.getByText("No results found")).toBeInTheDocument();
    });
  });
});
